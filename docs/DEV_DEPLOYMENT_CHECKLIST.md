# Checklist Deployment DEV

## Branch

- [ ] Branch `develop` sudah dibuat.
- [ ] Branch `develop` sudah push ke GitHub.
- [ ] Vercel dan Render diarahkan ke branch `develop`.

## MongoDB Atlas DEV

- [ ] Database DEV dibuat, contoh `guru_pjok_kbb_dev`.
- [ ] Database user DEV dibuat.
- [ ] Connection string MongoDB Atlas DEV tersedia.
- [ ] IP access Render sudah diizinkan.
- [ ] Secret MongoDB tidak masuk repo.

## Backend Render

- [ ] Service Render DEV dibuat.
- [ ] Root directory backend adalah `backend`.
- [ ] Build command: `pip install -r requirements-render.txt`.
- [ ] Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`.
- [ ] Environment variable Render sudah diisi:
  - [ ] `APP_ENV=development`
  - [ ] `MONGO_URL`
  - [ ] `DB_NAME=guru_pjok_kbb_dev`
  - [ ] `JWT_SECRET`
  - [ ] `FRONTEND_URL`
- [ ] Backend Render live.
- [ ] Backend `/docs` bisa dibuka.
- [ ] Backend `/api/` bisa dibuka.

## Frontend Vercel

- [ ] Project Vercel DEV dibuat.
- [ ] Root directory frontend adalah `frontend`.
- [ ] Build command: `npm run build`.
- [ ] Output directory: `build`.
- [ ] Environment variable Vercel sudah diisi:
  - [ ] `REACT_APP_BACKEND_URL`
  - [ ] `REACT_APP_ENV=development`
- [ ] Frontend Vercel live.

## CORS

- [ ] `FRONTEND_URL` di Render sudah diisi URL Vercel DEV.
- [ ] Backend Render sudah redeploy setelah update `FRONTEND_URL`.
- [ ] Frontend bisa request API tanpa CORS error.

## Smoke Test

- [ ] Login Admin berhasil.
- [ ] Login Pengawas berhasil.
- [ ] Login Kepala Sekolah berhasil.
- [ ] Login Guru berhasil.
- [ ] Dashboard Admin tampil.
- [ ] Assignment Penilaian tampil.
- [ ] Audit Log tidak error 500.
- [ ] Report Penilaian tampil.
- [ ] Export PDF rule aman, hanya aktif saat eligible.
- [ ] Notifikasi bisa dibuka.

## Automation Test

- [ ] `.env.test` lokal diarahkan ke URL DEV.
- [ ] `E2E_BASE_URL` berisi URL frontend Vercel DEV.
- [ ] `E2E_API_BASE_URL` berisi URL backend Render DEV.
- [ ] Automation test bisa jalan ke DEV.
- [ ] `test-results/` tidak ikut commit.
- [ ] `playwright-report/` tidak ikut commit.
