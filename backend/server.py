from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 8  # 8 hours

app = FastAPI(title="Sistem Penilaian Kinerja Guru PJOK SD KBB")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

Role = Literal["admin", "pengawas", "kepala_sekolah", "guru"]
MENU_NAMES = [
    "dashboard",
    "user_management",
    "data_sekolah",
    "data_guru",
    "data_pengawas",
    "data_kepala_sekolah",
    "role_permission",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def create_access_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesi berakhir, silakan login ulang")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token tidak valid")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Pengguna tidak ditemukan")
    if user.get("status") != "aktif":
        raise HTTPException(status_code=403, detail="Akun tidak aktif")
    return user

def require_roles(*roles: str):
    async def checker(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Akses ditolak untuk role Anda")
        return user
    return checker

async def audit(user_id: Optional[str], action: str, table: str, record_id: Optional[str], old: Optional[dict], new: Optional[dict]):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "action": action,
        "table_name": table,
        "record_id": record_id,
        "old_value": old,
        "new_value": new,
        "created_at": now_iso(),
    })

async def notify_user(user_id: Optional[str], title: str, message: str, type_: str = "info", related_module: str = "", related_record_id: Optional[str] = None):
    if not user_id:
        return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "message": message,
        "type": type_,
        "related_module": related_module,
        "related_record_id": related_record_id,
        "is_read": False,
        "created_at": now_iso(),
        "read_at": None,
    })

async def notify_admins(title: str, message: str, type_: str = "info", related_module: str = "", related_record_id: Optional[str] = None):
    admins = await db.users.find({"role": "admin", "status": "aktif"}, {"_id": 0, "id": 1}).to_list(200)
    for admin in admins:
        await notify_user(admin["id"], title, message, type_, related_module, related_record_id)

def clean(d: dict) -> dict:
    if d is None:
        return d
    d.pop("_id", None)
    d.pop("password_hash", None)
    return d

def json_safe(value):
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)

def normalize_employment_status(value: Optional[str]) -> str:
    return "PNS" if value == "PNS" else "Non PNS"

PROFILE_COLLECTIONS = {
    "guru": "teachers",
    "pengawas": "supervisors",
    "kepala_sekolah": "principals",
}

async def sync_user_profile_link(user_id: str, role: str, new_profile_id, old_profile_id=None):
    """Keep users.linked_profile_id and profile.user_id consistent.

    - Clears profile.user_id on the old profile (if any).
    - Ensures no other user is linked to new_profile_id.
    - Sets new profile.user_id = user_id.
    """
    coll_name = PROFILE_COLLECTIONS.get(role)
    if not coll_name:
        # admin or unknown — make sure linked_profile_id stays None
        await db.users.update_one({"id": user_id}, {"$set": {"linked_profile_id": None}})
        return
    coll = db[coll_name]

    # 1) Clear old link if changed
    if old_profile_id and old_profile_id != new_profile_id:
        await coll.update_one(
            {"id": old_profile_id},
            {"$set": {"user_id": None, "updated_at": now_iso()}},
        )

    if not new_profile_id:
        return

    # 2) If another user already linked to this profile, unlink them
    target = await coll.find_one({"id": new_profile_id})
    if target and target.get("user_id") and target["user_id"] != user_id:
        await db.users.update_one(
            {"id": target["user_id"]},
            {"$set": {"linked_profile_id": None, "updated_at": now_iso()}},
        )

    # 3) Clear any other profile in same collection that points to this user
    await coll.update_many(
        {"user_id": user_id, "id": {"$ne": new_profile_id}},
        {"$set": {"user_id": None, "updated_at": now_iso()}},
    )

    # 4) Set the new link
    await coll.update_one(
        {"id": new_profile_id},
        {"$set": {"user_id": user_id, "updated_at": now_iso()}},
    )

# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    email: EmailStr
    role: Role
    linked_profile_id: Optional[str] = None
    status: str

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Role
    linked_profile_id: Optional[str] = None
    status: str = "aktif"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[Role] = None
    linked_profile_id: Optional[str] = None
    status: Optional[str] = None

class SchoolIn(BaseModel):
    npsn: str
    school_name: str
    district: str = "Kabupaten Bandung Barat"
    subdistrict: str
    address: str = ""
    status: str = "aktif"

class TeacherIn(BaseModel):
    user_id: Optional[str] = None
    school_id: Optional[str] = None
    name: str
    nip: str = ""
    subject: str = "PJOK"
    grade_level: str = "SD"
    employment_status: Literal["PNS", "Non PNS"] = "PNS"
    status: str = "aktif"

class SupervisorIn(BaseModel):
    user_id: Optional[str] = None
    name: str
    nip: str = ""
    work_area: str = ""
    status: str = "aktif"

class PrincipalIn(BaseModel):
    user_id: Optional[str] = None
    school_id: Optional[str] = None
    name: str
    nip: str = ""
    status: str = "aktif"

class PermissionUpdate(BaseModel):
    can_create: bool = False
    can_read: bool = False
    can_update: bool = False
    can_delete: bool = False

# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------
@api.post("/auth/login")
async def login(body: LoginIn):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Email atau kata sandi salah")
    if user.get("status") != "aktif":
        raise HTTPException(status_code=403, detail="Akun tidak aktif")
    token = create_access_token(user["id"], user["role"])
    await audit(user["id"], "login", "users", user["id"], None, None)
    return {"access_token": token, "token_type": "bearer", "user": clean(user)}

@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return user

# ---------------------------------------------------------------------------
# DASHBOARD STATS
# ---------------------------------------------------------------------------
@api.get("/dashboard/stats")
async def dashboard_stats(user=Depends(get_current_user)):
    role = user["role"]
    active = await _get_active_period() if "_get_active_period" in globals() else None
    active_id = (active or {}).get("id")
    if role == "admin":
        total_teachers = await db.teachers.count_documents({"status": "aktif"})
        with_assignment = complete_assignment = 0
        total_kepsek = total_pengawas = 0
        missing_kepsek = missing_pengawas = total_teachers
        belum = draft = 0
        if active_id:
            with_assignment = len(await db.assessment_assignments.distinct("teacher_id", {"assessment_period_id": active_id, "assignment_type": "Penilaian Utama"}))
            kepsek_ids = set(await db.assessment_assignments.distinct("teacher_id", {"assessment_period_id": active_id, "assignment_type": "Penilaian Utama", "assessor_role": "Kepala Sekolah"}))
            pengawas_ids = set(await db.assessment_assignments.distinct("teacher_id", {"assessment_period_id": active_id, "assignment_type": "Penilaian Utama", "assessor_role": "Pengawas"}))
            complete_assignment = len(kepsek_ids & pengawas_ids)
            total_kepsek = await db.assessment_assignments.count_documents({"assessment_period_id": active_id, "assignment_type": "Penilaian Utama", "assessor_role": "Kepala Sekolah"})
            total_pengawas = await db.assessment_assignments.count_documents({"assessment_period_id": active_id, "assignment_type": "Penilaian Utama", "assessor_role": "Pengawas"})
            missing_kepsek = max(total_teachers - len(kepsek_ids), 0)
            missing_pengawas = max(total_teachers - len(pengawas_ids), 0)
            belum = await db.assessment_assignments.count_documents({"assessment_period_id": active_id, "status": "Belum Dimulai"})
            draft = await db.assessment_assignments.count_documents({"assessment_period_id": active_id, "status": "Draft"})
        return {
            "total_sekolah": await db.schools.count_documents({"status": "aktif"}),
            "total_guru": total_teachers,
            "total_pengawas": await db.supervisors.count_documents({"status": "aktif"}),
            "total_kepala_sekolah": await db.principals.count_documents({"status": "aktif"}),
            "total_user_aktif": await db.users.count_documents({"status": "aktif"}),
            "total_assignment_periode_aktif": (await db.assessment_assignments.count_documents({"assessment_period_id": active_id})) if active_id else 0,
            "assignment_belum_dimulai": belum,
            "assignment_draft": draft,
            "guru_sudah_assignment": with_assignment,
            "guru_belum_assignment": max(total_teachers - with_assignment, 0),
            "total_assignment_kepala_sekolah": total_kepsek,
            "total_assignment_pengawas": total_pengawas,
            "guru_assignment_lengkap": complete_assignment,
            "guru_belum_assignment_kepala_sekolah": missing_kepsek,
            "guru_belum_assignment_pengawas": missing_pengawas,
        }
    if role == "pengawas":
        sup = await db.supervisors.find_one({"user_id": user["id"]}, {"_id": 0})
        if not sup and user.get("linked_profile_id"):
            sup = await db.supervisors.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        work_area = (sup or {}).get("work_area", "")
        school_query = {"status": "aktif"}
        if work_area:
            school_query["subdistrict"] = work_area
        sekolah_count = await db.schools.count_documents(school_query)
        school_ids = [s["id"] async for s in db.schools.find(school_query, {"id": 1, "_id": 0})]
        guru_count = await db.teachers.count_documents({"school_id": {"$in": school_ids}, "status": "aktif"}) if school_ids else 0
        mine = belum = draft = 0
        if active_id:
            mine = await db.assessment_assignments.count_documents({"assessor_user_id": user["id"], "assessment_period_id": active_id})
            belum = await db.assessment_assignments.count_documents({"assessor_user_id": user["id"], "assessment_period_id": active_id, "status": "Belum Dimulai"})
            draft = await db.assessment_assignments.count_documents({"assessor_user_id": user["id"], "assessment_period_id": active_id, "status": "Draft"})
        return {
            "total_sekolah_wilayah": sekolah_count,
            "total_guru_wilayah": guru_count,
            "wilayah_kerja": work_area or "Belum diatur",
            "assignment_saya": mine,
            "assignment_belum_dimulai": belum,
            "assignment_draft": draft,
        }
    if role == "kepala_sekolah":
        prin = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not prin and user.get("linked_profile_id"):
            prin = await db.principals.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        school_id = (prin or {}).get("school_id")
        guru_count = await db.teachers.count_documents({"school_id": school_id, "status": "aktif"}) if school_id else 0
        sekolah = await db.schools.find_one({"id": school_id}, {"_id": 0}) if school_id else None
        with_a = without_a = draft = 0
        if active_id and school_id:
            assigned_ids = await db.assessment_assignments.distinct("teacher_id", {"school_id": school_id, "assessment_period_id": active_id, "assignment_type": "Penilaian Utama"})
            with_a = len(assigned_ids)
            without_a = max(guru_count - with_a, 0)
            draft = await db.assessment_assignments.count_documents({"school_id": school_id, "assessment_period_id": active_id, "status": "Draft"})
        return {
            "total_guru_sekolah": guru_count,
            "nama_sekolah": (sekolah or {}).get("school_name", "Belum diatur"),
            "guru_sudah_assignment": with_a,
            "guru_belum_assignment": without_a,
            "assignment_draft": draft,
        }
    # guru
    teacher = await db.teachers.find_one({"user_id": user["id"]}, {"_id": 0})
    if not teacher and user.get("linked_profile_id"):
        teacher = await db.teachers.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
    school = await db.schools.find_one({"id": (teacher or {}).get("school_id")}, {"_id": 0}) if teacher else None
    my_assignment = None
    my_assignments = []
    if teacher and active_id:
        my_assignments = await db.assessment_assignments.find({"teacher_id": teacher["id"], "assessment_period_id": active_id}, {"_id": 0}).sort("assessor_role", 1).to_list(10)
        if my_assignments:
            await _enrich_assignments(my_assignments)
            my_assignment = my_assignments[0]
    return {
        "profil": teacher,
        "sekolah": school,
        "mata_pelajaran": (teacher or {}).get("subject", "PJOK"),
        "my_assignment": my_assignment,
        "my_assignments": my_assignments,
    }

# ---------------------------------------------------------------------------
# USERS CRUD (admin only)
# ---------------------------------------------------------------------------
@api.get("/users")
async def list_users(user=Depends(require_roles("admin"))):
    items = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(2000)
    return items

@api.post("/users", response_model=UserOut)
async def create_user(body: UserCreate, user=Depends(require_roles("admin"))):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "email": email,
        "password_hash": hash_password(body.password),
        "role": body.role,
        "linked_profile_id": body.linked_profile_id,
        "status": body.status,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await sync_user_profile_link(doc["id"], body.role, body.linked_profile_id, None)
    await audit(user["id"], "create", "users", doc["id"], None, {"email": email, "role": body.role})
    return clean(doc)

@api.put("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, user=Depends(require_roles("admin"))):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if "password" in upd:
        upd["password_hash"] = hash_password(upd.pop("password"))
    if "email" in upd:
        upd["email"] = upd["email"].lower().strip()
        if upd["email"] != existing["email"] and await db.users.find_one({"email": upd["email"]}):
            raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    upd["updated_at"] = now_iso()
    await db.users.update_one({"id": user_id}, {"$set": upd})
    # sync profile link if role or linked_profile_id changed
    new_role = upd.get("role", existing["role"])
    if "linked_profile_id" in upd or "role" in upd:
        await sync_user_profile_link(
            user_id,
            new_role,
            upd.get("linked_profile_id", existing.get("linked_profile_id")),
            existing.get("linked_profile_id"),
        )
    new_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    await audit(user["id"], "update", "users", user_id, {"email": existing["email"]}, upd)
    return new_doc

@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus akun sendiri")
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    await db.users.delete_one({"id": user_id})
    await audit(user["id"], "delete", "users", user_id, {"email": existing["email"]}, None)
    return {"ok": True}

# ---------------------------------------------------------------------------
# SCHOOLS
# ---------------------------------------------------------------------------
@api.get("/schools")
async def list_schools(user=Depends(get_current_user)):
    return await db.schools.find({}, {"_id": 0}).to_list(2000)

@api.post("/schools")
async def create_school(body: SchoolIn, user=Depends(require_roles("admin"))):
    if await db.schools.find_one({"npsn": body.npsn}):
        raise HTTPException(status_code=400, detail="NPSN sudah terdaftar")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.schools.insert_one(doc)
    await audit(user["id"], "create", "schools", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/schools/{sid}")
async def update_school(sid: str, body: SchoolIn, user=Depends(require_roles("admin"))):
    existing = await db.schools.find_one({"id": sid})
    if not existing:
        raise HTTPException(status_code=404, detail="Sekolah tidak ditemukan")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.schools.update_one({"id": sid}, {"$set": upd})
    await audit(user["id"], "update", "schools", sid, clean(existing), upd)
    new_doc = await db.schools.find_one({"id": sid}, {"_id": 0})
    return new_doc

@api.delete("/schools/{sid}")
async def delete_school(sid: str, user=Depends(require_roles("admin"))):
    existing = await db.schools.find_one({"id": sid})
    if not existing:
        raise HTTPException(status_code=404, detail="Sekolah tidak ditemukan")
    await db.schools.delete_one({"id": sid})
    await audit(user["id"], "delete", "schools", sid, clean(existing), None)
    return {"ok": True}

# ---------------------------------------------------------------------------
# TEACHERS
# ---------------------------------------------------------------------------
@api.get("/teachers")
async def list_teachers(user=Depends(get_current_user)):
    role = user["role"]
    if role == "admin":
        items = await db.teachers.find({}, {"_id": 0}).to_list(2000)
    elif role == "pengawas":
        sup = await db.supervisors.find_one({"user_id": user["id"]}, {"_id": 0})
        work_area = (sup or {}).get("work_area", "")
        school_query = {"status": "aktif"}
        if work_area:
            school_query["subdistrict"] = work_area
        school_ids = [s["id"] async for s in db.schools.find(school_query, {"id": 1, "_id": 0})]
        items = await db.teachers.find({"school_id": {"$in": school_ids}}, {"_id": 0}).to_list(2000) if school_ids else []
    elif role == "kepala_sekolah":
        prin = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        school_id = (prin or {}).get("school_id")
        items = await db.teachers.find({"school_id": school_id}, {"_id": 0}).to_list(2000) if school_id else []
    else:  # guru
        items = await db.teachers.find({"user_id": user["id"]}, {"_id": 0}).to_list(2000)
    for item in items:
        item["employment_status"] = normalize_employment_status(item.get("employment_status"))
    return items

@api.post("/teachers")
async def create_teacher(body: TeacherIn, user=Depends(require_roles("admin"))):
    doc = body.model_dump()
    doc["employment_status"] = normalize_employment_status(doc.get("employment_status"))
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.teachers.insert_one(doc)
    if doc.get("user_id"):
        await db.users.update_one({"id": doc["user_id"]}, {"$set": {"linked_profile_id": doc["id"], "updated_at": now_iso()}})
    await audit(user["id"], "create", "teachers", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/teachers/{tid}")
async def update_teacher(tid: str, body: TeacherIn, user=Depends(require_roles("admin"))):
    existing = await db.teachers.find_one({"id": tid})
    if not existing:
        raise HTTPException(status_code=404, detail="Guru tidak ditemukan")
    upd = body.model_dump()
    upd["employment_status"] = normalize_employment_status(upd.get("employment_status"))
    upd["updated_at"] = now_iso()
    await db.teachers.update_one({"id": tid}, {"$set": upd})
    if upd.get("user_id"):
        await db.users.update_one({"id": upd["user_id"]}, {"$set": {"linked_profile_id": tid}})
    await audit(user["id"], "update", "teachers", tid, clean(existing), upd)
    return await db.teachers.find_one({"id": tid}, {"_id": 0})

@api.delete("/teachers/{tid}")
async def delete_teacher(tid: str, user=Depends(require_roles("admin"))):
    existing = await db.teachers.find_one({"id": tid})
    if not existing:
        raise HTTPException(status_code=404, detail="Guru tidak ditemukan")
    await db.teachers.delete_one({"id": tid})
    await audit(user["id"], "delete", "teachers", tid, clean(existing), None)
    return {"ok": True}

# ---------------------------------------------------------------------------
# SUPERVISORS
# ---------------------------------------------------------------------------
@api.get("/supervisors")
async def list_supervisors(user=Depends(require_roles("admin", "pengawas"))):
    if user["role"] == "pengawas":
        items = await db.supervisors.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    else:
        items = await db.supervisors.find({}, {"_id": 0}).to_list(2000)
    return items

@api.post("/supervisors")
async def create_supervisor(body: SupervisorIn, user=Depends(require_roles("admin"))):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.supervisors.insert_one(doc)
    if doc.get("user_id"):
        await db.users.update_one({"id": doc["user_id"]}, {"$set": {"linked_profile_id": doc["id"]}})
    await audit(user["id"], "create", "supervisors", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/supervisors/{sid}")
async def update_supervisor(sid: str, body: SupervisorIn, user=Depends(require_roles("admin"))):
    existing = await db.supervisors.find_one({"id": sid})
    if not existing:
        raise HTTPException(status_code=404, detail="Pengawas tidak ditemukan")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.supervisors.update_one({"id": sid}, {"$set": upd})
    if upd.get("user_id"):
        await db.users.update_one({"id": upd["user_id"]}, {"$set": {"linked_profile_id": sid}})
    await audit(user["id"], "update", "supervisors", sid, clean(existing), upd)
    return await db.supervisors.find_one({"id": sid}, {"_id": 0})

@api.delete("/supervisors/{sid}")
async def delete_supervisor(sid: str, user=Depends(require_roles("admin"))):
    existing = await db.supervisors.find_one({"id": sid})
    if not existing:
        raise HTTPException(status_code=404, detail="Pengawas tidak ditemukan")
    await db.supervisors.delete_one({"id": sid})
    await audit(user["id"], "delete", "supervisors", sid, clean(existing), None)
    return {"ok": True}

# ---------------------------------------------------------------------------
# PRINCIPALS
# ---------------------------------------------------------------------------
@api.get("/principals")
async def list_principals(user=Depends(require_roles("admin", "pengawas", "kepala_sekolah"))):
    if user["role"] == "kepala_sekolah":
        items = await db.principals.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    else:
        items = await db.principals.find({}, {"_id": 0}).to_list(2000)
    return items

@api.post("/principals")
async def create_principal(body: PrincipalIn, user=Depends(require_roles("admin"))):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.principals.insert_one(doc)
    if doc.get("user_id"):
        await db.users.update_one({"id": doc["user_id"]}, {"$set": {"linked_profile_id": doc["id"]}})
    await audit(user["id"], "create", "principals", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/principals/{pid}")
async def update_principal(pid: str, body: PrincipalIn, user=Depends(require_roles("admin"))):
    existing = await db.principals.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Kepala sekolah tidak ditemukan")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.principals.update_one({"id": pid}, {"$set": upd})
    if upd.get("user_id"):
        await db.users.update_one({"id": upd["user_id"]}, {"$set": {"linked_profile_id": pid}})
    await audit(user["id"], "update", "principals", pid, clean(existing), upd)
    return await db.principals.find_one({"id": pid}, {"_id": 0})

@api.delete("/principals/{pid}")
async def delete_principal(pid: str, user=Depends(require_roles("admin"))):
    existing = await db.principals.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Kepala sekolah tidak ditemukan")
    await db.principals.delete_one({"id": pid})
    await audit(user["id"], "delete", "principals", pid, clean(existing), None)
    return {"ok": True}

# ---------------------------------------------------------------------------
# ROLE PERMISSIONS
# ---------------------------------------------------------------------------
@api.get("/permissions")
async def list_permissions(user=Depends(get_current_user)):
    return await db.role_permissions.find({}, {"_id": 0}).to_list(2000)

@api.put("/permissions/{perm_id}")
async def update_permission(perm_id: str, body: PermissionUpdate, user=Depends(require_roles("admin"))):
    existing = await db.role_permissions.find_one({"id": perm_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Permission tidak ditemukan")
    upd = body.model_dump()
    await db.role_permissions.update_one({"id": perm_id}, {"$set": upd})
    await audit(user["id"], "update", "role_permissions", perm_id, clean(existing), upd)
    return await db.role_permissions.find_one({"id": perm_id}, {"_id": 0})

# ---------------------------------------------------------------------------
# Profile (Guru sees own)
# ---------------------------------------------------------------------------
@api.get("/profile/me")
async def my_profile(user=Depends(get_current_user)):
    role = user["role"]
    lpid = user.get("linked_profile_id")
    if role == "guru":
        teacher = await db.teachers.find_one({"user_id": user["id"]}, {"_id": 0})
        if not teacher and lpid:
            teacher = await db.teachers.find_one({"id": lpid}, {"_id": 0})
        school = await db.schools.find_one({"id": (teacher or {}).get("school_id")}, {"_id": 0}) if teacher else None
        return {"user": user, "teacher": teacher, "school": school}
    if role == "pengawas":
        sup = await db.supervisors.find_one({"user_id": user["id"]}, {"_id": 0})
        if not sup and lpid:
            sup = await db.supervisors.find_one({"id": lpid}, {"_id": 0})
        return {"user": user, "supervisor": sup}
    if role == "kepala_sekolah":
        prin = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not prin and lpid:
            prin = await db.principals.find_one({"id": lpid}, {"_id": 0})
        school = await db.schools.find_one({"id": (prin or {}).get("school_id")}, {"_id": 0}) if prin else None
        return {"user": user, "principal": prin, "school": school}
    return {"user": user}

# =============================================================================
# PHASE 2 — Periode Penilaian & Komponen Observasi PJOK
# =============================================================================

class AcademicYearIn(BaseModel):
    year_name: str
    start_date: str = ""
    end_date: str = ""
    status: str = "aktif"

class SemesterIn(BaseModel):
    semester_name: str
    semester_order: int
    status: str = "aktif"

class AssessmentPeriodIn(BaseModel):
    academic_year_id: str
    semester_id: str
    period_name: str
    start_date: str = ""
    end_date: str = ""
    status: str = "aktif"
    is_active: bool = False

class ObservationCategoryIn(BaseModel):
    category_name: str
    description: str = ""
    display_order: int = 0
    status: str = "aktif"

class ObservationAspectIn(BaseModel):
    category_id: str
    aspect_name: str
    aspect_description: str = ""
    display_order: int = 0
    status: str = "aktif"

def _now_doc(extra: dict) -> dict:
    return {**extra, "id": str(uuid.uuid4()), "created_at": now_iso(), "updated_at": now_iso()}

# ---------------- ACADEMIC YEARS ----------------
@api.get("/academic-years")
async def list_academic_years(user=Depends(get_current_user)):
    q = {} if user["role"] == "admin" else {"status": "aktif"}
    return await db.academic_years.find(q, {"_id": 0}).sort("year_name", -1).to_list(1000)

@api.post("/academic-years")
async def create_academic_year(body: AcademicYearIn, user=Depends(require_roles("admin"))):
    if await db.academic_years.find_one({"year_name": body.year_name}):
        raise HTTPException(status_code=400, detail="Tahun ajaran sudah terdaftar")
    doc = _now_doc(body.model_dump())
    await db.academic_years.insert_one(doc)
    await audit(user["id"], "create", "academic_years", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/academic-years/{yid}")
async def update_academic_year(yid: str, body: AcademicYearIn, user=Depends(require_roles("admin"))):
    existing = await db.academic_years.find_one({"id": yid})
    if not existing:
        raise HTTPException(status_code=404, detail="Tahun ajaran tidak ditemukan")
    if body.year_name != existing["year_name"] and await db.academic_years.find_one({"year_name": body.year_name}):
        raise HTTPException(status_code=400, detail="Tahun ajaran sudah terdaftar")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.academic_years.update_one({"id": yid}, {"$set": upd})
    await audit(user["id"], "update", "academic_years", yid, clean(existing), upd)
    return await db.academic_years.find_one({"id": yid}, {"_id": 0})

@api.delete("/academic-years/{yid}")
async def delete_academic_year(yid: str, user=Depends(require_roles("admin"))):
    existing = await db.academic_years.find_one({"id": yid})
    if not existing:
        raise HTTPException(status_code=404, detail="Tahun ajaran tidak ditemukan")
    if await db.assessment_periods.find_one({"academic_year_id": yid}):
        raise HTTPException(status_code=400, detail="Tahun ajaran masih dipakai oleh periode penilaian")
    await db.academic_years.delete_one({"id": yid})
    await audit(user["id"], "delete", "academic_years", yid, clean(existing), None)
    return {"ok": True}

# ---------------- SEMESTERS ----------------
@api.get("/semesters")
async def list_semesters(user=Depends(get_current_user)):
    q = {} if user["role"] == "admin" else {"status": "aktif"}
    return await db.semesters.find(q, {"_id": 0}).sort("semester_order", 1).to_list(100)

@api.post("/semesters")
async def create_semester(body: SemesterIn, user=Depends(require_roles("admin"))):
    if await db.semesters.find_one({"semester_name": body.semester_name}):
        raise HTTPException(status_code=400, detail="Nama semester sudah terdaftar")
    if await db.semesters.find_one({"semester_order": body.semester_order}):
        raise HTTPException(status_code=400, detail="Urutan semester sudah dipakai")
    doc = _now_doc(body.model_dump())
    await db.semesters.insert_one(doc)
    await audit(user["id"], "create", "semesters", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/semesters/{sid}")
async def update_semester(sid: str, body: SemesterIn, user=Depends(require_roles("admin"))):
    existing = await db.semesters.find_one({"id": sid})
    if not existing:
        raise HTTPException(status_code=404, detail="Semester tidak ditemukan")
    if body.semester_name != existing["semester_name"] and await db.semesters.find_one({"semester_name": body.semester_name}):
        raise HTTPException(status_code=400, detail="Nama semester sudah terdaftar")
    if body.semester_order != existing["semester_order"] and await db.semesters.find_one({"semester_order": body.semester_order}):
        raise HTTPException(status_code=400, detail="Urutan semester sudah dipakai")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.semesters.update_one({"id": sid}, {"$set": upd})
    await audit(user["id"], "update", "semesters", sid, clean(existing), upd)
    return await db.semesters.find_one({"id": sid}, {"_id": 0})

@api.delete("/semesters/{sid}")
async def delete_semester(sid: str, user=Depends(require_roles("admin"))):
    existing = await db.semesters.find_one({"id": sid})
    if not existing:
        raise HTTPException(status_code=404, detail="Semester tidak ditemukan")
    if await db.assessment_periods.find_one({"semester_id": sid}):
        raise HTTPException(status_code=400, detail="Semester masih dipakai oleh periode penilaian")
    await db.semesters.delete_one({"id": sid})
    await audit(user["id"], "delete", "semesters", sid, clean(existing), None)
    return {"ok": True}

# ---------------- ASSESSMENT PERIODS ----------------
@api.get("/assessment-periods")
async def list_periods(user=Depends(get_current_user)):
    q = {} if user["role"] == "admin" else {"is_active": True}
    items = await db.assessment_periods.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    years = {y["id"]: y async for y in db.academic_years.find({}, {"_id": 0})}
    sems = {s["id"]: s async for s in db.semesters.find({}, {"_id": 0})}
    for p in items:
        p["academic_year_name"] = (years.get(p.get("academic_year_id")) or {}).get("year_name")
        p["semester_name"] = (sems.get(p.get("semester_id")) or {}).get("semester_name")
    return items

@api.get("/assessment-periods/active")
async def active_period(user=Depends(get_current_user)):
    p = await db.assessment_periods.find_one({"is_active": True}, {"_id": 0})
    if not p:
        return {"active": None}
    year = await db.academic_years.find_one({"id": p.get("academic_year_id")}, {"_id": 0})
    sem = await db.semesters.find_one({"id": p.get("semester_id")}, {"_id": 0})
    return {
        "active": {
            **p,
            "academic_year_name": (year or {}).get("year_name"),
            "semester_name": (sem or {}).get("semester_name"),
        }
    }

@api.post("/assessment-periods")
async def create_period(body: AssessmentPeriodIn, user=Depends(require_roles("admin"))):
    if not await db.academic_years.find_one({"id": body.academic_year_id}):
        raise HTTPException(status_code=400, detail="Tahun ajaran tidak ditemukan")
    if not await db.semesters.find_one({"id": body.semester_id}):
        raise HTTPException(status_code=400, detail="Semester tidak ditemukan")
    if await db.assessment_periods.find_one({"academic_year_id": body.academic_year_id, "semester_id": body.semester_id}):
        raise HTTPException(status_code=400, detail="Periode untuk tahun ajaran dan semester ini sudah ada")
    doc = _now_doc(body.model_dump())
    if doc.get("is_active"):
        await db.assessment_periods.update_many({}, {"$set": {"is_active": False}})
    await db.assessment_periods.insert_one(doc)
    await audit(user["id"], "create", "assessment_periods", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/assessment-periods/{pid}")
async def update_period(pid: str, body: AssessmentPeriodIn, user=Depends(require_roles("admin"))):
    existing = await db.assessment_periods.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Periode tidak ditemukan")
    dup = await db.assessment_periods.find_one({
        "academic_year_id": body.academic_year_id,
        "semester_id": body.semester_id,
        "id": {"$ne": pid},
    })
    if dup:
        raise HTTPException(status_code=400, detail="Periode untuk tahun ajaran dan semester ini sudah ada")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    if upd.get("is_active"):
        await db.assessment_periods.update_many({"id": {"$ne": pid}}, {"$set": {"is_active": False}})
    await db.assessment_periods.update_one({"id": pid}, {"$set": upd})
    await audit(user["id"], "update", "assessment_periods", pid, clean(existing), upd)
    return await db.assessment_periods.find_one({"id": pid}, {"_id": 0})

@api.post("/assessment-periods/{pid}/activate")
async def activate_period(pid: str, user=Depends(require_roles("admin"))):
    existing = await db.assessment_periods.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Periode tidak ditemukan")
    await db.assessment_periods.update_many({}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await db.assessment_periods.update_one({"id": pid}, {"$set": {"is_active": True, "updated_at": now_iso()}})
    await audit(user["id"], "activate", "assessment_periods", pid, {"is_active": existing.get("is_active")}, {"is_active": True})
    return await db.assessment_periods.find_one({"id": pid}, {"_id": 0})

@api.delete("/assessment-periods/{pid}")
async def delete_period(pid: str, user=Depends(require_roles("admin"))):
    existing = await db.assessment_periods.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Periode tidak ditemukan")
    await db.assessment_periods.delete_one({"id": pid})
    await audit(user["id"], "delete", "assessment_periods", pid, clean(existing), None)
    return {"ok": True}

# ---------------- OBSERVATION CATEGORIES ----------------
@api.get("/observation-categories")
async def list_categories(user=Depends(get_current_user)):
    q = {} if user["role"] == "admin" else {"status": "aktif"}
    return await db.observation_categories.find(q, {"_id": 0}).sort("display_order", 1).to_list(200)

@api.post("/observation-categories")
async def create_category(body: ObservationCategoryIn, user=Depends(require_roles("admin"))):
    if await db.observation_categories.find_one({"category_name": body.category_name}):
        raise HTTPException(status_code=400, detail="Kategori observasi sudah terdaftar")
    doc = _now_doc(body.model_dump())
    await db.observation_categories.insert_one(doc)
    await audit(user["id"], "create", "observation_categories", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/observation-categories/{cid}")
async def update_category(cid: str, body: ObservationCategoryIn, user=Depends(require_roles("admin"))):
    existing = await db.observation_categories.find_one({"id": cid})
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    if body.category_name != existing["category_name"] and await db.observation_categories.find_one({"category_name": body.category_name}):
        raise HTTPException(status_code=400, detail="Kategori observasi sudah terdaftar")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.observation_categories.update_one({"id": cid}, {"$set": upd})
    await audit(user["id"], "update", "observation_categories", cid, clean(existing), upd)
    return await db.observation_categories.find_one({"id": cid}, {"_id": 0})

@api.delete("/observation-categories/{cid}")
async def delete_category(cid: str, user=Depends(require_roles("admin"))):
    existing = await db.observation_categories.find_one({"id": cid})
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")
    if await db.observation_aspects.find_one({"category_id": cid}):
        raise HTTPException(status_code=400, detail="Kategori masih memiliki aspek penilaian")
    await db.observation_categories.delete_one({"id": cid})
    await audit(user["id"], "delete", "observation_categories", cid, clean(existing), None)
    return {"ok": True}

# ---------------- OBSERVATION ASPECTS ----------------
@api.get("/observation-aspects")
async def list_aspects(user=Depends(get_current_user)):
    q = {} if user["role"] == "admin" else {"status": "aktif"}
    return await db.observation_aspects.find(q, {"_id": 0}).sort([("category_id", 1), ("display_order", 1)]).to_list(2000)

@api.post("/observation-aspects")
async def create_aspect(body: ObservationAspectIn, user=Depends(require_roles("admin"))):
    if not body.aspect_name.strip():
        raise HTTPException(status_code=400, detail="Nama aspek tidak boleh kosong")
    if not await db.observation_categories.find_one({"id": body.category_id}):
        raise HTTPException(status_code=400, detail="Kategori observasi tidak ditemukan")
    doc = _now_doc(body.model_dump())
    await db.observation_aspects.insert_one(doc)
    await audit(user["id"], "create", "observation_aspects", doc["id"], None, doc)
    doc.pop("_id", None)
    return doc

@api.put("/observation-aspects/{aid}")
async def update_aspect(aid: str, body: ObservationAspectIn, user=Depends(require_roles("admin"))):
    existing = await db.observation_aspects.find_one({"id": aid})
    if not existing:
        raise HTTPException(status_code=404, detail="Aspek tidak ditemukan")
    if not body.aspect_name.strip():
        raise HTTPException(status_code=400, detail="Nama aspek tidak boleh kosong")
    if not await db.observation_categories.find_one({"id": body.category_id}):
        raise HTTPException(status_code=400, detail="Kategori observasi tidak ditemukan")
    upd = body.model_dump()
    upd["updated_at"] = now_iso()
    await db.observation_aspects.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "update", "observation_aspects", aid, clean(existing), upd)
    return await db.observation_aspects.find_one({"id": aid}, {"_id": 0})

@api.delete("/observation-aspects/{aid}")
async def delete_aspect(aid: str, user=Depends(require_roles("admin"))):
    existing = await db.observation_aspects.find_one({"id": aid})
    if not existing:
        raise HTTPException(status_code=404, detail="Aspek tidak ditemukan")
    await db.observation_aspects.delete_one({"id": aid})
    await audit(user["id"], "delete", "observation_aspects", aid, clean(existing), None)
    return {"ok": True}




# =============================================================================
# PHASE 3 — Assignment Penilaian
# =============================================================================

ASSIGNMENT_FINAL = {"Final", "Selesai"}
EDITABLE_SCORE_STATUSES = {"Draft", "Draft Revisi"}
REVIEW_VISIBLE_STATUSES = {"Menunggu Review Guru", "Feedback dari Guru", "Draft Revisi", "Final"}
REVIEW_COMPLETE_STATUSES = {"Disetujui Guru", "Feedback Maksimal Diproses", "Selesai"}
REVIEW_BEFORE_FINAL_MESSAGE = "Penilaian harus dikirim dan disetujui oleh Guru terlebih dahulu sebelum RTL dapat difinalisasi."

class AssignmentCreate(BaseModel):
    teacher_id: str
    assessor_user_id: str
    assessment_period_id: Optional[str] = None  # default = active
    observation_date: Optional[str] = ""
    assignment_type: str = "Penilaian Utama"
    notes: Optional[str] = ""

class AssignmentUpdate(BaseModel):
    teacher_id: Optional[str] = None
    assessor_user_id: Optional[str] = None
    observation_date: Optional[str] = None
    notes: Optional[str] = None
    assignment_type: Optional[str] = None

class AssessmentScoreIn(BaseModel):
    aspect_id: str
    score: int = Field(..., ge=1, le=4)
    notes: Optional[str] = ""

class AssessmentScoresSave(BaseModel):
    scores: List[AssessmentScoreIn] = []

class TeacherFeedbackIn(BaseModel):
    feedback_text: str

class AdminReasonIn(BaseModel):
    reason: str
    notes: Optional[str] = ""

class EvaluationFollowupIn(BaseModel):
    kesimpulan_hasil_observasi: Optional[str] = ""
    aspek_kelebihan: Optional[str] = ""
    aspek_perlu_perbaikan: Optional[str] = ""
    penyebab_kendala: Optional[str] = ""
    rekomendasi_umum: Optional[str] = ""
    kegiatan_pembinaan: Optional[str] = ""
    sasaran_target: Optional[str] = ""
    waktu_pelaksanaan: Optional[str] = ""
    keterangan: Optional[str] = ""
    status_rtl: Literal["Belum Dimulai", "Dalam Proses", "Selesai"] = "Belum Dimulai"

class DigitalSignatureIn(BaseModel):
    signature_image: str

class ProposedAspectCreate(BaseModel):
    category_id: str
    aspect_name: str
    aspect_description: Optional[str] = ""
    reason: Optional[str] = ""
    assignment_id: Optional[str] = None

class ProposedAspectUpdate(BaseModel):
    category_id: Optional[str] = None
    aspect_name: Optional[str] = None
    aspect_description: Optional[str] = None
    reason: Optional[str] = None
    assignment_id: Optional[str] = None

class ProposedAspectReview(BaseModel):
    status: Literal["Approved", "Rejected"]
    review_notes: Optional[str] = ""

async def _get_active_period():
    return await db.assessment_periods.find_one({"is_active": True}, {"_id": 0})

def _assessor_role_label(assessor: dict) -> str:
    return "Pengawas" if assessor.get("role") == "pengawas" else "Kepala Sekolah"

async def _principal_assessor_for_school(school_id: Optional[str]):
    if not school_id:
        return None
    principals = await db.principals.find({"school_id": school_id, "status": "aktif"}, {"_id": 0}).to_list(20)
    for principal in principals:
        if not principal.get("user_id"):
            continue
        user = await db.users.find_one({"id": principal["user_id"], "role": "kepala_sekolah", "status": "aktif"}, {"_id": 0, "password_hash": 0})
        if user:
            return {"id": user["id"], "name": user["name"], "email": user.get("email"), "role": user["role"], "profile_id": principal["id"]}
    return None

async def _supervisor_assessors_for_school(school: Optional[dict]):
    if not school:
        return []
    subdistrict = (school or {}).get("subdistrict")
    if not subdistrict:
        return []
    supervisors = await db.supervisors.find({"work_area": subdistrict, "status": "aktif"}, {"_id": 0}).to_list(100)
    out = []
    for supervisor in supervisors:
        if not supervisor.get("user_id"):
            continue
        user = await db.users.find_one({"id": supervisor["user_id"], "role": "pengawas", "status": "aktif"}, {"_id": 0, "password_hash": 0})
        if user:
            out.append({
                "id": user["id"],
                "name": user["name"],
                "email": user.get("email"),
                "role": user["role"],
                "profile_id": supervisor["id"],
                "work_area": supervisor.get("work_area"),
            })
    return out

async def _enrich_assignments(items):
    if not items:
        return items
    a_ids = {x.get("id") for x in items}
    t_ids = {x.get("teacher_id") for x in items}
    s_ids = {x.get("school_id") for x in items}
    u_ids = {x.get("assessor_user_id") for x in items}
    p_ids = {x.get("assessment_period_id") for x in items}
    teachers = {t["id"]: t async for t in db.teachers.find({"id": {"$in": list(t_ids)}}, {"_id": 0})}
    schools = {s["id"]: s async for s in db.schools.find({"id": {"$in": list(s_ids)}}, {"_id": 0})}
    users = {u["id"]: u async for u in db.users.find({"id": {"$in": list(u_ids)}}, {"_id": 0, "password_hash": 0})}
    periods = {p["id"]: p async for p in db.assessment_periods.find({"id": {"$in": list(p_ids)}}, {"_id": 0})}
    score_counts = {}
    pipeline = [
        {"$match": {"assignment_id": {"$in": list(a_ids)}}},
        {"$group": {"_id": "$assignment_id", "count": {"$sum": 1}}},
    ]
    async for row in db.assessment_scores.aggregate(pipeline):
        score_counts[row["_id"]] = row["count"]
    active_aspects = await db.observation_aspects.find({"status": "aktif"}, {"_id": 0, "id": 1}).to_list(2000)
    active_aspect_ids = {a["id"] for a in active_aspects}
    max_score = len(active_aspect_ids) * 4
    score_totals = {aid: 0 for aid in a_ids}
    async for score in db.assessment_scores.find({"assignment_id": {"$in": list(a_ids)}}, {"_id": 0}):
        if score.get("aspect_id") in active_aspect_ids and isinstance(score.get("score"), int):
            score_totals[score.get("assignment_id")] = score_totals.get(score.get("assignment_id"), 0) + score["score"]
    for it in items:
        t = teachers.get(it.get("teacher_id"))
        s = schools.get(it.get("school_id"))
        u = users.get(it.get("assessor_user_id"))
        p = periods.get(it.get("assessment_period_id"))
        it["teacher_name"] = (t or {}).get("name")
        it["teacher_nip"] = (t or {}).get("nip")
        it["school_name"] = (s or {}).get("school_name")
        it["assessor_name"] = (u or {}).get("name")
        it["period_name"] = (p or {}).get("period_name")
        it["period_is_active"] = (p or {}).get("is_active", False)
        it["feedback_count"] = int(it.get("feedback_count") or 0)
        it["score_count"] = score_counts.get(it.get("id"), 0)
        it["final_percentage"] = round((score_totals.get(it.get("id"), 0) / max_score) * 100, 2) if max_score else 0
    return items

async def _validate_assignment(teacher_id, assessor_user_id, period_id, creator):
    """Returns (teacher, assessor_user, period) tuple or raises HTTPException."""
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise HTTPException(status_code=404, detail="Guru tidak ditemukan")
    if teacher.get("status") != "aktif":
        raise HTTPException(status_code=400, detail="Guru yang dipilih tidak aktif")

    assessor = await db.users.find_one({"id": assessor_user_id}, {"_id": 0, "password_hash": 0})
    if not assessor:
        raise HTTPException(status_code=404, detail="Penilai tidak ditemukan")
    if assessor.get("role") not in ("pengawas", "kepala_sekolah"):
        raise HTTPException(status_code=400, detail="Penilai harus Pengawas atau Kepala Sekolah")
    if assessor.get("status") != "aktif":
        raise HTTPException(status_code=400, detail="Akun penilai tidak aktif")

    period = await db.assessment_periods.find_one({"id": period_id}, {"_id": 0}) if period_id else await _get_active_period()
    if not period:
        raise HTTPException(status_code=400, detail="Belum ada periode penilaian aktif.")

    # If creator is kepsek, check their school first (403)
    if creator["role"] == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": creator["id"]}, {"_id": 0})
        if not principal and creator.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": creator["linked_profile_id"]}, {"_id": 0})
        creator_school = (principal or {}).get("school_id")
        if not creator_school or creator_school != teacher.get("school_id"):
            raise HTTPException(status_code=403, detail="Anda hanya boleh membuat assignment untuk guru di sekolah Anda")

    school = await db.schools.find_one({"id": teacher.get("school_id")}, {"_id": 0})

    # If assessor is kepsek, school must match
    if assessor.get("role") == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": assessor_user_id}, {"_id": 0})
        if not principal and assessor.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": assessor["linked_profile_id"]}, {"_id": 0})
        kepsek_school = (principal or {}).get("school_id")
        if not kepsek_school or kepsek_school != teacher.get("school_id"):
            raise HTTPException(status_code=400, detail="Kepala Sekolah hanya boleh menilai guru di sekolahnya sendiri")
    elif assessor.get("role") == "pengawas":
        supervisor = await db.supervisors.find_one({"user_id": assessor_user_id}, {"_id": 0})
        if not supervisor and assessor.get("linked_profile_id"):
            supervisor = await db.supervisors.find_one({"id": assessor["linked_profile_id"]}, {"_id": 0})
        work_area = (supervisor or {}).get("work_area")
        if not work_area or not school or work_area != school.get("subdistrict"):
            raise HTTPException(status_code=400, detail="Pengawas hanya boleh menilai guru pada wilayah sekolah yang sesuai")

    return teacher, assessor, period

async def _scope_for_role(user):
    """Returns a Mongo query filter based on user role."""
    role = user["role"]
    if role == "admin":
        return {}
    if role == "pengawas":
        return {"assessor_user_id": user["id"]}
    if role == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not principal and user.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        school_id = (principal or {}).get("school_id")
        return {"school_id": school_id} if school_id else {"school_id": "__none__"}
    # guru
    teacher = await db.teachers.find_one({"user_id": user["id"]}, {"_id": 0})
    if not teacher and user.get("linked_profile_id"):
        teacher = await db.teachers.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
    tid = (teacher or {}).get("id")
    return {"teacher_id": tid} if tid else {"teacher_id": "__none__"}

def _normalize_aspect_name(name: str) -> str:
    return " ".join((name or "").strip().lower().split())

async def _teacher_for_user(user: dict):
    teacher = await db.teachers.find_one({"user_id": user["id"]}, {"_id": 0})
    if not teacher and user.get("linked_profile_id"):
        teacher = await db.teachers.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
    return teacher

async def _teacher_user_id(teacher_id: Optional[str]) -> Optional[str]:
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0}) if teacher_id else None
    return (teacher or {}).get("user_id")

async def _assert_force_final_ready(aid: str, assignment: dict):
    completion = await _official_score_completion(aid)
    if completion["required"] < 1 or completion["missing"] > 0:
        raise HTTPException(status_code=400, detail="Force Final ditolak: semua aspek resmi wajib diberi skor.")
    await _assert_evaluation_complete_for_final(aid)
    await _assert_signature(aid, assignment["assessor_user_id"])
    teacher_user_id = await _teacher_user_id(assignment.get("teacher_id"))
    if teacher_user_id:
        await _assert_signature(aid, teacher_user_id, "guru")
    return True

def _assignment_review_complete(assignment: dict) -> bool:
    return bool(assignment.get("teacher_review_completed")) or assignment.get("teacher_review_status") in REVIEW_COMPLETE_STATUSES

async def _assert_review_complete_for_final(assignment: dict):
    if not _assignment_review_complete(assignment):
        raise HTTPException(status_code=400, detail=REVIEW_BEFORE_FINAL_MESSAGE)
    return True

async def _active_proposal_assignment_for_teacher(teacher_id: str, period_id: str, assignment_id: Optional[str] = None):
    query = {
        "teacher_id": teacher_id,
        "assessment_period_id": period_id,
        "status": {"$nin": list(ASSIGNMENT_FINAL)},
    }
    if assignment_id:
        query["id"] = assignment_id
    assignments = await db.assessment_assignments.find(query, {"_id": 0}).sort("created_at", 1).to_list(20)
    if not assignments:
        raise HTTPException(status_code=400, detail="Guru belum memiliki assignment aktif yang dapat menerima usulan aspek")
    drafts = [a for a in assignments if a.get("status") == "Draft"]
    return (drafts or assignments)[0], assignments

async def _review_scope_for_proposals(user: dict):
    if user["role"] == "admin":
        return {}
    if user["role"] == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not principal and user.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        school_id = (principal or {}).get("school_id")
        return {"school_id": school_id} if school_id else {"school_id": "__none__"}
    if user["role"] == "pengawas":
        assignment_ids = await db.assessment_assignments.distinct("id", {"assessor_user_id": user["id"]})
        return {"assignment_id": {"$in": assignment_ids or ["__none__"]}}
    raise HTTPException(status_code=403, detail="Role Anda tidak berhak mereview usulan aspek")

async def _assert_can_review_proposal(proposal: dict, user: dict):
    scope = await _review_scope_for_proposals(user)
    if not scope:
        return
    if "school_id" in scope and proposal.get("school_id") != scope["school_id"]:
        raise HTTPException(status_code=403, detail="Anda hanya boleh mereview usulan dari sekolah Anda")
    if "assignment_id" in scope and proposal.get("assignment_id") not in scope["assignment_id"].get("$in", []):
        raise HTTPException(status_code=403, detail="Anda hanya boleh mereview usulan dari assignment yang diberikan kepada Anda")

async def _enrich_proposed_aspects(items):
    if not items:
        return items
    t_ids = {x.get("teacher_id") for x in items}
    s_ids = {x.get("school_id") for x in items}
    p_ids = {x.get("assessment_period_id") for x in items}
    c_ids = {x.get("category_id") for x in items}
    a_ids = {x.get("assignment_id") for x in items}
    r_ids = {x.get("reviewed_by") for x in items if x.get("reviewed_by")}
    teachers = {t["id"]: t async for t in db.teachers.find({"id": {"$in": list(t_ids)}}, {"_id": 0})}
    schools = {s["id"]: s async for s in db.schools.find({"id": {"$in": list(s_ids)}}, {"_id": 0})}
    periods = {p["id"]: p async for p in db.assessment_periods.find({"id": {"$in": list(p_ids)}}, {"_id": 0})}
    categories = {c["id"]: c async for c in db.observation_categories.find({"id": {"$in": list(c_ids)}}, {"_id": 0})}
    assignments = {a["id"]: a async for a in db.assessment_assignments.find({"id": {"$in": list(a_ids)}}, {"_id": 0})}
    reviewers = {u["id"]: u async for u in db.users.find({"id": {"$in": list(r_ids)}}, {"_id": 0, "password_hash": 0})} if r_ids else {}
    for it in items:
        teacher = teachers.get(it.get("teacher_id"), {})
        school = schools.get(it.get("school_id"), {})
        period = periods.get(it.get("assessment_period_id"), {})
        category = categories.get(it.get("category_id"), {})
        assignment = assignments.get(it.get("assignment_id"), {})
        reviewer = reviewers.get(it.get("reviewed_by"), {})
        it["teacher_name"] = teacher.get("name")
        it["teacher_nip"] = teacher.get("nip")
        it["school_name"] = school.get("school_name")
        it["period_name"] = period.get("period_name")
        it["category_name"] = category.get("category_name")
        it["assignment_status"] = assignment.get("status")
        it["assignment_assessor_role"] = assignment.get("assessor_role")
        it["reviewer_name"] = reviewer.get("name")
    return items

async def _assignment_for_assessment_form(aid: str, user: dict, require_draft: bool = True):
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if user["role"] == "guru":
        raise HTTPException(status_code=403, detail="Guru tidak dapat mengisi form penilaian")
    if require_draft and assignment.get("status") not in EDITABLE_SCORE_STATUSES:
        raise HTTPException(status_code=400, detail="Skor hanya dapat diedit saat assignment berstatus Draft atau Draft Revisi")
    if not require_draft and assignment.get("status") == "Belum Dimulai":
        raise HTTPException(status_code=400, detail="Form penilaian belum dapat dibuka sebelum assignment dimulai")
    if user["role"] == "pengawas" and assignment.get("assessor_user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Anda hanya dapat membuka assignment yang diberikan kepada Anda")
    if user["role"] == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not principal and user.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        school_id = (principal or {}).get("school_id")
        if not school_id or school_id != assignment.get("school_id"):
            raise HTTPException(status_code=403, detail="Anda hanya dapat membuka assignment guru di sekolah Anda")
        if require_draft and assignment.get("assessor_user_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Anda hanya dapat mengisi assignment yang ditugaskan kepada Anda")
    await _enrich_assignments([assignment])
    return assignment

async def _official_score_completion(assignment_id: str):
    aspects = await db.observation_aspects.find({"status": "aktif"}, {"_id": 0, "id": 1}).to_list(2000)
    required_ids = {a["id"] for a in aspects}
    if not required_ids:
        return {"required": 0, "scored": 0, "missing": 0}
    scores = await db.assessment_scores.find({
        "assignment_id": assignment_id,
        "aspect_id": {"$in": list(required_ids)},
    }, {"_id": 0, "aspect_id": 1, "score": 1}).to_list(2000)
    scored_ids = {s["aspect_id"] for s in scores if isinstance(s.get("score"), int) and 1 <= s["score"] <= 4}
    return {
        "required": len(required_ids),
        "scored": len(scored_ids),
        "missing": max(len(required_ids) - len(scored_ids), 0),
    }

RTL_REQUIRED_FOR_SEND = [
    "kesimpulan_hasil_observasi",
    "aspek_kelebihan",
    "aspek_perlu_perbaikan",
    "rekomendasi_umum",
    "kegiatan_pembinaan",
    "sasaran_target",
    "waktu_pelaksanaan",
    "status_rtl",
]

def _evaluation_is_complete(evaluation: Optional[dict]) -> bool:
    if not evaluation or evaluation.get("is_deleted"):
        return False
    return all((evaluation.get(field) or "").strip() for field in RTL_REQUIRED_FOR_SEND)

async def _active_evaluation_followup(aid: str):
    return await db.evaluation_followups.find_one(
        {"assignment_id": aid, "is_deleted": {"$ne": True}},
        {"_id": 0},
    )

async def _assert_evaluation_complete(aid: str):
    evaluation = await _active_evaluation_followup(aid)
    if not _evaluation_is_complete(evaluation):
        raise HTTPException(status_code=400, detail="Evaluasi dan RTL harus dilengkapi sebelum penilaian dikirim ke Guru.")
    return evaluation

async def _assert_evaluation_complete_for_final(aid: str):
    evaluation = await _active_evaluation_followup(aid)
    if not _evaluation_is_complete(evaluation):
        raise HTTPException(status_code=400, detail="Evaluasi dan RTL harus dilengkapi sebelum penilaian dapat difinalisasi.")
    return evaluation

async def _assignment_for_evaluation(aid: str, user: dict):
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    can_edit = False
    if user["role"] == "admin":
        can_view = True
        can_edit = assignment.get("status") not in ASSIGNMENT_FINAL
    elif user["role"] == "pengawas":
        can_view = assignment.get("assessor_user_id") == user["id"]
        can_edit = can_view
    elif user["role"] == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not principal and user.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        school_id = (principal or {}).get("school_id")
        can_view = bool(school_id and school_id == assignment.get("school_id"))
        can_edit = assignment.get("assessor_user_id") == user["id"]
    elif user["role"] == "guru":
        teacher = await _teacher_for_user(user)
        can_view = bool(teacher and teacher.get("id") == assignment.get("teacher_id"))
    else:
        can_view = False
    if not can_view:
        raise HTTPException(status_code=403, detail="Anda tidak berhak mengakses Evaluasi & RTL assignment ini")
    if assignment.get("status") == "Belum Dimulai":
        raise HTTPException(status_code=400, detail="Evaluasi & RTL belum dapat dibuka sebelum assignment dimulai")
    await _enrich_assignments([assignment])
    return assignment, can_edit

async def _report_scope_for_role(user: dict):
    if user["role"] == "admin":
        return {}
    if user["role"] == "pengawas":
        return {"assessor_user_id": user["id"]}
    if user["role"] == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not principal and user.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        school_id = (principal or {}).get("school_id")
        return {"school_id": school_id} if school_id else {"school_id": "__none__"}
    if user["role"] == "guru":
        teacher = await _teacher_for_user(user)
        teacher_id = (teacher or {}).get("id")
        return {"teacher_id": teacher_id} if teacher_id else {"teacher_id": "__none__"}
    raise HTTPException(status_code=403, detail="Akses report ditolak")

async def _assignment_for_report(aid: str, user: dict):
    scope = await _report_scope_for_role(user)
    assignment = await db.assessment_assignments.find_one({"id": aid, **scope}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Report tidak ditemukan atau Anda tidak memiliki akses")
    if assignment.get("status") == "Belum Dimulai":
        raise HTTPException(status_code=400, detail="Report belum tersedia sebelum assignment dimulai")
    await _enrich_assignments([assignment])
    return assignment

async def _signature_permission(assignment: dict, user: dict):
    if user["role"] == "admin":
        return {"can_view": True, "can_sign": False}
    if user["role"] == "guru":
        teacher = await _teacher_for_user(user)
        owns = bool(teacher and teacher.get("id") == assignment.get("teacher_id"))
        return {"can_view": owns, "can_sign": owns}
    if user["role"] == "pengawas":
        owns = assignment.get("assessor_user_id") == user["id"]
        return {"can_view": owns, "can_sign": owns}
    if user["role"] == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        if not principal and user.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": user["linked_profile_id"]}, {"_id": 0})
        school_id = (principal or {}).get("school_id")
        can_view = bool(school_id and school_id == assignment.get("school_id"))
        can_sign = can_view and (assignment.get("assessor_user_id") == user["id"] or assignment.get("assessor_role") == "Kepala Sekolah")
        return {"can_view": can_view, "can_sign": can_sign}
    return {"can_view": False, "can_sign": False}

async def _assert_signature(aid: str, user_id: str, role: Optional[str] = None):
    query = {"assignment_id": aid, "user_id": user_id, "signature_status": "Sudah Ditandatangani"}
    if role:
        query["signer_role"] = role
    signature = await db.digital_signatures.find_one(query, {"_id": 0})
    if not signature:
        raise HTTPException(status_code=400, detail="Tanda tangan digital wajib diisi sebelum proses ini dapat dilanjutkan.")
    return signature

async def _period_detail(period_id: Optional[str]):
    period = await db.assessment_periods.find_one({"id": period_id}, {"_id": 0}) if period_id else None
    year = await db.academic_years.find_one({"id": (period or {}).get("academic_year_id")}, {"_id": 0}) if period else None
    semester = await db.semesters.find_one({"id": (period or {}).get("semester_id")}, {"_id": 0}) if period else None
    return period, year, semester

async def _period_sort_key(period: dict):
    year = await db.academic_years.find_one({"id": period.get("academic_year_id")}, {"_id": 0}) if period else None
    semester = await db.semesters.find_one({"id": period.get("semester_id")}, {"_id": 0}) if period else None
    return ((year or {}).get("year_name") or "", int((semester or {}).get("semester_order") or 0), period.get("created_at") or "")

async def _previous_period(current_period: dict):
    if not current_period:
        return None
    periods = await db.assessment_periods.find({}, {"_id": 0}).to_list(1000)
    keyed = []
    for period in periods:
        keyed.append((await _period_sort_key(period), period))
    keyed.sort(key=lambda item: item[0])
    current_index = next((idx for idx, (_, p) in enumerate(keyed) if p.get("id") == current_period.get("id")), None)
    if current_index is None or current_index <= 0:
        return None
    return keyed[current_index - 1][1]

def _category_comparison(current_categories: dict, previous_categories: dict):
    out = []
    names = {v.get("category_name") for v in current_categories.values()} | {v.get("category_name") for v in previous_categories.values()}
    for name in sorted([n for n in names if n]):
        current = next((v for v in current_categories.values() if v.get("category_name") == name), {})
        previous = next((v for v in previous_categories.values() if v.get("category_name") == name), {})
        c_val = current.get("average_score")
        p_val = previous.get("average_score")
        diff = round((c_val or 0) - (p_val or 0), 2) if c_val is not None and p_val is not None else None
        label = "Belum ada data pembanding" if diff is None else ("Meningkat" if diff > 0 else "Menurun" if diff < 0 else "Stabil")
        out.append({"category_name": name, "previous": p_val, "current": c_val, "difference": diff, "label": label})
    return out

async def _report_payload(assignment: dict):
    payload = await _assessment_form_payload(assignment)
    period, year, semester = await _period_detail(assignment.get("assessment_period_id"))
    payload["period"] = period
    payload["academic_year"] = year
    payload["semester"] = semester

    same_period = await db.assessment_assignments.find({
        "teacher_id": assignment["teacher_id"],
        "assessment_period_id": assignment["assessment_period_id"],
        "status": {"$ne": "Belum Dimulai"},
    }, {"_id": 0}).to_list(20)
    await _enrich_assignments(same_period)
    period_signatures = await db.digital_signatures.find({
        "assignment_id": {"$in": [a["id"] for a in same_period]},
    }, {"_id": 0}).sort("signed_at", 1).to_list(100)
    values = [float(a.get("final_percentage") or 0) for a in same_period if a.get("final_percentage") is not None]
    payload["combined_summary"] = {
        "items": [{
            "assignment_id": a["id"],
            "assessor_role": a.get("assessor_role"),
            "assessor_name": a.get("assessor_name"),
            "status": a.get("status"),
            "final_percentage": a.get("final_percentage"),
        } for a in same_period],
        "combined_average": round(sum(values) / len(values), 2) if values else 0,
        "count": len(values),
    }
    payload["period_signatures"] = period_signatures

    previous = await _previous_period(period)
    comparison = {
        "label": "Belum ada data pembanding",
        "previous_period": previous,
        "previous_value": None,
        "current_value": payload["summary"]["final_percentage"],
        "difference": None,
        "categories": [],
    }
    if previous:
        previous_assignment = await db.assessment_assignments.find_one({
            "teacher_id": assignment["teacher_id"],
            "assessment_period_id": previous["id"],
            "assessor_role": assignment.get("assessor_role"),
            "status": "Final",
        }, {"_id": 0})
        if previous_assignment:
            await _enrich_assignments([previous_assignment])
            previous_payload = await _assessment_form_payload(previous_assignment)
            prev_value = previous_payload["summary"]["final_percentage"]
            current_value = payload["summary"]["final_percentage"]
            diff = round(current_value - prev_value, 2)
            comparison.update({
                "label": "Meningkat" if diff > 0 else "Menurun" if diff < 0 else "Stabil",
                "previous_value": prev_value,
                "difference": diff,
                "categories": _category_comparison(payload["summary"]["categories"], previous_payload["summary"]["categories"]),
            })
    payload["semester_comparison"] = comparison
    payload["export_requirements"] = _report_export_requirements(payload)
    payload["export_ready"] = all(payload["export_requirements"].values())
    return payload

EXPORT_INCOMPLETE_MESSAGE = "Export PDF hanya tersedia setelah penilaian selesai dan seluruh data wajib sudah lengkap."

def _required_report_signature_roles(assignment: dict):
    roles = ["guru"]
    assessor_role = assignment.get("assessor_role")
    if assessor_role == "Kepala Sekolah":
        roles.append("kepala_sekolah")
    elif assessor_role == "Pengawas":
        roles.append("pengawas")
    return roles

def _report_export_requirements(payload: dict):
    assignment = payload.get("assignment") or {}
    summary = payload.get("summary") or {}
    signatures = payload.get("signatures") or []
    signed_roles = {
        s.get("signer_role")
        for s in signatures
        if s.get("signature_status") == "Sudah Ditandatangani" and s.get("signature_image")
    }
    required_roles = _required_report_signature_roles(assignment)
    return {
        "status_final": assignment.get("status") == "Final",
        "scores_complete": int(summary.get("unscored_count") or 0) == 0 and int(summary.get("aspect_count") or 0) > 0,
        "evaluation_complete": bool(payload.get("evaluation_complete")),
        "required_signatures_complete": all(role in signed_roles for role in required_roles),
    }

async def _teacher_review_assignment(aid: str, user: dict):
    if user["role"] != "guru":
        raise HTTPException(status_code=403, detail="Hanya Guru yang dapat mereview hasil penilaian")
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    teacher = await _teacher_for_user(user)
    if not teacher or assignment.get("teacher_id") != teacher.get("id"):
        raise HTTPException(status_code=403, detail="Anda hanya dapat melihat penilaian milik sendiri")
    if assignment.get("status") not in REVIEW_VISIBLE_STATUSES:
        raise HTTPException(status_code=400, detail="Hasil penilaian belum tersedia untuk direview")
    await _enrich_assignments([assignment])
    return assignment

async def _assessment_form_payload(assignment: dict):
    teacher = await db.teachers.find_one({"id": assignment.get("teacher_id")}, {"_id": 0})
    school = await db.schools.find_one({"id": assignment.get("school_id")}, {"_id": 0})
    assessor = await db.users.find_one({"id": assignment.get("assessor_user_id")}, {"_id": 0, "password_hash": 0})
    categories = await db.observation_categories.find({"status": "aktif"}, {"_id": 0}).sort("display_order", 1).to_list(200)
    aspects = await db.observation_aspects.find({"status": "aktif"}, {"_id": 0}).sort([("category_id", 1), ("display_order", 1)]).to_list(2000)
    proposed_aspects = await db.teacher_proposed_aspects.find({
        "assignment_id": assignment["id"],
        "status": "Approved",
    }, {"_id": 0}).sort("created_at", 1).to_list(2000)
    await _enrich_proposed_aspects(proposed_aspects)
    scores = await db.assessment_scores.find({"assignment_id": assignment["id"]}, {"_id": 0}).to_list(2000)
    feedbacks = await db.teacher_assessment_feedbacks.find({"assignment_id": assignment["id"]}, {"_id": 0}).sort("feedback_round", 1).to_list(10)
    evaluation = await _active_evaluation_followup(assignment["id"])
    signatures = await db.digital_signatures.find({"assignment_id": assignment["id"]}, {"_id": 0}).sort("signed_at", 1).to_list(20)
    score_map = {s["aspect_id"]: s for s in scores}
    active_aspect_ids = {a["id"] for a in aspects}
    active_scores = [s for s in scores if s.get("aspect_id") in active_aspect_ids and isinstance(s.get("score"), int)]
    total_score = sum(s["score"] for s in active_scores)
    scored_count = len(active_scores)
    max_score = len(aspects) * 4
    category_summary = {}
    for category in categories:
        cat_aspects = [a for a in aspects if a.get("category_id") == category["id"]]
        cat_scores = [score_map.get(a["id"], {}).get("score") for a in cat_aspects]
        cat_scores = [s for s in cat_scores if isinstance(s, int)]
        category_summary[category["id"]] = {
            "category_name": category["category_name"],
            "total_score": sum(cat_scores),
            "scored_count": len(cat_scores),
            "aspect_count": len(cat_aspects),
            "average_score": round(sum(cat_scores) / len(cat_scores), 2) if cat_scores else 0,
        }
    return {
        "assignment": assignment,
        "teacher": teacher,
        "school": school,
        "assessor": assessor,
        "categories": categories,
        "aspects": aspects,
        "proposed_aspects": proposed_aspects,
        "scores": scores,
        "feedbacks": feedbacks,
        "signatures": signatures,
        "evaluation_followup": evaluation,
        "evaluation_complete": _evaluation_is_complete(evaluation),
        "summary": {
            "total_score": total_score,
            "scored_count": scored_count,
            "aspect_count": len(aspects),
            "unscored_count": max(len(aspects) - scored_count, 0),
            "average_score": round(total_score / scored_count, 2) if scored_count else 0,
            "max_score": max_score,
            "final_percentage": round((total_score / max_score) * 100, 2) if max_score else 0,
            "categories": category_summary,
        },
    }


@api.get("/proposed-aspects/me")
async def my_proposed_aspects(user=Depends(require_roles("guru"))):
    period = await _get_active_period()
    teacher = await _teacher_for_user(user)
    if not teacher:
        raise HTTPException(status_code=404, detail="Profil guru tidak ditemukan")
    categories = await db.observation_categories.find({"status": "aktif"}, {"_id": 0}).sort("display_order", 1).to_list(200)
    assignments = []
    if period:
        assignments = await db.assessment_assignments.find({
            "teacher_id": teacher["id"],
            "assessment_period_id": period["id"],
        }, {"_id": 0}).sort("created_at", 1).to_list(20)
        await _enrich_assignments(assignments)
    proposals = await db.teacher_proposed_aspects.find({"teacher_id": teacher["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    await _enrich_proposed_aspects(proposals)
    return {
        "active_period": period,
        "teacher": teacher,
        "categories": categories,
        "assignments": assignments,
        "proposals": proposals,
    }

@api.post("/proposed-aspects")
async def create_proposed_aspect(body: ProposedAspectCreate, user=Depends(require_roles("guru"))):
    period = await _get_active_period()
    if not period:
        raise HTTPException(status_code=400, detail="Belum ada periode penilaian aktif")
    teacher = await _teacher_for_user(user)
    if not teacher:
        raise HTTPException(status_code=404, detail="Profil guru tidak ditemukan")
    category = await db.observation_categories.find_one({"id": body.category_id, "status": "aktif"}, {"_id": 0})
    if not category:
        raise HTTPException(status_code=400, detail="Kategori observasi tidak ditemukan atau tidak aktif")
    aspect_name = (body.aspect_name or "").strip()
    if not aspect_name:
        raise HTTPException(status_code=400, detail="Nama aspek wajib diisi")
    assignment, assignments = await _active_proposal_assignment_for_teacher(teacher["id"], period["id"], body.assignment_id)
    if assignment.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Assignment final tidak dapat menerima usulan aspek")
    normalized_name = _normalize_aspect_name(aspect_name)
    duplicate = await db.teacher_proposed_aspects.find_one({
        "teacher_id": teacher["id"],
        "assessment_period_id": period["id"],
        "aspect_name_normalized": normalized_name,
    })
    if duplicate:
        raise HTTPException(status_code=400, detail="Usulan aspek dengan nama yang sama sudah ada pada periode ini")
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher["id"],
        "school_id": teacher.get("school_id"),
        "assessment_period_id": period["id"],
        "assignment_id": assignment["id"],
        "category_id": category["id"],
        "aspect_name": aspect_name,
        "aspect_name_normalized": normalized_name,
        "aspect_description": body.aspect_description or "",
        "reason": body.reason or "",
        "status": "Pending",
        "review_notes": "",
        "reviewed_by": None,
        "reviewed_at": None,
        "include_in_score": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.teacher_proposed_aspects.insert_one(doc)
    await audit(user["id"], "submit", "teacher_proposed_aspects", doc["id"], None, doc)
    doc.pop("_id", None)
    await _enrich_proposed_aspects([doc])
    return doc

@api.put("/proposed-aspects/{pid}")
async def update_proposed_aspect(pid: str, body: ProposedAspectUpdate, user=Depends(require_roles("guru"))):
    existing = await db.teacher_proposed_aspects.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Usulan aspek tidak ditemukan")
    teacher = await _teacher_for_user(user)
    if not teacher or existing.get("teacher_id") != teacher.get("id"):
        raise HTTPException(status_code=403, detail="Anda hanya boleh mengubah usulan milik sendiri")
    if existing.get("status") != "Pending":
        raise HTTPException(status_code=400, detail="Usulan hanya dapat diubah saat status Pending")
    upd = body.model_dump(exclude_unset=True)
    if "category_id" in upd:
        category = await db.observation_categories.find_one({"id": upd["category_id"], "status": "aktif"}, {"_id": 0})
        if not category:
            raise HTTPException(status_code=400, detail="Kategori observasi tidak ditemukan atau tidak aktif")
    if "assignment_id" in upd and upd["assignment_id"]:
        await _active_proposal_assignment_for_teacher(existing["teacher_id"], existing["assessment_period_id"], upd["assignment_id"])
    if "aspect_name" in upd:
        aspect_name = (upd["aspect_name"] or "").strip()
        if not aspect_name:
            raise HTTPException(status_code=400, detail="Nama aspek wajib diisi")
        normalized_name = _normalize_aspect_name(aspect_name)
        duplicate = await db.teacher_proposed_aspects.find_one({
            "teacher_id": existing["teacher_id"],
            "assessment_period_id": existing["assessment_period_id"],
            "aspect_name_normalized": normalized_name,
            "id": {"$ne": pid},
        })
        if duplicate:
            raise HTTPException(status_code=400, detail="Usulan aspek dengan nama yang sama sudah ada pada periode ini")
        upd["aspect_name"] = aspect_name
        upd["aspect_name_normalized"] = normalized_name
    upd["updated_at"] = now_iso()
    await db.teacher_proposed_aspects.update_one({"id": pid}, {"$set": upd})
    await audit(user["id"], "edit", "teacher_proposed_aspects", pid, clean(existing), upd)
    doc = await db.teacher_proposed_aspects.find_one({"id": pid}, {"_id": 0})
    await _enrich_proposed_aspects([doc])
    return doc

@api.post("/proposed-aspects/{pid}/cancel")
async def cancel_proposed_aspect(pid: str, user=Depends(require_roles("guru"))):
    existing = await db.teacher_proposed_aspects.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Usulan aspek tidak ditemukan")
    teacher = await _teacher_for_user(user)
    if not teacher or existing.get("teacher_id") != teacher.get("id"):
        raise HTTPException(status_code=403, detail="Anda hanya boleh membatalkan usulan milik sendiri")
    if existing.get("status") != "Pending":
        raise HTTPException(status_code=400, detail="Usulan hanya dapat dibatalkan saat status Pending")
    upd = {"status": "Cancelled", "updated_at": now_iso()}
    await db.teacher_proposed_aspects.update_one({"id": pid}, {"$set": upd})
    await audit(user["id"], "cancel", "teacher_proposed_aspects", pid, clean(existing), upd)
    doc = await db.teacher_proposed_aspects.find_one({"id": pid}, {"_id": 0})
    await _enrich_proposed_aspects([doc])
    return doc

@api.get("/proposed-aspects/review")
async def list_proposed_aspects_for_review(user=Depends(require_roles("admin", "pengawas", "kepala_sekolah"))):
    scope = await _review_scope_for_proposals(user)
    proposals = await db.teacher_proposed_aspects.find(scope, {"_id": 0}).sort("created_at", -1).to_list(1000)
    await _enrich_proposed_aspects(proposals)
    return proposals

@api.post("/proposed-aspects/{pid}/review")
async def review_proposed_aspect(pid: str, body: ProposedAspectReview, user=Depends(require_roles("admin", "pengawas", "kepala_sekolah"))):
    existing = await db.teacher_proposed_aspects.find_one({"id": pid})
    if not existing:
        raise HTTPException(status_code=404, detail="Usulan aspek tidak ditemukan")
    if existing.get("teacher_id") == user.get("linked_profile_id"):
        raise HTTPException(status_code=403, detail="Guru tidak boleh mereview usulan sendiri")
    await _assert_can_review_proposal(existing, user)
    if existing.get("status") != "Pending":
        raise HTTPException(status_code=400, detail="Hanya usulan Pending yang dapat direview")
    upd = {
        "status": body.status,
        "review_notes": body.review_notes or "",
        "reviewed_by": user["id"],
        "reviewed_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.teacher_proposed_aspects.update_one({"id": pid}, {"$set": upd})
    await audit(user["id"], body.status.lower(), "teacher_proposed_aspects", pid, clean(existing), upd)
    teacher_user_id = await _teacher_user_id(existing.get("teacher_id"))
    await notify_user(
        teacher_user_id,
        f"Usulan aspek {body.status}",
        f"Usulan aspek '{existing.get('aspect_name')}' telah {body.status}.",
        "success" if body.status == "Approved" else "warning",
        "teacher_proposed_aspects",
        pid,
    )
    doc = await db.teacher_proposed_aspects.find_one({"id": pid}, {"_id": 0})
    await _enrich_proposed_aspects([doc])
    return doc


@api.get("/assignments")
async def list_assignments(user=Depends(get_current_user)):
    scope = await _scope_for_role(user)
    items = await db.assessment_assignments.find(scope, {"_id": 0}).sort("created_at", -1).to_list(2000)
    await _enrich_assignments(items)
    return items

@api.get("/audit-logs")
async def list_audit_logs(request: Request, user=Depends(require_roles("admin"))):
    params = request.query_params
    query = {}
    date_from = params.get("date_from")
    date_to = params.get("date_to")
    try:
        page = max(int(params.get("page") or 1), 1)
        limit = min(max(int(params.get("limit") or 50), 1), 200)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format pagination audit log tidak valid")
    if date_from or date_to:
        query["created_at"] = {}
        if date_from:
            try:
                datetime.fromisoformat(date_from)
            except ValueError:
                raise HTTPException(status_code=400, detail="Format tanggal mulai tidak valid")
            query["created_at"]["$gte"] = date_from
        if date_to:
            try:
                datetime.fromisoformat(date_to)
            except ValueError:
                raise HTTPException(status_code=400, detail="Format tanggal selesai tidak valid")
            query["created_at"]["$lte"] = f"{date_to}T23:59:59.999999+00:00" if len(date_to) == 10 else date_to
    for key, field in [("user_id", "user_id"), ("action", "action"), ("module", "table_name")]:
        value = params.get(key)
        if value and value != "semua":
            query[field] = value
    role = params.get("role")
    if role and role != "semua":
        user_ids = await db.users.distinct("id", {"role": role})
        query["user_id"] = {"$in": user_ids or ["__none__"]}
    search = (params.get("search") or "").strip()
    if search:
        query["$or"] = [
            {"action": {"$regex": search, "$options": "i"}},
            {"table_name": {"$regex": search, "$options": "i"}},
            {"record_id": {"$regex": search, "$options": "i"}},
        ]
    total = await db.audit_logs.count_documents(query)
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    user_ids = {l.get("user_id") for l in logs if l.get("user_id")}
    users = {
        u["id"]: u
        async for u in db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "password_hash": 0})
    } if user_ids else {}
    for log in logs:
        actor = users.get(log.get("user_id"), {})
        log.setdefault("id", log.get("record_id") or str(uuid.uuid4()))
        log.setdefault("action", "-")
        log.setdefault("table_name", "-")
        log.setdefault("record_id", "-")
        log.setdefault("old_value", {})
        log.setdefault("new_value", {})
        log.setdefault("created_at", "")
        log["user_name"] = actor.get("name") or "-"
        log["user_role"] = actor.get("role") or "-"
    return {"logs": json_safe(logs), "total": total, "page": page, "limit": limit}

@api.get("/audit-logs/options")
async def audit_log_options(user=Depends(require_roles("admin"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(1000)
    actions = await db.audit_logs.distinct("action")
    modules = await db.audit_logs.distinct("table_name")
    return {
        "users": json_safe(users),
        "roles": ["admin", "pengawas", "kepala_sekolah", "guru"],
        "actions": sorted([str(a) for a in actions if a]),
        "modules": sorted([str(m) for m in modules if m]),
    }

@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    query = {} if user["role"] == "admin" else {"user_id": user["id"]}
    items = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    if user["role"] != "admin":
        items = [it for it in items if it.get("user_id") == user["id"]]
    return items

@api.get("/notifications/unread-count")
async def notification_unread_count(user=Depends(get_current_user)):
    count = await db.notifications.count_documents({"user_id": user["id"], "is_read": False})
    return {"count": count}

@api.post("/notifications/{nid}/read")
async def mark_notification_read(nid: str, user=Depends(get_current_user)):
    query = {"id": nid} if user["role"] == "admin" else {"id": nid, "user_id": user["id"]}
    existing = await db.notifications.find_one(query, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Notifikasi tidak ditemukan")
    await db.notifications.update_one({"id": nid}, {"$set": {"is_read": True, "read_at": now_iso()}})
    return {"ok": True}

@api.post("/notifications/mark-all-read")
async def mark_all_notifications_read(user=Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": user["id"], "is_read": False},
        {"$set": {"is_read": True, "read_at": now_iso()}},
    )
    return {"ok": True}

@api.get("/assignments/me")
async def my_assignment(user=Depends(get_current_user)):
    """Convenience: guru's assignment(s) in active period (or all)."""
    period = await _get_active_period()
    scope = await _scope_for_role(user)
    if period:
        scope = {**scope, "assessment_period_id": period["id"]}
    items = await db.assessment_assignments.find(scope, {"_id": 0}).sort("created_at", -1).to_list(50)
    await _enrich_assignments(items)
    return {"active_period": period, "assignments": items}

@api.get("/assignments/options/{teacher_id}")
async def assignment_options(teacher_id: str, user=Depends(require_roles("admin"))):
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise HTTPException(status_code=404, detail="Guru tidak ditemukan")
    school = await db.schools.find_one({"id": teacher.get("school_id")}, {"_id": 0})
    period = await _get_active_period()
    existing = {}
    existing_items = []
    if period:
        existing_items = await db.assessment_assignments.find({
            "teacher_id": teacher["id"],
            "assessment_period_id": period["id"],
            "assignment_type": "Penilaian Utama",
        }, {"_id": 0}).to_list(10)
        await _enrich_assignments(existing_items)
        existing = {x.get("assessor_role"): x for x in existing_items}
    return {
        "teacher": teacher,
        "school": school,
        "active_period": period,
        "principal_assessor": await _principal_assessor_for_school(teacher.get("school_id")),
        "supervisor_assessors": await _supervisor_assessors_for_school(school),
        "existing_assignments": existing,
    }

@api.post("/assignments")
async def create_assignment(body: AssignmentCreate, user=Depends(require_roles("admin"))):
    teacher, assessor, period = await _validate_assignment(
        body.teacher_id, body.assessor_user_id, body.assessment_period_id, user
    )
    a_type = body.assignment_type or "Penilaian Utama"
    role_label = _assessor_role_label(assessor)
    # Uniqueness: one main assessment per assessor role for each teacher/period.
    if a_type == "Penilaian Utama":
        dup = await db.assessment_assignments.find_one({
            "teacher_id": body.teacher_id,
            "assessment_period_id": period["id"],
            "assessor_role": role_label,
        })
        if dup:
            raise HTTPException(status_code=400, detail=f"Guru ini sudah memiliki Penilaian Utama oleh {role_label} pada periode ini.")
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher["id"],
        "school_id": teacher.get("school_id"),
        "assessor_user_id": assessor["id"],
        "assessor_role": role_label,
        "assessment_period_id": period["id"],
        "observation_date": body.observation_date or "",
        "assignment_type": a_type,
        "status": "Belum Dimulai",
        "feedback_count": 0,
        "teacher_review_status": "Belum Dikirim",
        "teacher_review_completed": False,
        "notes": body.notes or "",
        "created_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.assessment_assignments.insert_one(doc)
    await audit(user["id"], "create", "assessment_assignments", doc["id"], None, doc)
    await notify_user(
        assessor["id"],
        "Assignment penilaian baru",
        f"Anda ditugaskan menilai {teacher.get('name')} sebagai {role_label}.",
        "info",
        "assessment_assignments",
        doc["id"],
    )
    doc.pop("_id", None)
    await _enrich_assignments([doc])
    return doc

@api.put("/assignments/{aid}")
async def update_assignment(aid: str, body: AssignmentUpdate, user=Depends(require_roles("admin"))):
    existing = await db.assessment_assignments.find_one({"id": aid})
    if not existing:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if existing.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Assignment final tidak dapat diubah")
    upd = body.model_dump(exclude_unset=True)
    new_teacher_id = upd.get("teacher_id", existing["teacher_id"])
    new_assessor_id = upd.get("assessor_user_id", existing["assessor_user_id"])
    new_type = upd.get("assignment_type", existing.get("assignment_type", "Penilaian Utama"))

    teacher, assessor, period = await _validate_assignment(
        new_teacher_id, new_assessor_id, existing["assessment_period_id"], user
    )
    role_label = _assessor_role_label(assessor)
    if new_type == "Penilaian Utama":
        dup = await db.assessment_assignments.find_one({
            "teacher_id": new_teacher_id,
            "assessment_period_id": existing["assessment_period_id"],
            "assessor_role": role_label,
            "id": {"$ne": aid},
        })
        if dup:
            raise HTTPException(status_code=400, detail=f"Guru ini sudah memiliki Penilaian Utama oleh {role_label} pada periode ini.")

    upd["school_id"] = teacher.get("school_id")
    upd["assessor_role"] = role_label
    upd["updated_at"] = now_iso()
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "update", "assessment_assignments", aid, clean(existing), upd)
    new_doc = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([new_doc])
    return new_doc

@api.delete("/assignments/{aid}")
async def delete_assignment(aid: str, user=Depends(require_roles("admin"))):
    existing = await db.assessment_assignments.find_one({"id": aid})
    if not existing:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if existing.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Assignment final tidak dapat dihapus")
    await db.assessment_assignments.delete_one({"id": aid})
    await audit(user["id"], "delete", "assessment_assignments", aid, clean(existing), None)
    return {"ok": True}

@api.post("/assignments/{aid}/start")
async def start_assignment(aid: str, user=Depends(get_current_user)):
    existing = await db.assessment_assignments.find_one({"id": aid})
    if not existing:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if existing.get("assessor_user_id") != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Hanya penilai yang ditugaskan dapat memulai penilaian")
    if existing.get("status") not in ("Belum Dimulai",):
        raise HTTPException(status_code=400, detail="Penilaian sudah dimulai sebelumnya")
    upd = {
        "status": "Draft",
        "teacher_review_status": "Belum Dikirim",
        "teacher_review_completed": False,
        "updated_at": now_iso(),
    }
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "start", "assessment_assignments", aid, {"status": existing.get("status")}, upd)
    teacher_user_id = await _teacher_user_id(existing.get("teacher_id"))
    await notify_user(
        teacher_user_id,
        "Penilaian dimulai",
        "Penilai telah memulai proses penilaian Anda.",
        "info",
        "assessment_assignments",
        aid,
    )
    new_doc = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([new_doc])
    return new_doc

@api.get("/assignments/{aid}/assessment-form")
async def get_assessment_form(aid: str, user=Depends(get_current_user)):
    assignment = await _assignment_for_assessment_form(aid, user, require_draft=False)
    return await _assessment_form_payload(assignment)

@api.put("/assignments/{aid}/assessment-scores")
async def save_assessment_scores(aid: str, body: AssessmentScoresSave, user=Depends(get_current_user)):
    assignment = await _assignment_for_assessment_form(aid, user, require_draft=True)
    aspects = await db.observation_aspects.find({"status": "aktif"}, {"_id": 0}).to_list(2000)
    aspect_map = {a["id"]: a for a in aspects}
    proposed_aspects = await db.teacher_proposed_aspects.find({
        "assignment_id": aid,
        "status": "Approved",
    }, {"_id": 0}).to_list(2000)
    proposed_map = {a["id"]: a for a in proposed_aspects}
    seen = set()
    old_scores = await db.assessment_scores.find({"assignment_id": aid}, {"_id": 0}).to_list(2000)
    for item in body.scores:
        if item.aspect_id in seen:
            raise HTTPException(status_code=400, detail="Aspek penilaian tidak boleh duplikat dalam satu penyimpanan")
        seen.add(item.aspect_id)
        aspect = aspect_map.get(item.aspect_id)
        proposed = proposed_map.get(item.aspect_id)
        if not aspect and not proposed:
            raise HTTPException(status_code=400, detail="Aspek penilaian tidak aktif atau tidak ditemukan")
        now = now_iso()
        category_id = aspect["category_id"] if aspect else proposed["category_id"]
        await db.assessment_scores.update_one(
            {"assignment_id": aid, "aspect_id": item.aspect_id},
            {
                "$set": {
                    "assignment_id": aid,
                    "teacher_id": assignment["teacher_id"],
                    "assessor_user_id": assignment["assessor_user_id"],
                    "assessment_period_id": assignment["assessment_period_id"],
                    "category_id": category_id,
                    "aspect_id": item.aspect_id,
                    "source": "official" if aspect else "proposed",
                    "include_in_score": bool(aspect),
                    "proposed_aspect_id": proposed["id"] if proposed else None,
                    "score": item.score,
                    "notes": item.notes or "",
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "created_at": now,
                },
            },
            upsert=True,
        )
    new_scores = await db.assessment_scores.find({"assignment_id": aid}, {"_id": 0}).to_list(2000)
    await audit(user["id"], "save_scores", "assessment_scores", aid, old_scores, new_scores)
    fresh_assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh_assignment])
    return await _assessment_form_payload(fresh_assignment)

@api.post("/assignments/{aid}/send-to-teacher")
async def send_assignment_to_teacher(aid: str, user=Depends(get_current_user)):
    assignment = await _assignment_for_assessment_form(aid, user, require_draft=False)
    if user["role"] != "admin" and assignment.get("assessor_user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Hanya penilai yang ditugaskan yang boleh mengirim penilaian ke Guru")
    status_now = assignment.get("status")
    if status_now not in EDITABLE_SCORE_STATUSES:
        raise HTTPException(status_code=400, detail="Assignment hanya dapat dikirim saat status Draft atau Draft Revisi")
    completion = await _official_score_completion(aid)
    if completion["required"] < 1:
        raise HTTPException(status_code=400, detail="Belum ada aspek resmi aktif untuk dinilai")
    if completion["missing"] > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Semua aspek resmi wajib diberi skor sebelum dikirim ke Guru. Masih ada {completion['missing']} aspek belum dinilai.",
        )
    await _assert_evaluation_complete(aid)
    feedback_count = int(assignment.get("feedback_count") or 0)
    final_after_second_feedback = status_now == "Draft Revisi" and feedback_count >= 2
    final_ready = False
    if final_after_second_feedback:
        try:
            await _assert_evaluation_complete_for_final(aid)
            await _assert_signature(aid, assignment["assessor_user_id"])
            final_ready = True
        except HTTPException:
            final_ready = False
    next_status = "Final" if final_ready else "Menunggu Review Guru"
    upd = {
        "status": next_status,
        "feedback_count": feedback_count,
        "sent_to_teacher_at": now_iso(),
        "updated_at": now_iso(),
        "teacher_review_status": "Feedback Maksimal Diproses" if final_after_second_feedback else "Menunggu Review Guru",
        "teacher_review_completed": bool(final_after_second_feedback),
    }
    if next_status == "Final":
        upd["finalized_at"] = now_iso()
        upd["teacher_review_completed"] = True
        upd["teacher_review_completed_at"] = now_iso()
    elif final_after_second_feedback:
        upd["teacher_review_completed_at"] = now_iso()
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    action = "status_final" if next_status == "Final" else ("send_revision_to_teacher" if status_now == "Draft Revisi" else "send_to_teacher")
    await audit(user["id"], action, "assessment_assignments", aid, {"status": status_now}, upd)
    teacher_user_id = await _teacher_user_id(assignment.get("teacher_id"))
    if next_status == "Final":
        await notify_user(teacher_user_id, "Penilaian Final", "Penilaian Anda telah menjadi Final.", "success", "assessment_assignments", aid)
        await notify_user(assignment.get("assessor_user_id"), "Penilaian Final", "Assignment penilaian telah menjadi Final.", "success", "assessment_assignments", aid)
    elif final_after_second_feedback:
        await notify_user(teacher_user_id, "Revisi terakhir diproses", "Feedback maksimal telah diproses. Penilai akan melengkapi finalisasi.", "info", "assessment_assignments", aid)
        await notify_user(assignment.get("assessor_user_id"), "Lengkapi Evaluasi & RTL", "Review Guru selesai. Lengkapi Evaluasi & RTL sebelum finalisasi.", "warning", "assessment_assignments", aid)
    else:
        title = "Revisi penilaian dikirim" if status_now == "Draft Revisi" else "Penilaian dikirim ke Guru"
        await notify_user(teacher_user_id, title, "Silakan review hasil penilaian Anda.", "info", "assessment_assignments", aid)
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return await _assessment_form_payload(fresh)

@api.post("/assignments/{aid}/start-revision")
async def start_assignment_revision(aid: str, user=Depends(get_current_user)):
    assignment = await _assignment_for_assessment_form(aid, user, require_draft=False)
    if user["role"] != "admin" and assignment.get("assessor_user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Hanya penilai yang ditugaskan yang boleh memulai revisi")
    if assignment.get("status") != "Feedback dari Guru":
        raise HTTPException(status_code=400, detail="Revisi hanya dapat dimulai setelah ada feedback dari Guru")
    upd = {
        "status": "Draft Revisi",
        "teacher_review_status": "Draft Revisi",
        "teacher_review_completed": False,
        "revision_started_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "start_revision", "assessment_assignments", aid, {"status": assignment.get("status")}, upd)
    await notify_user(
        await _teacher_user_id(assignment.get("teacher_id")),
        "Revisi penilaian diproses",
        "Penilai mulai memproses feedback Anda.",
        "info",
        "assessment_assignments",
        aid,
    )
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return await _assessment_form_payload(fresh)

@api.get("/assignments/{aid}/teacher-review")
async def get_teacher_review(aid: str, user=Depends(get_current_user)):
    assignment = await _teacher_review_assignment(aid, user)
    return await _assessment_form_payload(assignment)

@api.get("/assignments/{aid}/evaluation-followup")
async def get_evaluation_followup(aid: str, user=Depends(get_current_user)):
    assignment, can_edit = await _assignment_for_evaluation(aid, user)
    payload = await _assessment_form_payload(assignment)
    payload["can_edit_evaluation"] = can_edit and assignment.get("status") not in ASSIGNMENT_FINAL
    return payload

@api.get("/evaluation-followups/admin")
async def admin_list_evaluation_followups(request: Request, user=Depends(require_roles("admin"))):
    params = request.query_params
    assignment_query = {}
    for key, field in [
        ("period_id", "assessment_period_id"),
        ("school_id", "school_id"),
        ("teacher_id", "teacher_id"),
        ("assessor_user_id", "assessor_user_id"),
        ("assignment_status", "status"),
    ]:
        value = params.get(key)
        if value and value != "semua":
            assignment_query[field] = value
    assignments = await db.assessment_assignments.find(assignment_query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    await _enrich_assignments(assignments)
    assignment_ids = [a["id"] for a in assignments]
    evaluations = {
        e["assignment_id"]: e
        async for e in db.evaluation_followups.find({"assignment_id": {"$in": assignment_ids}}, {"_id": 0})
    } if assignment_ids else {}
    status_rtl = params.get("status_rtl")
    has_evaluation = params.get("has_evaluation")
    rows = []
    for assignment in assignments:
        evaluation = evaluations.get(assignment["id"])
        deleted = bool((evaluation or {}).get("is_deleted"))
        active_eval = evaluation if evaluation and not deleted else None
        if status_rtl and status_rtl != "semua":
            if not active_eval or active_eval.get("status_rtl") != status_rtl:
                continue
        if has_evaluation == "yes" and not active_eval:
            continue
        if has_evaluation == "no" and evaluation:
            continue
        if has_evaluation == "deleted" and not deleted:
            continue
        rows.append({
            "assignment": assignment,
            "evaluation_followup": evaluation,
            "has_evaluation": bool(active_eval),
            "evaluation_deleted": deleted,
            "evaluation_complete": _evaluation_is_complete(active_eval),
        })
    return rows

@api.put("/assignments/{aid}/evaluation-followup")
async def save_evaluation_followup(aid: str, body: EvaluationFollowupIn, user=Depends(get_current_user)):
    assignment, can_edit = await _assignment_for_evaluation(aid, user)
    if not can_edit:
        raise HTTPException(status_code=403, detail="Hanya penilai yang ditugaskan yang boleh mengisi Evaluasi & RTL")
    if assignment.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Evaluasi & RTL tidak dapat diedit setelah assignment Final")
    completion = await _official_score_completion(aid)
    if completion["missing"] > 0 or completion["required"] < 1:
        raise HTTPException(status_code=400, detail="Evaluasi & RTL hanya dapat diisi setelah semua aspek resmi memiliki skor")
    existing = await db.evaluation_followups.find_one({"assignment_id": aid})
    if existing and existing.get("is_deleted") and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Evaluasi & RTL yang terhapus hanya dapat direstore oleh Admin")
    now = now_iso()
    payload = body.model_dump()
    doc_update = {
        **payload,
        "assignment_id": assignment["id"],
        "teacher_id": assignment["teacher_id"],
        "school_id": assignment["school_id"],
        "assessor_user_id": assignment["assessor_user_id"],
        "assessment_period_id": assignment["assessment_period_id"],
        "is_deleted": False,
        "deleted_at": None,
        "deleted_by": None,
        "restored_at": now if existing and existing.get("is_deleted") else None,
        "updated_by": user["id"],
        "updated_at": now,
    }
    if existing:
        await db.evaluation_followups.update_one({"assignment_id": aid}, {"$set": doc_update})
        action = "restore" if existing.get("is_deleted") else "update"
        await audit(user["id"], action, "evaluation_followups", existing["id"], clean(existing), doc_update)
    else:
        doc_update.update({
            "id": str(uuid.uuid4()),
            "created_by": user["id"],
            "created_at": now,
        })
        await db.evaluation_followups.insert_one(doc_update)
        await audit(user["id"], "create", "evaluation_followups", doc_update["id"], None, doc_update)
    await notify_user(
        assignment.get("assessor_user_id"),
        "Evaluasi & RTL diperbarui",
        "Data Evaluasi & RTL assignment telah disimpan.",
        "info",
        "evaluation_followups",
        aid,
    )
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return await _assessment_form_payload(fresh)

@api.post("/assignments/{aid}/finalize")
async def finalize_assignment(aid: str, user=Depends(get_current_user)):
    assignment, can_edit = await _assignment_for_evaluation(aid, user)
    if not can_edit:
        raise HTTPException(status_code=403, detail="Hanya penilai yang ditugaskan yang boleh finalisasi penilaian")
    if user["role"] == "admin" and assignment.get("assessor_user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Admin belum dapat finalisasi assignment pada tahap ini")
    if assignment.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Assignment sudah Final")
    completion = await _official_score_completion(aid)
    if completion["required"] < 1 or completion["missing"] > 0:
        raise HTTPException(status_code=400, detail="Semua aspek resmi wajib diberi skor sebelum finalisasi")
    await _assert_review_complete_for_final(assignment)
    await _assert_evaluation_complete_for_final(aid)
    await _assert_signature(aid, assignment["assessor_user_id"])
    upd = {
        "status": "Final",
        "teacher_review_completed": True,
        "teacher_review_status": assignment.get("teacher_review_status") or "Selesai",
        "finalized_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "finalize", "assessment_assignments", aid, {"status": assignment.get("status")}, upd)
    teacher_user_id = await _teacher_user_id(assignment.get("teacher_id"))
    await notify_user(teacher_user_id, "Penilaian Final", "Penilaian Anda telah difinalisasi.", "success", "assessment_assignments", aid)
    await notify_user(assignment.get("assessor_user_id"), "Penilaian Final", "Assignment penilaian telah difinalisasi.", "success", "assessment_assignments", aid)
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return await _assessment_form_payload(fresh)

@api.post("/assignments/{aid}/emergency-unlock")
async def emergency_unlock_assignment(aid: str, body: AdminReasonIn, user=Depends(require_roles("admin"))):
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Alasan Emergency Unlock wajib diisi")
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if assignment.get("status") not in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Emergency Unlock hanya dapat dilakukan pada assignment Final")
    now = now_iso()
    upd = {
        "status": "Draft Revisi",
        "emergency_unlocked": True,
        "emergency_unlock_reason": reason,
        "signatures_need_update": True,
        "updated_at": now,
    }
    log_doc = {
        "id": str(uuid.uuid4()),
        "assignment_id": aid,
        "unlocked_by": user["id"],
        "reason": reason,
        "previous_status": assignment.get("status"),
        "new_status": "Draft Revisi",
        "unlocked_at": now,
        "notes": body.notes or "",
    }
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await db.digital_signatures.update_many(
        {"assignment_id": aid},
        {"$set": {"signature_status": "Perlu Diperbarui", "updated_at": now}},
    )
    await db.emergency_unlock_logs.insert_one(log_doc)
    await audit(user["id"], "emergency_unlock", "assessment_assignments", aid, {"status": assignment.get("status")}, {**upd, "reason": reason})
    await notify_user(assignment.get("assessor_user_id"), "Emergency Unlock", "Assignment Final dibuka kembali untuk revisi.", "warning", "assessment_assignments", aid)
    await notify_user(await _teacher_user_id(assignment.get("teacher_id")), "Emergency Unlock", "Penilaian Final Anda dibuka kembali untuk revisi.", "warning", "assessment_assignments", aid)
    await notify_admins("Emergency Unlock dilakukan", f"Assignment {aid} dibuka kembali oleh Admin.", "warning", "assessment_assignments", aid)
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return fresh

@api.post("/assignments/{aid}/force-final")
async def force_final_assignment(aid: str, body: AdminReasonIn, user=Depends(require_roles("admin"))):
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Alasan Force Final wajib diisi")
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if assignment.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Assignment sudah Final")
    await _assert_force_final_ready(aid, assignment)
    now = now_iso()
    upd = {
        "status": "Final",
        "force_final": True,
        "force_final_reason": reason,
        "signatures_need_update": False,
        "finalized_at": now,
        "updated_at": now,
    }
    log_doc = {
        "id": str(uuid.uuid4()),
        "assignment_id": aid,
        "forced_by": user["id"],
        "reason": reason,
        "previous_status": assignment.get("status"),
        "new_status": "Final",
        "forced_at": now,
        "notes": body.notes or "",
    }
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await db.force_final_logs.insert_one(log_doc)
    await audit(user["id"], "force_final", "assessment_assignments", aid, {"status": assignment.get("status")}, {**upd, "reason": reason})
    await notify_user(assignment.get("assessor_user_id"), "Force Final", "Assignment penilaian telah difinalisasi oleh Admin.", "success", "assessment_assignments", aid)
    await notify_user(await _teacher_user_id(assignment.get("teacher_id")), "Penilaian Final", "Penilaian Anda telah difinalisasi oleh Admin.", "success", "assessment_assignments", aid)
    await notify_admins("Force Final dilakukan", f"Assignment {aid} difinalisasi oleh Admin.", "success", "assessment_assignments", aid)
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return fresh

@api.delete("/assignments/{aid}/evaluation-followup")
async def admin_delete_evaluation_followup(aid: str, user=Depends(require_roles("admin"))):
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if assignment.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Evaluasi & RTL Final tidak dapat dihapus pada tahap ini")
    existing = await db.evaluation_followups.find_one({"assignment_id": aid})
    if not existing or existing.get("is_deleted"):
        raise HTTPException(status_code=404, detail="Evaluasi & RTL aktif tidak ditemukan")
    upd = {
        "is_deleted": True,
        "deleted_by": user["id"],
        "deleted_at": now_iso(),
        "updated_by": user["id"],
        "updated_at": now_iso(),
    }
    await db.evaluation_followups.update_one({"assignment_id": aid}, {"$set": upd})
    await audit(user["id"], "delete", "evaluation_followups", existing["id"], clean(existing), upd)
    return {"ok": True}

@api.post("/assignments/{aid}/evaluation-followup/restore")
async def admin_restore_evaluation_followup(aid: str, user=Depends(require_roles("admin"))):
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if assignment.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Evaluasi & RTL Final tidak dapat direstore pada tahap ini")
    existing = await db.evaluation_followups.find_one({"assignment_id": aid})
    if not existing or not existing.get("is_deleted"):
        raise HTTPException(status_code=404, detail="Evaluasi & RTL terhapus tidak ditemukan")
    upd = {
        "is_deleted": False,
        "deleted_by": None,
        "deleted_at": None,
        "restored_by": user["id"],
        "restored_at": now_iso(),
        "updated_by": user["id"],
        "updated_at": now_iso(),
    }
    await db.evaluation_followups.update_one({"assignment_id": aid}, {"$set": upd})
    await audit(user["id"], "restore", "evaluation_followups", existing["id"], clean(existing), upd)
    return {"ok": True}

@api.post("/assignments/{aid}/digital-signature")
async def save_digital_signature(aid: str, body: DigitalSignatureIn, user=Depends(get_current_user)):
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    permission = await _signature_permission(assignment, user)
    if not permission["can_view"] or not permission["can_sign"]:
        raise HTTPException(status_code=403, detail="Anda tidak berhak menandatangani report ini")
    if assignment.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Tanda tangan sudah terkunci setelah assignment Final")
    image = (body.signature_image or "").strip()
    if not image.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Format tanda tangan harus berupa gambar/base64")
    teacher = await db.teachers.find_one({"id": assignment.get("teacher_id")}, {"_id": 0})
    now = now_iso()
    existing = await db.digital_signatures.find_one({"assignment_id": aid, "user_id": user["id"]})
    doc = {
        "assignment_id": aid,
        "teacher_id": assignment.get("teacher_id"),
        "assessment_period_id": assignment.get("assessment_period_id"),
        "user_id": user["id"],
        "signer_name": user.get("name"),
        "signer_role": user.get("role"),
        "signature_image": image,
        "signature_status": "Sudah Ditandatangani",
        "signed_at": now,
        "updated_at": now,
    }
    if existing:
        await db.digital_signatures.update_one({"id": existing["id"]}, {"$set": doc})
        await audit(user["id"], "update_signature", "digital_signatures", existing["id"], clean(existing), doc)
        doc["id"] = existing["id"]
        doc["created_at"] = existing.get("created_at")
    else:
        doc.update({"id": str(uuid.uuid4()), "created_at": now})
        await db.digital_signatures.insert_one(doc)
        await audit(user["id"], "create_signature", "digital_signatures", doc["id"], None, {**doc, "signature_image": "[image]"})
    doc.pop("_id", None)
    return doc

@api.get("/assignments/{aid}/digital-signatures")
async def list_digital_signatures(aid: str, user=Depends(get_current_user)):
    assignment = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    permission = await _signature_permission(assignment, user)
    if not permission["can_view"]:
        raise HTTPException(status_code=403, detail="Anda tidak berhak melihat tanda tangan report ini")
    return await db.digital_signatures.find({"assignment_id": aid}, {"_id": 0}).sort("signed_at", 1).to_list(20)

@api.get("/reports")
async def list_reports(request: Request, user=Depends(get_current_user)):
    params = request.query_params
    query = await _report_scope_for_role(user)
    query["status"] = {"$ne": "Belum Dimulai"}
    filters = {
        "period_id": "assessment_period_id",
        "school_id": "school_id",
        "teacher_id": "teacher_id",
        "assessor_user_id": "assessor_user_id",
        "role": "assessor_role",
        "status": "status",
    }
    for param, field in filters.items():
        value = params.get(param)
        if value and value != "semua":
            if field == "status":
                query["status"] = value
            else:
                query[field] = value
    assignments = await db.assessment_assignments.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    await _enrich_assignments(assignments)
    assignment_ids = [a["id"] for a in assignments]
    evaluations = {
        e["assignment_id"]: e
        async for e in db.evaluation_followups.find({"assignment_id": {"$in": assignment_ids}, "is_deleted": {"$ne": True}}, {"_id": 0})
    } if assignment_ids else {}
    status_rtl = params.get("status_rtl")
    rows = []
    for assignment in assignments:
        evaluation = evaluations.get(assignment["id"])
        if status_rtl and status_rtl != "semua":
            if not evaluation or evaluation.get("status_rtl") != status_rtl:
                continue
        period, year, semester = await _period_detail(assignment.get("assessment_period_id"))
        rows.append({
            "assignment_id": assignment["id"],
            "teacher_id": assignment.get("teacher_id"),
            "teacher_name": assignment.get("teacher_name"),
            "teacher_nip": assignment.get("teacher_nip"),
            "school_id": assignment.get("school_id"),
            "school_name": assignment.get("school_name"),
            "assessment_period_id": assignment.get("assessment_period_id"),
            "period_name": assignment.get("period_name"),
            "academic_year_id": (year or {}).get("id"),
            "academic_year_name": (year or {}).get("year_name"),
            "semester_id": (semester or {}).get("id"),
            "semester_name": (semester or {}).get("semester_name"),
            "assessor_user_id": assignment.get("assessor_user_id"),
            "assessor_name": assignment.get("assessor_name"),
            "assessor_role": assignment.get("assessor_role"),
            "status": assignment.get("status"),
            "observation_date": assignment.get("observation_date"),
            "final_percentage": assignment.get("final_percentage"),
            "status_rtl": (evaluation or {}).get("status_rtl"),
            "has_evaluation": bool(evaluation),
            "evaluation_complete": _evaluation_is_complete(evaluation),
        })
    return rows

@api.get("/reports/{aid}")
async def get_report_detail(aid: str, user=Depends(get_current_user)):
    assignment = await _assignment_for_report(aid, user)
    await audit(user["id"], "view_report", "assessment_reports", aid, None, {"assignment_id": aid})
    return await _report_payload(assignment)

@api.post("/reports/{aid}/export-log")
async def log_report_export(aid: str, user=Depends(get_current_user)):
    assignment = await _assignment_for_report(aid, user)
    payload = await _report_payload(assignment)
    if not payload.get("export_ready"):
        raise HTTPException(status_code=400, detail=EXPORT_INCOMPLETE_MESSAGE)
    await audit(user["id"], "export_pdf", "assessment_reports", aid, None, {"assignment_id": aid})
    return {"ok": True}

@api.post("/assignments/{aid}/teacher-approve")
async def teacher_approve_assignment(aid: str, user=Depends(get_current_user)):
    assignment = await _teacher_review_assignment(aid, user)
    if assignment.get("status") != "Menunggu Review Guru":
        raise HTTPException(status_code=400, detail="Guru hanya dapat menyetujui saat status Menunggu Review Guru")
    if _assignment_review_complete(assignment):
        raise HTTPException(status_code=400, detail="Review Guru untuk assignment ini sudah selesai")
    await _assert_signature(aid, user["id"], "guru")
    now = now_iso()
    final_ready = False
    try:
        await _assert_evaluation_complete_for_final(aid)
        await _assert_signature(aid, assignment["assessor_user_id"])
        final_ready = True
    except HTTPException:
        final_ready = False
    upd = {
        "teacher_review_completed": True,
        "teacher_review_status": "Disetujui Guru",
        "teacher_approved_at": now,
        "updated_at": now,
    }
    if final_ready:
        upd.update({"status": "Final", "finalized_at": now})
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "teacher_approve", "assessment_assignments", aid, {"status": assignment.get("status")}, upd)
    if final_ready:
        await notify_user(
            assignment.get("assessor_user_id"),
            "Guru menyetujui penilaian",
            "Guru telah menyetujui hasil penilaian. Assignment menjadi Final.",
            "success",
            "assessment_assignments",
            aid,
        )
        await notify_user(user["id"], "Penilaian Final", "Penilaian Anda telah menjadi Final.", "success", "assessment_assignments", aid)
    else:
        await notify_user(
            assignment.get("assessor_user_id"),
            "Guru menyetujui penilaian",
            "Review Guru selesai. Lengkapi Evaluasi & RTL sebelum finalisasi.",
            "info",
            "assessment_assignments",
            aid,
        )
        await notify_user(user["id"], "Penilaian disetujui", "Persetujuan Anda sudah tercatat.", "success", "assessment_assignments", aid)
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return await _assessment_form_payload(fresh)

@api.post("/assignments/{aid}/teacher-feedback")
async def teacher_feedback_assignment(aid: str, body: TeacherFeedbackIn, user=Depends(get_current_user)):
    assignment = await _teacher_review_assignment(aid, user)
    if assignment.get("status") != "Menunggu Review Guru":
        raise HTTPException(status_code=400, detail="Feedback hanya dapat diberikan saat status Menunggu Review Guru")
    if _assignment_review_complete(assignment):
        raise HTTPException(status_code=400, detail="Review Guru untuk assignment ini sudah selesai")
    feedback_text = (body.feedback_text or "").strip()
    if not feedback_text:
        raise HTTPException(status_code=400, detail="Feedback tidak boleh kosong")
    feedback_count = int(assignment.get("feedback_count") or 0)
    if feedback_count >= 2:
        raise HTTPException(status_code=400, detail="Feedback maksimal 2 kali untuk setiap assignment")
    next_round = feedback_count + 1
    now = now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "assignment_id": assignment["id"],
        "teacher_id": assignment["teacher_id"],
        "assessment_period_id": assignment["assessment_period_id"],
        "assessor_user_id": assignment["assessor_user_id"],
        "feedback_text": feedback_text,
        "feedback_round": next_round,
        "status": "Submitted",
        "created_at": now,
        "updated_at": now,
    }
    await db.teacher_assessment_feedbacks.insert_one(doc)
    upd = {
        "status": "Feedback dari Guru",
        "feedback_count": next_round,
        "teacher_review_status": "Feedback dari Guru",
        "teacher_review_completed": False,
        "updated_at": now,
    }
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "teacher_feedback", "teacher_assessment_feedbacks", doc["id"], None, doc)
    await audit(user["id"], "feedback_from_teacher", "assessment_assignments", aid, {"status": assignment.get("status"), "feedback_count": feedback_count}, upd)
    await notify_user(
        assignment.get("assessor_user_id"),
        f"Feedback Guru ronde {next_round}",
        "Guru memberi feedback untuk hasil penilaian.",
        "warning",
        "teacher_assessment_feedbacks",
        doc["id"],
    )
    fresh = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([fresh])
    return await _assessment_form_payload(fresh)


# ---------------------------------------------------------------------------
# Mount router + middleware
# ---------------------------------------------------------------------------
app.include_router(api)

frontend_url = os.environ.get("FRONTEND_URL", "").strip()
cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
allow_origins = cors_origins.split(",") if cors_origins else ([frontend_url] if frontend_url else ["*"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Startup: indexes + seed
# ---------------------------------------------------------------------------
async def seed_permissions():
    default_matrix = {
        "admin": (True, True, True, True),
        "pengawas": (False, True, False, False),
        "kepala_sekolah": (False, True, False, False),
        "guru": (False, True, False, False),
    }
    # Guru only sees dashboard
    overrides = {
        ("guru", "user_management"): (False, False, False, False),
        ("guru", "data_sekolah"): (False, False, False, False),
        ("guru", "data_guru"): (False, False, False, False),
        ("guru", "data_pengawas"): (False, False, False, False),
        ("guru", "data_kepala_sekolah"): (False, False, False, False),
        ("guru", "role_permission"): (False, False, False, False),
        ("kepala_sekolah", "user_management"): (False, False, False, False),
        ("kepala_sekolah", "data_pengawas"): (False, False, False, False),
        ("kepala_sekolah", "role_permission"): (False, False, False, False),
        ("kepala_sekolah", "data_kepala_sekolah"): (False, False, False, False),
        ("kepala_sekolah", "data_sekolah"): (False, True, False, False),
        ("pengawas", "user_management"): (False, False, False, False),
        ("pengawas", "role_permission"): (False, False, False, False),
        ("pengawas", "data_kepala_sekolah"): (False, True, False, False),
    }
    for role in ["admin", "pengawas", "kepala_sekolah", "guru"]:
        for menu in MENU_NAMES:
            existing = await db.role_permissions.find_one({"role": role, "menu_name": menu})
            if existing:
                continue
            c, r, u, d = overrides.get((role, menu), default_matrix[role])
            await db.role_permissions.insert_one({
                "id": str(uuid.uuid4()),
                "role": role,
                "menu_name": menu,
                "can_create": c,
                "can_read": r,
                "can_update": u,
                "can_delete": d,
            })

async def seed_data():
    # Admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@pjok-kbb.id")
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@123")
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Administrator KBB",
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "role": "admin",
            "linked_profile_id": None,
            "status": "aktif",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
        logger.info(f"Seeded admin: {admin_email}")
    elif not verify_password(admin_password, existing_admin.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    # Skip rest if any school already exists
    if await db.schools.count_documents({}) > 0:
        return

    # 2 SD di Bandung Barat
    sd1_id = str(uuid.uuid4())
    sd2_id = str(uuid.uuid4())
    await db.schools.insert_many([
        {"id": sd1_id, "npsn": "20206123", "school_name": "SDN Lembang 01",
         "district": "Kabupaten Bandung Barat", "subdistrict": "Lembang",
         "address": "Jl. Raya Lembang No. 12, Lembang", "status": "aktif",
         "created_at": now_iso(), "updated_at": now_iso()},
        {"id": sd2_id, "npsn": "20206224", "school_name": "SDN Cisarua 02",
         "district": "Kabupaten Bandung Barat", "subdistrict": "Cisarua",
         "address": "Jl. Kolonel Masturi No. 88, Cisarua", "status": "aktif",
         "created_at": now_iso(), "updated_at": now_iso()},
    ])

    # Pengawas
    pengawas_uid = str(uuid.uuid4())
    pengawas_pid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": pengawas_uid, "name": "Drs. Bambang Sutrisno",
        "email": "pengawas@pjok-kbb.id", "password_hash": hash_password("Pengawas@123"),
        "role": "pengawas", "linked_profile_id": pengawas_pid, "status": "aktif",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.supervisors.insert_one({
        "id": pengawas_pid, "user_id": pengawas_uid, "name": "Drs. Bambang Sutrisno",
        "nip": "196801011990031001", "work_area": "Lembang", "status": "aktif",
        "created_at": now_iso(), "updated_at": now_iso(),
    })

    # Kepala Sekolah
    kepsek_uid = str(uuid.uuid4())
    kepsek_pid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": kepsek_uid, "name": "Hj. Siti Aminah, S.Pd.",
        "email": "kepsek@pjok-kbb.id", "password_hash": hash_password("Kepsek@123"),
        "role": "kepala_sekolah", "linked_profile_id": kepsek_pid, "status": "aktif",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.principals.insert_one({
        "id": kepsek_pid, "user_id": kepsek_uid, "school_id": sd1_id,
        "name": "Hj. Siti Aminah, S.Pd.", "nip": "197003151995122002",
        "status": "aktif", "created_at": now_iso(), "updated_at": now_iso(),
    })

    # 3 Guru PJOK
    guru_data = [
        ("Ahmad Hidayat, S.Pd.", "guru1@pjok-kbb.id", "Guru@123", "198505102010011005", sd1_id, "PNS"),
        ("Dewi Lestari, S.Pd.", "guru2@pjok-kbb.id", "Guru@123", "199001152015032008", sd1_id, "PNS"),
        ("Rudi Hartono, S.Pd.", "guru3@pjok-kbb.id", "Guru@123", "198812202018011003", sd2_id, "Non PNS"),
    ]
    for name, email, pw, nip, sid, emp in guru_data:
        uid = str(uuid.uuid4())
        tid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid, "name": name, "email": email,
            "password_hash": hash_password(pw), "role": "guru",
            "linked_profile_id": tid, "status": "aktif",
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        await db.teachers.insert_one({
            "id": tid, "user_id": uid, "school_id": sid, "name": name,
            "nip": nip, "subject": "PJOK", "grade_level": "SD",
            "employment_status": emp, "status": "aktif",
            "created_at": now_iso(), "updated_at": now_iso(),
        })
    logger.info("Seed data inserted.")

@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.schools.create_index("npsn", unique=True)
    await db.role_permissions.create_index([("role", 1), ("menu_name", 1)], unique=True)
    await db.academic_years.create_index("year_name", unique=True)
    await db.semesters.create_index("semester_name", unique=True)
    await db.semesters.create_index("semester_order", unique=True)
    await db.assessment_periods.create_index([("academic_year_id", 1), ("semester_id", 1)], unique=True)
    await db.observation_categories.create_index("category_name", unique=True)
    try:
        await db.assessment_assignments.drop_index("teacher_id_1_assessment_period_id_1_assignment_type_1")
    except Exception:
        pass
    await db.assessment_assignments.create_index(
        [("teacher_id", 1), ("assessment_period_id", 1), ("assessor_role", 1)],
        unique=True,
    )
    await db.assessment_scores.create_index(
        [("assignment_id", 1), ("aspect_id", 1)],
        unique=True,
    )
    await db.teacher_proposed_aspects.create_index(
        [("teacher_id", 1), ("assessment_period_id", 1), ("aspect_name_normalized", 1)],
        unique=True,
    )
    await db.teacher_proposed_aspects.create_index([("assignment_id", 1), ("status", 1)])
    await db.teacher_assessment_feedbacks.create_index(
        [("assignment_id", 1), ("feedback_round", 1)],
        unique=True,
    )
    await db.evaluation_followups.create_index("assignment_id", unique=True)
    await db.digital_signatures.create_index([("assignment_id", 1), ("user_id", 1)], unique=True)
    await db.audit_logs.create_index([("created_at", -1), ("user_id", 1), ("action", 1), ("table_name", 1)])
    await db.notifications.create_index([("user_id", 1), ("is_read", 1), ("created_at", -1)])
    await db.emergency_unlock_logs.create_index([("assignment_id", 1), ("unlocked_at", -1)])
    await db.force_final_logs.create_index([("assignment_id", 1), ("forced_at", -1)])
    await db.teachers.update_many(
        {"employment_status": {"$nin": ["PNS", "Non PNS"]}},
        {"$set": {"employment_status": "Non PNS", "updated_at": now_iso()}},
    )
    await seed_permissions()
    await seed_data()
    await seed_phase2()
    await seed_phase3()
    await heal_profile_links()


async def seed_phase3():
    """Seed minimal example assignments on the active period.

    Idempotent: skips if any assignment already exists.
    """
    if await db.assessment_assignments.count_documents({}) > 0:
        return
    period = await db.assessment_periods.find_one({"is_active": True}, {"_id": 0})
    if not period:
        return
    period_id = period["id"]

    # Find pengawas
    pengawas = await db.users.find_one({"role": "pengawas", "status": "aktif"}, {"_id": 0})

    created = 0

    # 1) Untuk setiap kepala sekolah aktif yang punya sekolah, tugaskan 1 guru di sekolahnya
    async for kpsk_user in db.users.find({"role": "kepala_sekolah", "status": "aktif"}, {"_id": 0}):
        prin = await db.principals.find_one({"user_id": kpsk_user["id"]}, {"_id": 0})
        if not prin and kpsk_user.get("linked_profile_id"):
            prin = await db.principals.find_one({"id": kpsk_user["linked_profile_id"]}, {"_id": 0})
        sch_id = (prin or {}).get("school_id")
        if not sch_id:
            continue
        existing_tids = await db.assessment_assignments.distinct("teacher_id", {"assessment_period_id": period_id})
        teacher = await db.teachers.find_one({"school_id": sch_id, "status": "aktif", "id": {"$nin": existing_tids}}, {"_id": 0})
        if not teacher:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher["id"],
            "school_id": sch_id,
            "assessor_user_id": kpsk_user["id"],
            "assessor_role": "Kepala Sekolah",
            "assessment_period_id": period_id,
            "observation_date": "",
            "assignment_type": "Penilaian Utama",
            "status": "Belum Dimulai",
            "feedback_count": 0,
            "notes": "Penilaian rutin oleh Kepala Sekolah.",
            "created_by": kpsk_user["id"],
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.assessment_assignments.insert_one(doc)
        created += 1

    # 2) Pengawas menilai 1 guru lain
    if pengawas:
        existing_tids = await db.assessment_assignments.distinct("teacher_id", {"assessment_period_id": period_id})
        other = await db.teachers.find_one({"status": "aktif", "id": {"$nin": existing_tids}}, {"_id": 0})
        if other:
            doc = {
                "id": str(uuid.uuid4()),
                "teacher_id": other["id"],
                "school_id": other.get("school_id"),
                "assessor_user_id": pengawas["id"],
                "assessor_role": "Pengawas",
                "assessment_period_id": period_id,
                "observation_date": "",
                "assignment_type": "Penilaian Utama",
                "status": "Belum Dimulai",
                "feedback_count": 0,
                "notes": "Penilaian oleh pengawas wilayah.",
                "created_by": pengawas["id"],
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.assessment_assignments.insert_one(doc)
            created += 1

    if created:
        logger.info(f"Seeded {created} assignments (Phase 3).")


async def seed_phase2():
    """Seed academic year, semesters, active period, observation categories & aspects."""
    # Academic year
    ay = await db.academic_years.find_one({"year_name": "2025/2026"})
    if not ay:
        ay = _now_doc({"year_name": "2025/2026", "start_date": "2025-07-15", "end_date": "2026-06-30", "status": "aktif"})
        await db.academic_years.insert_one(ay)
        logger.info("Seeded academic year 2025/2026")
    ay_id = ay["id"]

    # Semesters
    semesters = [
        {"semester_name": "Ganjil", "semester_order": 1, "status": "aktif"},
        {"semester_name": "Genap", "semester_order": 2, "status": "aktif"},
    ]
    sem_ids = {}
    for s in semesters:
        existing = await db.semesters.find_one({"semester_name": s["semester_name"]})
        if not existing:
            doc = _now_doc(s)
            await db.semesters.insert_one(doc)
            sem_ids[s["semester_name"]] = doc["id"]
        else:
            sem_ids[s["semester_name"]] = existing["id"]

    # Assessment period: Semester Genap 2025/2026 (active)
    genap_id = sem_ids["Genap"]
    period = await db.assessment_periods.find_one({"academic_year_id": ay_id, "semester_id": genap_id})
    if not period:
        await db.assessment_periods.update_many({}, {"$set": {"is_active": False}})
        doc = _now_doc({
            "academic_year_id": ay_id,
            "semester_id": genap_id,
            "period_name": "Semester Genap 2025/2026",
            "start_date": "2026-01-06",
            "end_date": "2026-06-30",
            "status": "aktif",
            "is_active": True,
        })
        await db.assessment_periods.insert_one(doc)
        logger.info("Seeded active period Semester Genap 2025/2026")

    # Observation categories
    cat_defaults = [
        ("Persiapan", "Kegiatan perencanaan & persiapan sebelum pembelajaran PJOK.", 1),
        ("Pelaksanaan", "Aktivitas guru selama pembelajaran PJOK berlangsung.", 2),
        ("Penilaian", "Asesmen, umpan balik, refleksi & tindak lanjut.", 3),
    ]
    cat_ids = {}
    for name, desc, order in cat_defaults:
        existing = await db.observation_categories.find_one({"category_name": name})
        if not existing:
            doc = _now_doc({"category_name": name, "description": desc, "display_order": order, "status": "aktif"})
            await db.observation_categories.insert_one(doc)
            cat_ids[name] = doc["id"]
        else:
            cat_ids[name] = existing["id"]

    aspects_seed = {
        "Persiapan": [
            "Guru menyusun perangkat pembelajaran PJOK sesuai kurikulum.",
            "Guru menyiapkan tujuan pembelajaran yang sesuai dengan kompetensi.",
            "Guru menyiapkan media, alat, dan sarana olahraga sebelum pembelajaran.",
            "Guru menyesuaikan kegiatan dengan kondisi fisik dan karakteristik siswa SD.",
            "Guru menyiapkan instrumen penilaian untuk pembelajaran PJOK.",
        ],
        "Pelaksanaan": [
            "Guru membuka pembelajaran dengan apersepsi dan pemanasan.",
            "Guru menjelaskan tujuan, aturan, dan prosedur kegiatan dengan jelas.",
            "Guru memberikan contoh gerakan atau aktivitas dengan benar.",
            "Guru mengelola kelas atau lapangan dengan aman dan tertib.",
            "Guru melibatkan siswa secara aktif dalam kegiatan pembelajaran.",
            "Guru memberikan koreksi dan arahan saat siswa melakukan aktivitas.",
            "Guru memperhatikan keselamatan siswa selama pembelajaran PJOK.",
            "Guru menggunakan media atau alat olahraga secara efektif.",
        ],
        "Penilaian": [
            "Guru melakukan penilaian keterampilan gerak siswa.",
            "Guru melakukan penilaian sikap seperti disiplin, kerja sama, dan sportivitas.",
            "Guru memberikan umpan balik kepada siswa.",
            "Guru melakukan refleksi pembelajaran.",
            "Guru menyusun tindak lanjut berdasarkan hasil pembelajaran.",
        ],
    }
    for cat_name, items in aspects_seed.items():
        cid = cat_ids.get(cat_name)
        if not cid:
            continue
        for idx, name in enumerate(items, start=1):
            if await db.observation_aspects.find_one({"category_id": cid, "aspect_name": name}):
                continue
            doc = _now_doc({
                "category_id": cid,
                "aspect_name": name,
                "aspect_description": "",
                "display_order": idx,
                "status": "aktif",
            })
            await db.observation_aspects.insert_one(doc)
    logger.info("Seeded observation categories & aspects.")


async def heal_profile_links():
    """Backfill profile.user_id for users that already have linked_profile_id set.

    Idempotent: safe to run on every startup.
    """
    async for u in db.users.find({"linked_profile_id": {"$ne": None}}, {"_id": 0}):
        coll_name = PROFILE_COLLECTIONS.get(u["role"])
        if not coll_name:
            continue
        coll = db[coll_name]
        target = await coll.find_one({"id": u["linked_profile_id"]})
        if target and target.get("user_id") != u["id"]:
            await coll.update_one(
                {"id": u["linked_profile_id"]},
                {"$set": {"user_id": u["id"], "updated_at": now_iso()}},
            )
            logger.info(f"Healed link: user {u['email']} -> {coll_name}/{u['linked_profile_id']}")

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

@api.get("/")
async def root():
    return {"message": "Sistem Penilaian Kinerja Guru PJOK SD KBB API"}
