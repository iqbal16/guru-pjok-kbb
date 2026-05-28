"""
Backend regression tests — Sistem Penilaian Kinerja Guru PJOK SD KBB
Covers: auth, dashboard stats per role, users CRUD, schools CRUD,
teachers/supervisors/principals RBAC, permissions, profile.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if os.environ.get('REACT_APP_BACKEND_URL') else None

# Fallback: read from frontend/.env if env var not set in process
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                break

API = f"{BASE_URL}/api"

CREDS = {
    "admin": ("admin@pjok-kbb.id", "Admin@123"),
    "pengawas": ("pengawas@pjok-kbb.id", "Pengawas@123"),
    "kepala_sekolah": ("kepsek@pjok-kbb.id", "Kepsek@123"),
    "guru": ("guru1@pjok-kbb.id", "Guru@123"),
}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


@pytest.fixture(scope="session")
def tokens():
    out = {}
    for role, (email, pw) in CREDS.items():
        r = _login(email, pw)
        assert r.status_code == 200, f"login failed for {role}: {r.status_code} {r.text}"
        out[role] = r.json()["access_token"]
    return out


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ---------------------------- AUTH --------------------------------------
class TestAuth:
    def test_login_admin_returns_token_and_user(self):
        r = _login(*CREDS["admin"])
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body and len(body["access_token"]) > 10
        assert body["user"]["role"] == "admin"
        assert body["user"]["email"] == "admin@pjok-kbb.id"
        assert "password_hash" not in body["user"]

    @pytest.mark.parametrize("role", ["pengawas", "kepala_sekolah", "guru"])
    def test_login_other_roles(self, role):
        r = _login(*CREDS[role])
        assert r.status_code == 200
        assert r.json()["user"]["role"] == role

    def test_login_wrong_password_returns_401(self):
        r = _login("admin@pjok-kbb.id", "WrongPass!")
        assert r.status_code == 401
        assert "Email atau kata sandi salah" in r.json().get("detail", "")

    def test_login_unknown_email_returns_401(self):
        r = _login("nobody@pjok-kbb.id", "x")
        assert r.status_code == 401

    def test_me_with_valid_token(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_me_without_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------------------------- DASHBOARD STATS ---------------------------
class TestDashboardStats:
    def test_admin_stats(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        d = r.json()
        for k in ["total_sekolah", "total_guru", "total_pengawas", "total_kepala_sekolah", "total_user_aktif"]:
            assert k in d, f"missing key {k}"
        assert d["total_sekolah"] >= 2
        assert d["total_guru"] >= 3
        assert d["total_user_aktif"] >= 5

    def test_pengawas_stats(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=_h(tokens["pengawas"]))
        assert r.status_code == 200
        d = r.json()
        assert "total_sekolah_wilayah" in d
        assert "total_guru_wilayah" in d
        assert d["wilayah_kerja"] == "Lembang"

    def test_kepala_sekolah_stats(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=_h(tokens["kepala_sekolah"]))
        assert r.status_code == 200
        d = r.json()
        assert "total_guru_sekolah" in d
        assert "SDN Lembang 01" in d.get("nama_sekolah", "")

    def test_guru_stats(self, tokens):
        r = requests.get(f"{API}/dashboard/stats", headers=_h(tokens["guru"]))
        assert r.status_code == 200
        d = r.json()
        assert d.get("mata_pelajaran") == "PJOK"
        assert d.get("profil") is not None
        assert d.get("sekolah") is not None


# ---------------------------- USERS CRUD --------------------------------
class TestUsers:
    def test_list_users_admin_only(self, tokens):
        r = requests.get(f"{API}/users", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    @pytest.mark.parametrize("role", ["pengawas", "kepala_sekolah", "guru"])
    def test_list_users_forbidden_other_roles(self, tokens, role):
        r = requests.get(f"{API}/users", headers=_h(tokens[role]))
        assert r.status_code == 403

    def test_create_update_delete_user_persistence(self, tokens):
        h = _h(tokens["admin"])
        email = f"test_{uuid.uuid4().hex[:8]}@pjok-kbb.id"
        # create
        r = requests.post(f"{API}/users", json={
            "name": "Test User", "email": email, "password": "Test@123", "role": "guru"
        }, headers=h)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        assert r.json()["email"] == email
        # duplicate email
        r2 = requests.post(f"{API}/users", json={
            "name": "Dup", "email": email, "password": "x", "role": "guru"
        }, headers=h)
        assert r2.status_code == 400
        # list contains it
        lst = requests.get(f"{API}/users", headers=h).json()
        assert any(u["id"] == uid for u in lst)
        # update without password
        r3 = requests.put(f"{API}/users/{uid}", json={"name": "Test User Updated"}, headers=h)
        assert r3.status_code == 200
        assert r3.json()["name"] == "Test User Updated"
        # delete
        r4 = requests.delete(f"{API}/users/{uid}", headers=h)
        assert r4.status_code == 200
        # verify gone
        lst2 = requests.get(f"{API}/users", headers=h).json()
        assert not any(u["id"] == uid for u in lst2)

    def test_cannot_delete_self(self, tokens):
        h = _h(tokens["admin"])
        me = requests.get(f"{API}/auth/me", headers=h).json()
        r = requests.delete(f"{API}/users/{me['id']}", headers=h)
        assert r.status_code == 400


# ---------------------------- SCHOOLS CRUD ------------------------------
class TestSchools:
    def test_list_schools_all_roles(self, tokens):
        for role in tokens:
            r = requests.get(f"{API}/schools", headers=_h(tokens[role]))
            assert r.status_code == 200, f"{role}: {r.status_code}"
            assert isinstance(r.json(), list)

    def test_admin_crud_school(self, tokens):
        h = _h(tokens["admin"])
        npsn = f"TST{uuid.uuid4().hex[:6].upper()}"
        # create
        r = requests.post(f"{API}/schools", json={
            "npsn": npsn, "school_name": "SDN TEST 99",
            "subdistrict": "Padalarang", "address": "Jl. Test"
        }, headers=h)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        # update
        r2 = requests.put(f"{API}/schools/{sid}", json={
            "npsn": npsn, "school_name": "SDN TEST 99 UPD",
            "subdistrict": "Padalarang", "address": "Jl. Test 2"
        }, headers=h)
        assert r2.status_code == 200
        assert r2.json()["school_name"] == "SDN TEST 99 UPD"
        # delete
        r3 = requests.delete(f"{API}/schools/{sid}", headers=h)
        assert r3.status_code == 200

    def test_non_admin_cannot_create_school(self, tokens):
        for role in ["pengawas", "kepala_sekolah", "guru"]:
            r = requests.post(f"{API}/schools", json={
                "npsn": "999", "school_name": "x", "subdistrict": "Lembang"
            }, headers=_h(tokens[role]))
            assert r.status_code == 403, role


# ---------------------------- TEACHERS RBAC ------------------------------
class TestTeachers:
    def test_admin_sees_all(self, tokens):
        r = requests.get(f"{API}/teachers", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        assert len(r.json()) >= 3

    def test_guru_sees_only_self(self, tokens):
        r = requests.get(f"{API}/teachers", headers=_h(tokens["guru"]))
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["subject"] == "PJOK"

    def test_kepala_sekolah_sees_school_teachers(self, tokens):
        r = requests.get(f"{API}/teachers", headers=_h(tokens["kepala_sekolah"]))
        assert r.status_code == 200
        # kepsek bound to SDN Lembang 01 with 2 guru
        assert len(r.json()) == 2

    def test_pengawas_sees_wilayah(self, tokens):
        r = requests.get(f"{API}/teachers", headers=_h(tokens["pengawas"]))
        assert r.status_code == 200
        # wilayah Lembang -> guru1, guru2 (sd1)
        assert len(r.json()) == 2

    def test_non_admin_cannot_create_teacher(self, tokens):
        for role in ["pengawas", "kepala_sekolah", "guru"]:
            r = requests.post(f"{API}/teachers", json={"name": "x"}, headers=_h(tokens[role]))
            assert r.status_code == 403, role


# ---------------------------- SUPERVISORS / PRINCIPALS -------------------
class TestSupervisorsPrincipals:
    def test_supervisors_admin_list(self, tokens):
        r = requests.get(f"{API}/supervisors", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_supervisors_forbidden_guru_kepsek(self, tokens):
        for role in ["guru", "kepala_sekolah"]:
            r = requests.get(f"{API}/supervisors", headers=_h(tokens[role]))
            assert r.status_code == 403, role

    def test_principals_kepsek_sees_self(self, tokens):
        r = requests.get(f"{API}/principals", headers=_h(tokens["kepala_sekolah"]))
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1

    def test_principals_guru_forbidden(self, tokens):
        r = requests.get(f"{API}/principals", headers=_h(tokens["guru"]))
        assert r.status_code == 403


# ---------------------------- PERMISSIONS --------------------------------
class TestPermissions:
    def test_list_permissions_4_roles_x_7_menus(self, tokens):
        r = requests.get(f"{API}/permissions", headers=_h(tokens["admin"]))
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) == 28, f"expected 28, got {len(rows)}"
        # All 4 roles present
        roles = {row["role"] for row in rows}
        assert roles == {"admin", "pengawas", "kepala_sekolah", "guru"}

    def test_permissions_readable_by_all(self, tokens):
        for role in tokens:
            r = requests.get(f"{API}/permissions", headers=_h(tokens[role]))
            assert r.status_code == 200

    def test_update_permission_admin_only(self, tokens):
        rows = requests.get(f"{API}/permissions", headers=_h(tokens["admin"])).json()
        pid = rows[0]["id"]
        # non-admin
        r = requests.put(f"{API}/permissions/{pid}", json={"can_create": False, "can_read": True}, headers=_h(tokens["guru"]))
        assert r.status_code == 403
        # admin: revert to original to avoid side-effects
        orig = rows[0]
        r2 = requests.put(f"{API}/permissions/{pid}", json={
            "can_create": orig.get("can_create", False),
            "can_read": orig.get("can_read", False),
            "can_update": orig.get("can_update", False),
            "can_delete": orig.get("can_delete", False),
        }, headers=_h(tokens["admin"]))
        assert r2.status_code == 200


# ---------------------------- PROFILE ------------------------------------
class TestProfile:
    def test_guru_profile(self, tokens):
        r = requests.get(f"{API}/profile/me", headers=_h(tokens["guru"]))
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["role"] == "guru"
        assert d["teacher"] is not None
        assert d["school"] is not None
        assert d["school"]["school_name"]
