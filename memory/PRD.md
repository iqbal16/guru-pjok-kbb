# Sistem Penilaian Kinerja Guru PJOK SD — Kabupaten Bandung Barat

## Original Problem Statement
Aplikasi web full-stack untuk Penilaian Kinerja Guru Penjas/PJOK SD di wilayah Kabupaten Bandung Barat. Tahap pertama fokus pada fondasi sistem: authentication, role-based access control, database schema, dashboard dasar, dan master data.

**Scope**: Jenjang SD • Wilayah Kabupaten Bandung Barat • Mapel Penjas/PJOK • UI Bahasa Indonesia penuh.

## Architecture
- **Backend**: FastAPI + Motor (async MongoDB) + JWT Bearer auth (PyJWT) + bcrypt password hashing
- **Frontend**: React 19 + React Router 7 + TailwindCSS + shadcn/ui + Sonner toasts + Lucide icons
- **Database**: MongoDB (DB: `pjok_kbb_db`)
- **Auth**: JWT Bearer token in `Authorization` header, 8h expiry, token stored in localStorage

## User Personas / Roles
1. **Admin** — Full CRUD semua data, manage user & role.
2. **Pengawas** — View only, dibatasi wilayah kerja (kecamatan).
3. **Kepala Sekolah** — View only, dibatasi guru di sekolahnya.
4. **Guru** — Hanya melihat profil sendiri.

## Core Requirements (static)
- Bahasa Indonesia penuh untuk semua label/menu/status/validasi.
- Role-based sidebar & route guards.
- Master data: schools, teachers, supervisors, principals, users.
- Audit logs otomatis (backend) untuk setiap mutasi.
- Email unik, profil dapat dihubungkan ke user (linked_profile_id).

## What's Been Implemented (28 Mei 2026)

### Tahap 2 — Periode Penilaian & Komponen Observasi PJOK (28 Mei 2026)
- **Schema baru**: `academic_years`, `semesters`, `assessment_periods`, `observation_categories`, `observation_aspects` (UUID + ISO datetime).
- **Endpoints**: full CRUD untuk 5 koleksi + `POST /api/assessment-periods/{id}/activate` + `GET /api/assessment-periods/active`. RBAC: admin full CRUD; pengawas/kepsek/guru hanya melihat data aktif. Aspek non-aktif disembunyikan dari non-admin.
- **Constraint database**: unique pada `academic_years.year_name`, `semesters.semester_name`, `semesters.semester_order`, `(assessment_periods.academic_year_id, semester_id)`, `observation_categories.category_name`. Hanya 1 periode bisa `is_active=true` (auto-deactivate yang lain saat aktivasi/create/update).
- **Seed Phase 2**: 1 AY 2025/2026, 2 semester (Ganjil/Genap), 1 active period 'Semester Genap 2025/2026', 3 kategori, 18 aspek.
- **Frontend baru** (5 halaman): AcademicYears, Semesters, AssessmentPeriods (admin CRUD + read-only card untuk non-admin), ObservationCategories (admin CRUD + read-only untuk non-admin, dengan referensi skor 1-4), ObservationAspects.
- **Sidebar** diorganisir 3 section: "Master Data", "Periode & Instrumen", "Sistem".
- **Dashboard** badge `active-period-badge` ambil dari `/api/assessment-periods/active` (fallback "Belum ada periode aktif").
- **Audit log**: otomatis untuk create/update/delete + activate pada 5 koleksi baru.

### Testing
- Backend: **56/56 pytest pass** (Phase 1: 34 + Phase 2: 22, termasuk RBAC, uniqueness, activate auto-deactivate, nonaktif filter).
- Frontend: Playwright e2e — sidebar role-based dengan 12 menu admin / 4 menu guru, semua halaman baru dapat dibuka & berfungsi, read-only views non-admin sesuai spec.

### Tahap 1 — Fondasi (sebelumnya)

### Backend
- Schema: `users`, `schools`, `teachers`, `supervisors`, `principals`, `role_permissions`, `audit_logs` (UUID-based IDs, ISO datetime strings).
- Endpoints:
  - `POST /api/auth/login`, `GET /api/auth/me`
  - `GET /api/dashboard/stats` (role-aware)
  - `GET/POST/PUT/DELETE /api/users` (admin only; self-delete blocked)
  - `GET/POST/PUT/DELETE /api/schools` (admin CRUD; others read)
  - `GET/POST/PUT/DELETE /api/teachers` (admin CRUD; pengawas filter wilayah; kepsek filter sekolah; guru hanya diri)
  - `GET/POST/PUT/DELETE /api/supervisors` (admin CRUD; pengawas read own)
  - `GET/POST/PUT/DELETE /api/principals` (admin CRUD; kepsek read own)
  - `GET /api/permissions`, `PUT /api/permissions/{id}` (matrix 4 role x 7 menu = 28 baris)
  - `GET /api/profile/me`
- Indexes: unique pada `users.email`, `schools.npsn`, `(role_permissions.role, menu_name)`.
- Audit log otomatis pada create/update/delete + login.
- Seed otomatis: 1 admin, 1 pengawas (wilayah Lembang), 1 kepsek (SDN Lembang 01), 3 guru, 2 SD (SDN Lembang 01 & SDN Cisarua 02), 28 role_permissions.

### Frontend
- Halaman: Login (split-screen branding KBB), Dashboard role-aware, Manajemen Pengguna, Data Sekolah, Data Guru, Data Pengawas, Data Kepala Sekolah, Pengaturan Hak Akses (Tabs + checkbox matrix), Profil (guru).
- Layout: Sidebar emerald-950 dengan menu filter by role, Topbar dengan Avatar + dropdown Keluar.
- Komponen tabel dengan search, filter, dialog tambah/edit, AlertDialog konfirmasi hapus.
- Toast Bahasa Indonesia via Sonner.
- Tipografi: Outfit (heading) + Plus Jakarta Sans (body). Palet Emerald (#047857) + Orange (#F97316).
- Semua elemen interaktif memiliki `data-testid` kebab-case.

### Testing
- Backend: 34/34 pytest pass (auth, dashboard stats per role, RBAC matrix, CRUD, persistence).
- Frontend: Playwright e2e — login, dashboard per role, sidebar role-based, CRUD pages, logout.

## Test Credentials (di `/app/memory/test_credentials.md`)
| Role           | Email                   | Password      |
|----------------|-------------------------|---------------|
| admin          | admin@pjok-kbb.id       | Admin@123     |
| pengawas       | pengawas@pjok-kbb.id    | Pengawas@123  |
| kepala_sekolah | kepsek@pjok-kbb.id      | Kepsek@123    |
| guru           | guru1@pjok-kbb.id       | Guru@123      |
| guru           | guru2@pjok-kbb.id       | Guru@123      |
| guru           | guru3@pjok-kbb.id       | Guru@123      |

## Prioritized Backlog (Next Phases)

### P0 — Tahap 2 (Penilaian Inti)
- Skema `assessments` dan `assessment_periods` (semester, tahun ajaran).
- Form penilaian kinerja oleh Pengawas & Kepala Sekolah (rubrik observasi PJOK).
- Constraint: 1 guru = 1 penilaian utama per semester.
- Dashboard hasil penilaian (skor, kategori, rekomendasi).

### P1 — Pengayaan
- UI viewer Audit Log (filter by user/table/range tanggal).
- Lupa kata sandi (forgot/reset password) + email integration.
- Brute force / rate limit pada login.
- Export PDF/Excel rekap penilaian.
- Bulk import sekolah/guru via CSV.

### P2 — Nice to have
- Notifikasi in-app (penilaian baru, deadline).
- Multi-period comparison & chart kinerja per guru.
- Profile picture upload (object storage).
- Penugasan pengawas → sekolah (assignment table) menggantikan filter wilayah kecamatan.

## Known Limitations
- Wilayah pengawas saat ini di-match string `subdistrict` (kecamatan); cocok untuk MVP, tapi assignment eksplisit lebih baik di P2.
- Tidak ada lockout/rate limit pada login.
- Audit log hanya disimpan di DB (belum ada UI viewer).
