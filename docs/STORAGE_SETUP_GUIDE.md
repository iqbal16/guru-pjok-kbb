# Panduan Storage Bukti Pendukung DEV

Fitur Bukti Pendukung Penilaian menyimpan metadata file di MongoDB dan binary file di object storage persistent.

Jangan gunakan local filesystem Render/Vercel untuk file bukti pendukung karena storage deployment dapat hilang saat restart/redeploy.

## Provider Yang Didukung

Backend menggunakan S3-compatible storage melalui environment variable.

Contoh provider:

- Cloudflare R2
- AWS S3
- MinIO
- provider lain yang kompatibel dengan S3 API

## Environment Variable Backend

Isi variable berikut di Render:

```env
STORAGE_PROVIDER=s3
STORAGE_BUCKET=
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_REGION=auto
MAX_DOCUMENT_SIZE_MB=10
MAX_VIDEO_SIZE_MB=50
```

Catatan:

- Untuk Cloudflare R2, `STORAGE_ENDPOINT` biasanya berbentuk `https://<account-id>.r2.cloudflarestorage.com`.
- Bucket sebaiknya private.
- Jangan membuat object/file public.
- Preview dan download dilakukan lewat endpoint backend yang memverifikasi permission lebih dulu.

## Local Development

Untuk lokal boleh memakai:

```env
STORAGE_PROVIDER=local
MAX_DOCUMENT_SIZE_MB=10
MAX_VIDEO_SIZE_MB=50
```

File lokal akan disimpan di:

```text
backend/storage_uploads/
```

Folder tersebut tidak boleh dipakai sebagai storage production/deployment.

## Smoke Test

1. Login sebagai Guru.
2. Buka menu **Bukti Pendukung Penilaian**.
3. Upload 1 dokumen PDF/Word/Excel.
4. Upload 1 video MP4/MOV/WEBM kecil.
5. Pastikan status berubah menjadi **Siap Dinilai**.
6. Login sebagai Pengawas/Kepala Sekolah terkait.
7. Buka assignment Guru tersebut.
8. Pastikan section **Bukti Pendukung Guru** menampilkan file yang sama.
9. Klik Preview/Download.
10. Klik Mulai Penilaian.
11. Pastikan status bukti berubah menjadi **Terkunci** dan Guru tidak bisa menghapus/upload ulang.
