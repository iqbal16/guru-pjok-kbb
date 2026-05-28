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
    if role == "admin":
        return {
            "total_sekolah": await db.schools.count_documents({"status": "aktif"}),
            "total_guru": await db.teachers.count_documents({"status": "aktif"}),
            "total_pengawas": await db.supervisors.count_documents({"status": "aktif"}),
            "total_kepala_sekolah": await db.principals.count_documents({"status": "aktif"}),
            "total_user_aktif": await db.users.count_documents({"status": "aktif"}),
        }
    if role == "pengawas":
        sup = await db.supervisors.find_one({"user_id": user["id"]}, {"_id": 0})
        work_area = (sup or {}).get("work_area", "")
        school_query = {"status": "aktif"}
        if work_area:
            school_query["subdistrict"] = work_area
        sekolah_count = await db.schools.count_documents(school_query)
        school_ids = [s["id"] async for s in db.schools.find(school_query, {"id": 1, "_id": 0})]
        guru_count = await db.teachers.count_documents({"school_id": {"$in": school_ids}, "status": "aktif"}) if school_ids else 0
        return {
            "total_sekolah_wilayah": sekolah_count,
            "total_guru_wilayah": guru_count,
            "wilayah_kerja": work_area or "Belum diatur",
        }
    if role == "kepala_sekolah":
        prin = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        school_id = (prin or {}).get("school_id")
        guru_count = await db.teachers.count_documents({"school_id": school_id, "status": "aktif"}) if school_id else 0
        sekolah = await db.schools.find_one({"id": school_id}, {"_id": 0}) if school_id else None
        return {
            "total_guru_sekolah": guru_count,
            "nama_sekolah": (sekolah or {}).get("school_name", "Belum diatur"),
        }
    # guru
    teacher = await db.teachers.find_one({"user_id": user["id"]}, {"_id": 0})
    school = await db.schools.find_one({"id": (teacher or {}).get("school_id")}, {"_id": 0}) if teacher else None
    return {
        "profil": teacher,
        "sekolah": school,
        "mata_pelajaran": (teacher or {}).get("subject", "PJOK"),
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
    await audit(user["id"], "create", "users", doc["id"], None, {"email": email, "role": body.role})
    return clean(doc)

@api.put("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, user=Depends(require_roles("admin"))):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "password" in upd:
        upd["password_hash"] = hash_password(upd.pop("password"))
    if "email" in upd:
        upd["email"] = upd["email"].lower().strip()
        if upd["email"] != existing["email"] and await db.users.find_one({"email": upd["email"]}):
            raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    upd["updated_at"] = now_iso()
    await db.users.update_one({"id": user_id}, {"$set": upd})
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
    if role == "guru":
        teacher = await db.teachers.find_one({"user_id": user["id"]}, {"_id": 0})
        school = await db.schools.find_one({"id": (teacher or {}).get("school_id")}, {"_id": 0}) if teacher else None
        return {"user": user, "teacher": teacher, "school": school}
    if role == "pengawas":
        sup = await db.supervisors.find_one({"user_id": user["id"]}, {"_id": 0})
        return {"user": user, "supervisor": sup}
    if role == "kepala_sekolah":
        prin = await db.principals.find_one({"user_id": user["id"]}, {"_id": 0})
        school = await db.schools.find_one({"id": (prin or {}).get("school_id")}, {"_id": 0}) if prin else None
        return {"user": user, "principal": prin, "school": school}
    return {"user": user}

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
    await seed_permissions()
    await seed_data()

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

@api.get("/")
async def root():
    return {"message": "Sistem Penilaian Kinerja Guru PJOK SD KBB API"}
