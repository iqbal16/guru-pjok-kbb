"""
Phase 3 regression — Assignment Penilaian
Covers: /api/assignments CRUD + RBAC, /assignments/me, /assignments/{id}/start,
       unique constraint, kepsek/pengawas school/role validations, dashboard
       stats per role, seed_phase3 data, audit trail (indirect).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api"

CREDS = {
    "admin": ("admin@pjok-kbb.id", "Admin@123"),
    "pengawas": ("pengawas@pjok-kbb.id", "Pengawas@123"),
    "kepala_sekolah": ("kepsek@pjok-kbb.id", "Kepsek@123"),
    "guru1": ("guru1@pjok-kbb.id", "Guru@123"),  # Ahmad - SDN Lembang 01
    "guru2": ("guru2@pjok-kbb.id", "Guru@123"),  # Dewi  - SDN Lembang 01
    "guru3": ("guru3@pjok-kbb.id", "Guru@123"),  # Rudi  - SDN Cisarua 02 (no assignment)
}


def H(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="session")
def tokens():
    out = {}
    for role, (e, p) in CREDS.items():
        r = requests.post(f"{API}/auth/login", json={"email": e, "password": p}, timeout=15)
        assert r.status_code == 200, f"login {role} failed: {r.text}"
        out[role] = r.json()["access_token"]
    return out


@pytest.fixture(scope="session")
def lookup(tokens):
    """Lookup useful seeded entities."""
    h = H(tokens["admin"])
    teachers = requests.get(f"{API}/teachers", headers=h).json()
    users = requests.get(f"{API}/users", headers=h).json()
    schools = requests.get(f"{API}/schools", headers=h).json()
    active = requests.get(f"{API}/assessment-periods/active", headers=h).json()["active"]
    return {
        "teachers": teachers,
        "users": users,
        "schools": schools,
        "active_period": active,
        "teacher_ahmad": next(t for t in teachers if t["name"].startswith("Ahmad")),
        "teacher_dewi": next(t for t in teachers if t["name"].startswith("Dewi")),
        "teacher_rudi": next(t for t in teachers if t["name"].startswith("Rudi")),
        "user_kepsek": next(u for u in users if u["email"] == "kepsek@pjok-kbb.id"),
        "user_pengawas": next(u for u in users if u["email"] == "pengawas@pjok-kbb.id"),
        "user_guru1": next(u for u in users if u["email"] == "guru1@pjok-kbb.id"),
    }


# ----------------------- SEED VERIFICATION -----------------------
class TestSeedPhase3:
    def test_two_assignments_seeded(self, tokens):
        r = requests.get(f"{API}/assignments", headers=H(tokens["admin"]))
        assert r.status_code == 200, r.text
        items = r.json()
        assert len(items) >= 2
        names = sorted([(it["teacher_name"], it["assessor_name"]) for it in items])
        # Ahmad-Hj.Siti Aminah(Kepsek), Dewi-Bambang(Pengawas)
        joined = " | ".join([f"{a}-{b}" for a, b in names])
        assert "Ahmad" in joined and "Dewi" in joined
        assert "Siti" in joined and "Bambang" in joined

    def test_seed_status_belum_dimulai(self, tokens):
        r = requests.get(f"{API}/assignments", headers=H(tokens["admin"]))
        for it in r.json():
            assert it["status"] in ("Belum Dimulai", "Draft")


# ----------------------- RBAC LIST -----------------------
class TestListRBAC:
    def test_admin_sees_all(self, tokens):
        r = requests.get(f"{API}/assignments", headers=H(tokens["admin"]))
        assert r.status_code == 200
        assert len(r.json()) >= 2

    def test_pengawas_sees_only_self_assigned(self, tokens, lookup):
        r = requests.get(f"{API}/assignments", headers=H(tokens["pengawas"]))
        assert r.status_code == 200
        items = r.json()
        for it in items:
            assert it["assessor_user_id"] == lookup["user_pengawas"]["id"]
        # at least the Dewi assignment
        assert any(it["teacher_name"].startswith("Dewi") for it in items)

    def test_kepsek_sees_only_own_school(self, tokens, lookup):
        r = requests.get(f"{API}/assignments", headers=H(tokens["kepala_sekolah"]))
        assert r.status_code == 200
        items = r.json()
        # kepsek -> SDN Lembang 01
        for it in items:
            assert "Lembang 01" in (it.get("school_name") or "")

    def test_guru_sees_only_self(self, tokens, lookup):
        r = requests.get(f"{API}/assignments", headers=H(tokens["guru1"]))
        assert r.status_code == 200
        items = r.json()
        for it in items:
            assert it["teacher_id"] == lookup["teacher_ahmad"]["id"]

    def test_guru3_no_assignment(self, tokens):
        r = requests.get(f"{API}/assignments", headers=H(tokens["guru3"]))
        assert r.status_code == 200
        assert r.json() == []


# ----------------------- /assignments/me -----------------------
class TestAssignmentsMe:
    def test_me_returns_shape(self, tokens):
        r = requests.get(f"{API}/assignments/me", headers=H(tokens["guru1"]))
        assert r.status_code == 200
        body = r.json()
        assert "active_period" in body and "assignments" in body
        assert body["active_period"] is not None
        assert len(body["assignments"]) >= 1
        a0 = body["assignments"][0]
        assert "assessor_name" in a0
        assert "period_name" in a0
        assert "status" in a0

    def test_me_guru3_empty(self, tokens):
        r = requests.get(f"{API}/assignments/me", headers=H(tokens["guru3"]))
        assert r.status_code == 200
        assert r.json()["assignments"] == []


# ----------------------- CREATE RBAC + VALIDATIONS -----------------------
class TestCreateRBACValidations:
    def test_pengawas_forbidden_create(self, tokens, lookup):
        body = {
            "teacher_id": lookup["teacher_rudi"]["id"],
            "assessor_user_id": lookup["user_pengawas"]["id"],
        }
        r = requests.post(f"{API}/assignments", json=body, headers=H(tokens["pengawas"]))
        assert r.status_code == 403

    def test_guru_forbidden_create(self, tokens, lookup):
        body = {
            "teacher_id": lookup["teacher_rudi"]["id"],
            "assessor_user_id": lookup["user_pengawas"]["id"],
        }
        r = requests.post(f"{API}/assignments", json=body, headers=H(tokens["guru1"]))
        assert r.status_code == 403

    def test_duplicate_penilaian_utama_blocked(self, tokens, lookup):
        # Ahmad already has a Penilaian Utama (by kepsek)
        body = {
            "teacher_id": lookup["teacher_ahmad"]["id"],
            "assessor_user_id": lookup["user_pengawas"]["id"],
            "assignment_type": "Penilaian Utama",
        }
        r = requests.post(f"{API}/assignments", json=body, headers=H(tokens["admin"]))
        assert r.status_code == 400
        assert "sudah memiliki penilaian utama" in r.text.lower()

    def test_invalid_assessor_role(self, tokens, lookup):
        # Use a guru as assessor -> 400
        body = {
            "teacher_id": lookup["teacher_rudi"]["id"],
            "assessor_user_id": lookup["user_guru1"]["id"],
        }
        r = requests.post(f"{API}/assignments", json=body, headers=H(tokens["admin"]))
        assert r.status_code == 400
        assert "pengawas" in r.text.lower() or "kepala sekolah" in r.text.lower()

    def test_kepsek_cannot_assign_outside_school(self, tokens, lookup):
        # kepsek belongs to Lembang 01; Rudi is in Cisarua 02.
        # Use pengawas as assessor so only creator-school check fires (403).
        body = {
            "teacher_id": lookup["teacher_rudi"]["id"],
            "assessor_user_id": lookup["user_pengawas"]["id"],
        }
        r = requests.post(f"{API}/assignments", json=body, headers=H(tokens["kepala_sekolah"]))
        assert r.status_code == 403

    def test_kepsek_as_assessor_school_mismatch(self, tokens, lookup):
        # Admin tries to put kepsek (Lembang 01) as assessor for Rudi (Cisarua 02)
        body = {
            "teacher_id": lookup["teacher_rudi"]["id"],
            "assessor_user_id": lookup["user_kepsek"]["id"],
        }
        r = requests.post(f"{API}/assignments", json=body, headers=H(tokens["admin"]))
        assert r.status_code == 400
        assert "sekolah" in r.text.lower()

    def test_teacher_not_found(self, tokens, lookup):
        body = {
            "teacher_id": "nonexistent-id",
            "assessor_user_id": lookup["user_pengawas"]["id"],
        }
        r = requests.post(f"{API}/assignments", json=body, headers=H(tokens["admin"]))
        assert r.status_code == 404


# ----------------------- ADMIN CREATE/UPDATE/DELETE happy path -----------------------
class TestAdminCRUD:
    def test_admin_create_for_rudi_and_cleanup(self, tokens, lookup):
        h = H(tokens["admin"])
        body = {
            "teacher_id": lookup["teacher_rudi"]["id"],
            "assessor_user_id": lookup["user_pengawas"]["id"],
            "observation_date": "2026-02-01",
            "notes": "TEST_phase3",
        }
        r = requests.post(f"{API}/assignments", json=body, headers=h)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["status"] == "Belum Dimulai"
        assert a["teacher_name"].startswith("Rudi")
        assert a["assessor_role"] == "Pengawas"
        aid = a["id"]

        # update observation_date
        r2 = requests.put(f"{API}/assignments/{aid}",
                          json={"observation_date": "2026-02-15", "notes": "TEST updated"},
                          headers=h)
        assert r2.status_code == 200
        assert r2.json()["observation_date"] == "2026-02-15"

        # delete
        rd = requests.delete(f"{API}/assignments/{aid}", headers=h)
        assert rd.status_code == 200

        # verify gone
        rl = requests.get(f"{API}/assignments", headers=h).json()
        assert not any(x["id"] == aid for x in rl)


# ----------------------- START FLOW -----------------------
class TestStartFlow:
    def test_guru_cannot_start(self, tokens):
        # find Ahmad's assignment
        r = requests.get(f"{API}/assignments", headers=H(tokens["admin"]))
        ahmad = next(it for it in r.json() if it["teacher_name"].startswith("Ahmad"))
        rs = requests.post(f"{API}/assignments/{ahmad['id']}/start", headers=H(tokens["guru1"]))
        assert rs.status_code == 403

    def test_other_assessor_cannot_start(self, tokens):
        # Ahmad's assessor is kepsek; pengawas should be forbidden
        r = requests.get(f"{API}/assignments", headers=H(tokens["admin"]))
        ahmad = next(it for it in r.json() if it["teacher_name"].startswith("Ahmad"))
        rs = requests.post(f"{API}/assignments/{ahmad['id']}/start", headers=H(tokens["pengawas"]))
        assert rs.status_code == 403

    def test_assessor_can_start_then_cannot_restart(self, tokens, lookup):
        # Create fresh assignment so test is idempotent across runs
        h = H(tokens["admin"])
        body = {
            "teacher_id": lookup["teacher_rudi"]["id"],
            "assessor_user_id": lookup["user_pengawas"]["id"],
        }
        r = requests.post(f"{API}/assignments", json=body, headers=h)
        assert r.status_code == 200, r.text
        aid = r.json()["id"]

        # pengawas (the assessor) starts
        rs = requests.post(f"{API}/assignments/{aid}/start", headers=H(tokens["pengawas"]))
        assert rs.status_code == 200, rs.text
        assert rs.json()["status"] == "Draft"

        # second call -> 400
        rs2 = requests.post(f"{API}/assignments/{aid}/start", headers=H(tokens["pengawas"]))
        assert rs2.status_code == 400

        # cleanup
        requests.delete(f"{API}/assignments/{aid}", headers=h)


# ----------------------- DASHBOARD STATS -----------------------
class TestDashboardStats:
    def test_admin_stats_have_phase3_fields(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=H(tokens["admin"]))
        assert r.status_code == 200
        d = r.json()
        for k in ("total_assignment_periode_aktif", "assignment_belum_dimulai",
                  "assignment_draft", "guru_sudah_assignment", "guru_belum_assignment"):
            assert k in d, k
        assert d["total_assignment_periode_aktif"] >= 2
        assert d["guru_sudah_assignment"] >= 2

    def test_pengawas_stats(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=H(tokens["pengawas"]))
        assert r.status_code == 200
        d = r.json()
        for k in ("assignment_saya", "assignment_belum_dimulai", "assignment_draft"):
            assert k in d
        assert d["assignment_saya"] >= 1

    def test_kepsek_stats(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=H(tokens["kepala_sekolah"]))
        assert r.status_code == 200
        d = r.json()
        for k in ("guru_sudah_assignment", "guru_belum_assignment", "assignment_draft"):
            assert k in d
        assert d["guru_sudah_assignment"] >= 1

    def test_guru_stats_has_my_assignment(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=H(tokens["guru1"]))
        assert r.status_code == 200
        d = r.json()
        assert "my_assignment" in d
        ma = d["my_assignment"]
        assert ma is not None
        assert ma.get("period_name")
        assert ma.get("assessor_name")
        assert ma.get("status") in ("Belum Dimulai", "Draft")

    def test_guru3_stats_no_assignment(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=H(tokens["guru3"]))
        assert r.status_code == 200
        d = r.json()
        # my_assignment may be None
        assert d.get("my_assignment") in (None, {}) or d.get("my_assignment") is None


# ----------------------- PHASE 1 + 2 SMOKE -----------------------
class TestPhase1And2Smoke:
    def test_login_all_roles(self, tokens):
        # already done in fixture; assert all are non-empty
        for v in tokens.values():
            assert isinstance(v, str) and len(v) > 10

    def test_users_list_admin(self, tokens):
        r = requests.get(f"{API}/users", headers=H(tokens["admin"]))
        assert r.status_code == 200
        assert len(r.json()) >= 6

    def test_schools_list(self, tokens):
        r = requests.get(f"{API}/schools", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_teachers_list(self, tokens):
        r = requests.get(f"{API}/teachers", headers=H(tokens["admin"]))
        assert r.status_code == 200

    def test_active_period_endpoint_still_works(self, tokens):
        r = requests.get(f"{API}/assessment-periods/active", headers=H(tokens["guru1"]))
        assert r.status_code == 200
        assert r.json().get("active") is not None

    def test_observation_categories_and_aspects(self, tokens):
        r = requests.get(f"{API}/observation-categories", headers=H(tokens["admin"]))
        assert r.status_code == 200
        r2 = requests.get(f"{API}/observation-aspects", headers=H(tokens["admin"]))
        assert r2.status_code == 200
        assert len(r2.json()) >= 18
