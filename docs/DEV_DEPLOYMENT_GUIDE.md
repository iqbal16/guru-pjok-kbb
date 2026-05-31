# Panduan Deployment DEV Online

Panduan ini untuk menyiapkan environment development aplikasi Penilaian Kinerja Guru PJOK SD KBB.

Target:
- Frontend: Vercel
- Backend: Render
- Database: MongoDB Atlas
- Branch deploy: `develop`
- Environment: development, bukan production

## 1. Buat Branch `develop`

Di lokal:

```powershell
git checkout main
git pull origin main
git checkout -b develop
```

Jika branch `develop` sudah ada:

```powershell
git checkout develop
git pull origin develop
```

Push branch saat sudah siap:

```powershell
git push -u origin develop
```

## 2. Siapkan MongoDB Atlas DEV

1. Buka MongoDB Atlas.
2. Buat database khusus DEV, contoh: `guru_pjok_kbb_dev`.
3. Buat database user khusus DEV.
4. Izinkan akses IP Render. Untuk DEV bisa gunakan `0.0.0.0/0`, lalu kencangkan lagi nanti jika sudah stabil.
5. Copy connection string MongoDB Atlas.
6. Pastikan connection string memakai format:

```text
mongodb+srv://USER:PASSWORD@HOST/?retryWrites=true&w=majority
```

Jangan commit connection string ke repo.

## 3. Deploy Backend ke Render

Opsi yang disiapkan repo:

- Config file: `render.yaml`
- Root directory: `backend`
- Build command: `pip install -r requirements-render.txt`
- Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`

Langkah di Render:

1. Buka Render.
2. New Web Service.
3. Connect repository GitHub.
4. Pilih branch `develop`.
5. Jika Render membaca `render.yaml`, pakai konfigurasi dari file tersebut.
6. Jika manual:
   - Root Directory: `backend`
   - Runtime: Python
   - Build Command: `pip install -r requirements-render.txt`
   - Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`

## 4. Set Environment Variable Backend di Render

Isi variable berikut:

```text
APP_ENV=development
MONGO_URL=<connection-string-mongodb-atlas-dev>
DB_NAME=guru_pjok_kbb_dev
JWT_SECRET=<random-secret-yang-kuat>
FRONTEND_URL=<url-vercel-dev>
```

Catatan:
- `FRONTEND_URL` dipakai untuk CORS jika `CORS_ORIGINS` tidak diisi.
- Jika perlu allow lebih dari satu origin, tambahkan `CORS_ORIGINS` manual, contoh:

```text
CORS_ORIGINS=https://app-dev.vercel.app,http://localhost:3000
```

## 5. Deploy Frontend ke Vercel

Opsi yang disiapkan repo:

- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `build`
- Config file: `frontend/vercel.json`

Langkah di Vercel:

1. Buka Vercel.
2. Add New Project.
3. Import repository GitHub.
4. Pilih branch `develop`.
5. Set Root Directory ke `frontend`.
6. Framework preset: Create React App.
7. Build Command: `npm run build`.
8. Output Directory: `build`.

## 6. Set Environment Variable Frontend di Vercel

Isi variable berikut:

```text
REACT_APP_BACKEND_URL=<url-render-backend-tanpa-/api>
REACT_APP_ENV=development
```

Contoh:

```text
REACT_APP_BACKEND_URL=https://guru-pjok-kbb-api-dev.onrender.com
REACT_APP_ENV=development
```

Frontend otomatis menambahkan `/api` dari `frontend/src/lib/api.js`, jadi jangan isi `REACT_APP_BACKEND_URL` dengan `/api` di belakangnya.

## 7. Update CORS / FRONTEND_URL di Render

Setelah Vercel deploy selesai:

1. Copy URL frontend Vercel DEV.
2. Buka service backend di Render.
3. Update environment variable:

```text
FRONTEND_URL=https://<frontend-dev>.vercel.app
```

4. Redeploy backend Render.
5. Jika memakai preview URL Vercel yang berubah-ubah, gunakan `CORS_ORIGINS` dengan daftar origin yang ingin diizinkan.

## 8. Smoke Test DEV

Cek backend:

```text
https://<backend-render>.onrender.com/docs
https://<backend-render>.onrender.com/api/
```

Cek frontend:

```text
https://<frontend-vercel>.vercel.app
```

Smoke test minimal:

1. Buka halaman login.
2. Login Admin.
3. Buka Dashboard.
4. Buka Assignment Penilaian.
5. Buka Audit Log dan pastikan tidak error 500.
6. Login Pengawas.
7. Login Kepala Sekolah.
8. Login Guru.
9. Cek Report Penilaian.
10. Pastikan Export PDF hanya aktif saat data eligible.

## 9. Jalankan Automation Test ke DEV

Automation E2E tetap dijalankan dari lokal/CI, bukan saat build Vercel.

Update `.env.test` lokal:

```text
E2E_BASE_URL=https://<frontend-vercel>.vercel.app
E2E_API_BASE_URL=https://<backend-render>.onrender.com
```

Lalu jalankan:

```powershell
cd frontend
yarn test:e2e --project=chromium
```

Atau untuk melihat report:

```powershell
yarn test:e2e:report
```

## 10. Command Lokal

Backend lokal:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

Frontend lokal:

```powershell
cd frontend
yarn start
```

Build frontend:

```powershell
cd frontend
npm run build
```

Automation test:

```powershell
cd frontend
yarn test:e2e --project=chromium
```

## Catatan Dependency

`backend/requirements.txt` masih berisi dependency internal `emergentintegrations==0.1.2`.

Untuk Render DEV gunakan:

```text
backend/requirements-render.txt
```

File tersebut menghapus dependency internal yang berisiko tidak tersedia di PyPI, tanpa mengubah business logic aplikasi.
