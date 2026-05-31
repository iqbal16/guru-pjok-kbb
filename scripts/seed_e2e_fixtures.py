import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def require_doc(db, collection, query, label):
    doc = db[collection].find_one(query, {"_id": 0})
    if not doc:
        raise RuntimeError(f"Data wajib tidak ditemukan: {label}")
    return doc


def main():
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    active_period = require_doc(db, "assessment_periods", {"is_active": True}, "periode aktif")
    admin = require_doc(db, "users", {"email": "admin@pjok-kbb.id"}, "admin")
    kepsek = require_doc(db, "users", {"email": "kepsek@pjok-kbb.id"}, "kepsek@pjok-kbb.id")
    pengawas = require_doc(db, "users", {"email": "pengawas@pjok-kbb.id"}, "pengawas@pjok-kbb.id")
    guru1_user = require_doc(db, "users", {"email": "guru1@pjok-kbb.id"}, "guru1@pjok-kbb.id")
    guru1 = require_doc(db, "teachers", {"id": guru1_user["linked_profile_id"]}, "profil guru1")
    school = require_doc(db, "schools", {"id": guru1["school_id"]}, "sekolah guru1")

    categories = list(db.observation_categories.find({"status": "aktif"}, {"_id": 0}).sort("display_order", 1))
    aspects = list(db.observation_aspects.find({"status": "aktif"}, {"_id": 0}).sort([("category_id", 1), ("display_order", 1)]))
    if not aspects:
        raise RuntimeError("Aspek observasi aktif tidak ditemukan")

    ts = now_iso()

    # 1) Assignment review Guru untuk membuka halaman Review, feedback button, dan test feedback_count=2.
    review_assignment = db.assessment_assignments.find_one({
        "teacher_id": guru1["id"],
        "assessment_period_id": active_period["id"],
        "assessor_role": "Kepala Sekolah",
    })
    if not review_assignment:
        review_assignment = {
            "id": str(uuid.uuid4()),
            "teacher_id": guru1["id"],
            "school_id": guru1["school_id"],
            "assessor_user_id": kepsek["id"],
            "assessor_role": "Kepala Sekolah",
            "assessment_period_id": active_period["id"],
            "assignment_type": "Penilaian Utama",
            "created_by": admin["id"],
            "created_at": ts,
        }
        db.assessment_assignments.insert_one(review_assignment)

    review_assignment_id = review_assignment["id"]
    db.assessment_assignments.update_one(
        {"id": review_assignment_id},
        {"$set": {
            "teacher_id": guru1["id"],
            "school_id": guru1["school_id"],
            "assessor_user_id": kepsek["id"],
            "assessor_role": "Kepala Sekolah",
            "assessment_period_id": active_period["id"],
            "assignment_type": "Penilaian Utama",
            "observation_date": "2026-05-31",
            "status": "Menunggu Review Guru",
            "feedback_count": 2,
            "teacher_review_status": "Menunggu Review Guru",
            "teacher_review_completed": False,
            "notes": "Fixture E2E: assignment review Guru dengan feedback maksimal.",
            "updated_at": ts,
        }},
    )

    for index, aspect in enumerate(aspects, start=1):
        score = 4 if index % 2 else 3
        db.assessment_scores.update_one(
            {"assignment_id": review_assignment_id, "aspect_id": aspect["id"]},
            {"$set": {
                "assignment_id": review_assignment_id,
                "teacher_id": guru1["id"],
                "assessor_user_id": kepsek["id"],
                "assessment_period_id": active_period["id"],
                "category_id": aspect["category_id"],
                "aspect_id": aspect["id"],
                "source": "official",
                "include_in_score": True,
                "proposed_aspect_id": None,
                "score": score,
                "notes": f"Fixture E2E skor aspek {index}.",
                "updated_at": ts,
            }, "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": ts,
            }},
            upsert=True,
        )

    for round_no in (1, 2):
        db.teacher_assessment_feedbacks.update_one(
            {"assignment_id": review_assignment_id, "feedback_round": round_no},
            {"$set": {
                "assignment_id": review_assignment_id,
                "teacher_id": guru1["id"],
                "assessment_period_id": active_period["id"],
                "assessor_user_id": kepsek["id"],
                "feedback_text": f"Fixture E2E feedback ronde {round_no}.",
                "feedback_round": round_no,
                "status": "Submitted",
                "updated_at": ts,
            }, "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": ts,
            }},
            upsert=True,
        )

    # 2) Assignment Draft terbaru untuk memunculkan action Hapus dan form editable.
    fixture_teacher_id = "e2e-fixture-teacher-draft"
    db.teachers.update_one(
        {"id": fixture_teacher_id},
        {"$set": {
            "id": fixture_teacher_id,
            "user_id": None,
            "school_id": school["id"],
            "name": "E2E Fixture Guru Draft",
            "nip": "E2E-DRAFT-001",
            "subject": "PJOK",
            "grade_level": "SD",
            "employment_status": "PNS",
            "status": "aktif",
            "updated_at": ts,
        }, "$setOnInsert": {"created_at": ts}},
        upsert=True,
    )

    draft_assignment_id = "e2e-fixture-assignment-draft"
    db.assessment_assignments.update_one(
        {"id": draft_assignment_id},
        {"$set": {
            "id": draft_assignment_id,
            "teacher_id": fixture_teacher_id,
            "school_id": school["id"],
            "assessor_user_id": pengawas["id"],
            "assessor_role": "Pengawas",
            "assessment_period_id": active_period["id"],
            "observation_date": "2026-05-31",
            "assignment_type": "Penilaian Utama",
            "status": "Draft",
            "feedback_count": 0,
            "teacher_review_status": "Draft",
            "teacher_review_completed": False,
            "notes": "Fixture E2E: assignment editable dan bisa dihapus oleh Admin.",
            "created_by": admin["id"],
            "created_at": ts,
            "updated_at": ts,
        }},
        upsert=True,
    )

    # Keep this assignment intentionally incomplete so send/finalization validation stays testable.
    db.assessment_scores.delete_many({"assignment_id": draft_assignment_id})
    db.evaluation_followups.delete_many({"assignment_id": draft_assignment_id})
    db.teacher_assessment_feedbacks.delete_many({"assignment_id": draft_assignment_id})

    print("E2E fixtures ready")
    print("review_assignment_id=", review_assignment_id)
    print("draft_assignment_id=", draft_assignment_id)
    print("active_period_id=", active_period["id"])
    print("categories=", len(categories), "aspects=", len(aspects))


if __name__ == "__main__":
    main()
