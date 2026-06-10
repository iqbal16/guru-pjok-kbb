import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import EvidenceFileList, { formatBytes } from "@/components/EvidenceFileList";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, FileUp, Search, Upload, Video } from "lucide-react";
import { toast } from "sonner";

const DOCUMENT_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

function statusTone(status) {
  if (status === "ready") return "bg-emerald-100 text-emerald-800";
  if (status === "locked") return "bg-slate-100 text-slate-800";
  return "bg-amber-100 text-amber-800";
}

export default function EvidenceUploads() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("semua");

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(isAdmin ? "/evidence/admin" : "/evidence/me");
      setData(res.data);
      setError("");
    } catch (e) {
      setError(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memuat bukti pendukung");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => data?.summary || {}, [data]);
  const files = useMemo(() => (isAdmin ? (data?.files || []) : (summary.files || [])), [data, isAdmin, summary]);
  const filteredFiles = useMemo(() => {
    if (!isAdmin) return files;
    const q = search.trim().toLowerCase();
    return files.filter((file) => {
      const matchesType = typeFilter === "semua" || file.file_category === typeFilter;
      const haystack = [
        file.original_filename,
        file.teacher_name,
        file.teacher_nip,
        file.school_name,
        file.period_name,
        file.uploaded_by_name,
        file.status,
      ].filter(Boolean).join(" ").toLowerCase();
      return matchesType && (!q || haystack.includes(q));
    });
  }, [files, isAdmin, search, typeFilter]);

  const validateClientFile = (category, file) => {
    const lower = file.name.toLowerCase();
    if (category === "document") {
      if (!DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "Format dokumen tidak didukung. Gunakan PDF, Word, atau Excel.";
      const limit = Number(data?.max_document_size_mb || summary.max_document_size_mb || 10) * 1024 * 1024;
      if (file.size > limit) return "Ukuran dokumen melebihi batas maksimum yang diizinkan.";
    }
    if (category === "video") {
      if (!VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "Format video tidak didukung. Gunakan MP4, MOV, atau WEBM.";
      const limit = Number(data?.max_video_size_mb || summary.max_video_size_mb || 50) * 1024 * 1024;
      if (file.size > limit) return "Ukuran video maksimal 50 MB.";
    }
    return "";
  };

  const uploadFile = async (category, file) => {
    setError("");
    if (!file) return;
    const clientError = validateClientFile(category, file);
    if (clientError) {
      setError(clientError);
      toast.error(clientError);
      return;
    }
    const form = new FormData();
    form.append("file_category", category);
    form.append("upload", file);
    setUploading(category);
    setProgress(0);
    try {
      const res = await api.post("/evidence/me/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      setData(res.data);
      toast.success(category === "document" ? "Dokumen berhasil diunggah" : "Video berhasil diunggah");
    } catch (e) {
      const message = formatApiErrorDetail(e?.response?.data?.detail) || "Upload gagal";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(null);
      setProgress(0);
    }
  };

  const deleteFile = async (file) => {
    if (!window.confirm(`Hapus file ${file.original_filename}?`)) return;
    try {
      const res = await api.delete(`/evidence/me/${file.id}`);
      setData(res.data);
      toast.success("File berhasil dihapus");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus file");
    }
  };

  if (loading) return <div className="text-sm text-slate-500">Memuat bukti pendukung...</div>;

  if (isAdmin) {
    return (
      <div className="space-y-6" data-testid="evidence-admin-page">
        <Header title="Manajemen Bukti Pendukung" subtitle="Lihat dan filter dokumen/video pendukung penilaian Guru." />
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="Cari guru, sekolah, periode, nama file..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="semua">Semua Jenis</SelectItem>
                <SelectItem value="document">Dokumen</SelectItem>
                <SelectItem value="video">Video</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>
        <EvidenceFileList files={filteredFiles} emptyText="Belum ada bukti pendukung yang sesuai filter." />
      </div>
    );
  }

  const locked = !!summary.locked;
  const noPeriod = !data?.active_period;
  const canUpload = !locked && !noPeriod;

  return (
    <div className="space-y-6" data-testid="evidence-page">
      <Header title="Bukti Pendukung Penilaian" subtitle="Unggah dokumen dan video pendukung untuk semester aktif sebelum penilaian dimulai." />

      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="evidence-error">
          <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4" /> {error}</div>
        </Card>
      )}

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Info label="Nama Guru" value={data?.teacher?.name || "-"} />
          <Info label="NIP" value={data?.teacher?.nip || "-"} />
          <Info label="Sekolah" value={data?.school?.school_name || "-"} />
          <Info label="Semester Aktif" value={data?.active_period?.period_name || "Belum ada semester penilaian aktif"} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge className={`${statusTone(summary.readiness_status)} border-0`}>Status: {summary.readiness_label || "Belum Lengkap"}</Badge>
          <Badge variant="outline">Dokumen: {summary.document_count || 0}</Badge>
          <Badge variant="outline">Video: {summary.video_count || 0}</Badge>
          {locked && <Badge className="border-0 bg-slate-700 text-white">File terkunci setelah penilaian dimulai</Badge>}
        </div>
        {(summary.missing || []).length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="font-semibold">Kelengkapan belum terpenuhi:</div>
            <ul className="mt-1 list-disc pl-5">
              {summary.missing.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        )}
        {summary.readiness_status === "ready" && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mr-2 inline h-4 w-4" /> Bukti pendukung sudah lengkap dan siap dinilai.
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-heading text-xl font-semibold text-slate-900">Upload Bukti</h2>
        <p className="mt-1 text-sm text-slate-500">
          Dokumen maksimal {summary.max_document_size_mb || 10} MB. Video maksimal {summary.max_video_size_mb || 50} MB.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <UploadBox
            icon={FileUp}
            title="Upload Dokumen"
            description="PDF, Word, atau Excel"
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            disabled={!canUpload || uploading}
            onChange={(file) => uploadFile("document", file)}
          />
          <UploadBox
            icon={Video}
            title="Upload Video"
            description="MP4, MOV, atau WEBM"
            accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
            disabled={!canUpload || uploading}
            onChange={(file) => uploadFile("video", file)}
          />
        </div>
        {uploading && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Mengunggah {uploading === "document" ? "dokumen" : "video"}...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {!canUpload && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            {noPeriod ? "Belum ada semester penilaian aktif." : "Bukti pendukung sudah terkunci dan tidak bisa diubah."}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-semibold text-slate-900">File Saya</h2>
            <p className="text-sm text-slate-500">Total ukuran: {formatBytes(files.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0))}</p>
          </div>
        </div>
        <EvidenceFileList files={files} canDelete={canUpload} onDelete={deleteFile} />
      </Card>
    </div>
  );
}

function Header({ title, subtitle }) {
  return (
    <div>
      <div className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-emerald-600">Penilaian PJOK</div>
      <h1 className="font-heading text-3xl font-bold text-slate-900">{title}</h1>
      <p className="mt-1 text-slate-600">{subtitle}</p>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-slate-900">{value}</div>
    </div>
  );
}

function UploadBox({ icon: Icon, title, description, accept, disabled, onChange }) {
  return (
    <Label className={`block rounded-lg border border-dashed p-5 transition ${disabled ? "cursor-not-allowed bg-slate-50 text-slate-400" : "cursor-pointer border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50"}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-white p-2 text-emerald-700 shadow-sm"><Icon className="h-5 w-5" /></div>
        <div>
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="text-sm text-slate-500">{description}</div>
          <div className="mt-3 inline-flex items-center rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white">
            <Upload className="mr-1.5 h-4 w-4" /> Pilih File
          </div>
        </div>
      </div>
      <Input type="file" accept={accept} disabled={disabled} className="hidden" onChange={(e) => onChange(e.target.files?.[0])} />
    </Label>
  );
}
