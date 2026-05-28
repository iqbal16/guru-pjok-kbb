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

def clean(d: dict) -> dict:
    if d is None:
        return d
    d.pop("_id", None)
    d.pop("password_hash", None)
    return d

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
    employment_status: str = "PNS"
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
        with_assignment = 0
        belum = draft = 0
        if active_id:
            with_assignment = len(await db.assessment_assignments.distinct("teacher_id", {"assessment_period_id": active_id, "assignment_type": "Penilaian Utama"}))
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
    if teacher and active_id:
        a = await db.assessment_assignments.find_one({"teacher_id": teacher["id"], "assessment_period_id": active_id}, {"_id": 0})
        if a:
            await _enrich_assignments([a])
            my_assignment = a
    return {
        "profil": teacher,
        "sekolah": school,
        "mata_pelajaran": (teacher or {}).get("subject", "PJOK"),
        "my_assignment": my_assignment,
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
    return items

@api.post("/teachers")
async def create_teacher(body: TeacherIn, user=Depends(require_roles("admin"))):
    doc = body.model_dump()
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

ASSIGNMENT_FINAL = {"Final", "Selesai"}  # reserved for later phases

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

async def _get_active_period():
    return await db.assessment_periods.find_one({"is_active": True}, {"_id": 0})

async def _enrich_assignments(items):
    if not items:
        return items
    t_ids = {x.get("teacher_id") for x in items}
    s_ids = {x.get("school_id") for x in items}
    u_ids = {x.get("assessor_user_id") for x in items}
    p_ids = {x.get("assessment_period_id") for x in items}
    teachers = {t["id"]: t async for t in db.teachers.find({"id": {"$in": list(t_ids)}}, {"_id": 0})}
    schools = {s["id"]: s async for s in db.schools.find({"id": {"$in": list(s_ids)}}, {"_id": 0})}
    users = {u["id"]: u async for u in db.users.find({"id": {"$in": list(u_ids)}}, {"_id": 0, "password_hash": 0})}
    periods = {p["id"]: p async for p in db.assessment_periods.find({"id": {"$in": list(p_ids)}}, {"_id": 0})}
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

    # If assessor is kepsek, school must match
    if assessor.get("role") == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": assessor_user_id}, {"_id": 0})
        if not principal and assessor.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": assessor["linked_profile_id"]}, {"_id": 0})
        kepsek_school = (principal or {}).get("school_id")
        if not kepsek_school or kepsek_school != teacher.get("school_id"):
            raise HTTPException(status_code=400, detail="Kepala Sekolah hanya boleh menilai guru di sekolahnya sendiri")

    # If creator is kepsek, restrict
    if creator["role"] == "kepala_sekolah":
        principal = await db.principals.find_one({"user_id": creator["id"]}, {"_id": 0})
        if not principal and creator.get("linked_profile_id"):
            principal = await db.principals.find_one({"id": creator["linked_profile_id"]}, {"_id": 0})
        creator_school = (principal or {}).get("school_id")
        if not creator_school or creator_school != teacher.get("school_id"):
            raise HTTPException(status_code=403, detail="Anda hanya boleh membuat assignment untuk guru di sekolah Anda")

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


@api.get("/assignments")
async def list_assignments(user=Depends(get_current_user)):
    scope = await _scope_for_role(user)
    items = await db.assessment_assignments.find(scope, {"_id": 0}).sort("created_at", -1).to_list(2000)
    await _enrich_assignments(items)
    return items

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

@api.post("/assignments")
async def create_assignment(body: AssignmentCreate, user=Depends(require_roles("admin", "kepala_sekolah"))):
    teacher, assessor, period = await _validate_assignment(
        body.teacher_id, body.assessor_user_id, body.assessment_period_id, user
    )
    a_type = body.assignment_type or "Penilaian Utama"
    # Uniqueness: Penilaian Utama must be unique per (teacher, period)
    if a_type == "Penilaian Utama":
        dup = await db.assessment_assignments.find_one({
            "teacher_id": body.teacher_id,
            "assessment_period_id": period["id"],
            "assignment_type": "Penilaian Utama",
        })
        if dup:
            raise HTTPException(status_code=400, detail="Guru ini sudah memiliki penilaian utama pada periode ini.")
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher["id"],
        "school_id": teacher.get("school_id"),
        "assessor_user_id": assessor["id"],
        "assessor_role": "Pengawas" if assessor["role"] == "pengawas" else "Kepala Sekolah",
        "assessment_period_id": period["id"],
        "observation_date": body.observation_date or "",
        "assignment_type": a_type,
        "status": "Belum Dimulai",
        "notes": body.notes or "",
        "created_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.assessment_assignments.insert_one(doc)
    await audit(user["id"], "create", "assessment_assignments", doc["id"], None, doc)
    doc.pop("_id", None)
    await _enrich_assignments([doc])
    return doc

@api.put("/assignments/{aid}")
async def update_assignment(aid: str, body: AssignmentUpdate, user=Depends(require_roles("admin", "kepala_sekolah"))):
    existing = await db.assessment_assignments.find_one({"id": aid})
    if not existing:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if existing.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Assignment final tidak dapat diubah")
    # Kepsek can only edit assignments in their school
    if user["role"] == "kepala_sekolah":
        scope = await _scope_for_role(user)
        if scope.get("school_id") != existing.get("school_id"):
            raise HTTPException(status_code=403, detail="Anda tidak berhak mengubah assignment ini")

    upd = body.model_dump(exclude_unset=True)
    new_teacher_id = upd.get("teacher_id", existing["teacher_id"])
    new_assessor_id = upd.get("assessor_user_id", existing["assessor_user_id"])
    new_type = upd.get("assignment_type", existing.get("assignment_type", "Penilaian Utama"))

    teacher, assessor, period = await _validate_assignment(
        new_teacher_id, new_assessor_id, existing["assessment_period_id"], user
    )
    if new_type == "Penilaian Utama":
        dup = await db.assessment_assignments.find_one({
            "teacher_id": new_teacher_id,
            "assessment_period_id": existing["assessment_period_id"],
            "assignment_type": "Penilaian Utama",
            "id": {"$ne": aid},
        })
        if dup:
            raise HTTPException(status_code=400, detail="Guru ini sudah memiliki penilaian utama pada periode ini.")

    upd["school_id"] = teacher.get("school_id")
    upd["assessor_role"] = "Pengawas" if assessor["role"] == "pengawas" else "Kepala Sekolah"
    upd["updated_at"] = now_iso()
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "update", "assessment_assignments", aid, clean(existing), upd)
    new_doc = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([new_doc])
    return new_doc

@api.delete("/assignments/{aid}")
async def delete_assignment(aid: str, user=Depends(require_roles("admin", "kepala_sekolah"))):
    existing = await db.assessment_assignments.find_one({"id": aid})
    if not existing:
        raise HTTPException(status_code=404, detail="Assignment tidak ditemukan")
    if existing.get("status") in ASSIGNMENT_FINAL:
        raise HTTPException(status_code=400, detail="Assignment final tidak dapat dihapus")
    if user["role"] == "kepala_sekolah":
        scope = await _scope_for_role(user)
        if scope.get("school_id") != existing.get("school_id"):
            raise HTTPException(status_code=403, detail="Anda tidak berhak menghapus assignment ini")
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
    upd = {"status": "Draft", "updated_at": now_iso()}
    await db.assessment_assignments.update_one({"id": aid}, {"$set": upd})
    await audit(user["id"], "start", "assessment_assignments", aid, {"status": existing.get("status")}, upd)
    new_doc = await db.assessment_assignments.find_one({"id": aid}, {"_id": 0})
    await _enrich_assignments([new_doc])
    return new_doc


# ---------------------------------------------------------------------------
# Mount router + middleware
# ---------------------------------------------------------------------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
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
        ("Rudi Hartono, S.Pd.", "guru3@pjok-kbb.id", "Guru@123", "198812202018011003", sd2_id, "PPPK"),
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
    await db.assessment_assignments.create_index(
        [("teacher_id", 1), ("assessment_period_id", 1), ("assignment_type", 1)],
        unique=True,
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
