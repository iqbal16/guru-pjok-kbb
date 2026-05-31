# QA Tahap 8 - Audit Log, Notifikasi, Emergency Unlock, Force Final

Gunakan checklist ini setelah backend dan frontend berjalan lokal.

## Audit Log UI

- Login sebagai Admin.
- Buka menu `Audit Log`.
- Pastikan daftar audit tampil dengan waktu, user, role, aksi, modul, dan ringkasan perubahan.
- Coba filter berdasarkan tanggal, user, role, aksi, modul, dan pencarian.
- Klik detail audit, pastikan `Old Values` dan `New Values` dapat dibaca.
- Login sebagai role non-Admin dan pastikan URL audit log tidak bisa diakses.

## Notifikasi

- Login sebagai Admin, Kepala Sekolah, Pengawas, dan Guru.
- Pastikan menu `Notifikasi` bisa dibuka.
- Jalankan aksi yang memicu notifikasi: buat assignment, kirim ke guru, feedback guru, finalisasi, emergency unlock, atau force final.
- Pastikan penerima yang sesuai mendapat notifikasi.
- Klik `Tandai Dibaca` dan `Tandai Semua Dibaca`.
- Pastikan badge jumlah notifikasi belum dibaca di topbar berubah.

## Emergency Unlock

- Login sebagai Admin.
- Cari assignment berstatus `Final`.
- Buka menu aksi, pilih `Emergency Unlock`.
- Coba submit tanpa alasan, pastikan field alasan merah dan form scroll/focus ke error.
- Isi alasan, submit.
- Pastikan status berubah menjadi `Draft Revisi`.
- Pastikan tanda tangan terkait berubah menjadi perlu diperbarui.
- Pastikan aktivitas tercatat di Audit Log dan notifikasi terkirim.

## Force Final

- Login sebagai Admin.
- Cari assignment belum Final yang sudah memenuhi syarat:
  - semua aspek resmi sudah dinilai,
  - Evaluasi & RTL lengkap,
  - tanda tangan penilai tersedia,
  - tanda tangan guru tersedia jika user guru tersedia.
- Buka menu aksi, pilih `Force Final`.
- Coba submit tanpa alasan, pastikan validasi muncul.
- Isi alasan, submit.
- Pastikan status menjadi `Final`.
- Pastikan assignment terkunci dan aktivitas tercatat di Audit Log.
- Coba force final assignment yang belum lengkap, pastikan sistem menolak dengan pesan jelas.

## Final Locking

- Setelah assignment Final, coba edit skor, catatan, usulan aspek, Evaluasi & RTL, dan tanda tangan.
- Pastikan role penilai tidak bisa mengubah data Final.
- Pastikan Admin juga tidak bisa edit data Final kecuali memakai Emergency Unlock.
- Pastikan Guru tetap bisa melihat hasil final.

## Error Handling UX

- Pada tambah Assignment, submit tanpa memilih guru.
- Pastikan muncul ringkasan error, field terkait merah, dan dialog scroll ke field tersebut.
- Pada tambah Assignment, pilih guru tetapi jangan pilih jenis penilaian.
- Pastikan validasi jenis penilaian tampil jelas.
- Pada Emergency Unlock dan Force Final, submit tanpa alasan.
- Pastikan error terlihat jelas dan tidak hanya muncul sebagai toast.

## Regression

- Pastikan assignment Kepala Sekolah dan Pengawas tetap terpisah.
- Pastikan penilai hanya bisa mengisi assignment yang ditugaskan kepadanya.
- Pastikan Guru tidak bisa mengisi skor.
- Pastikan Review Guru maksimal dua kali tetap berjalan.
- Pastikan Evaluasi & RTL tetap wajib sebelum finalisasi normal.
- Pastikan Report dan Export PDF tetap dapat dibuka untuk assignment Final.
