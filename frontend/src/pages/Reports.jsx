import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Eye, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const STATUS_TONE = {
  Draft: "bg-amber-100 text-amber-800",
  "Menunggu Review Guru": "bg-blue-100 text-blue-700",
  "Feedback dari Guru": "bg-orange-100 text-orange-700",
  "Draft Revisi": "bg-purple-100 text-purple-700",
  Final: "bg-emerald-100 text-emerald-700",
};

const RTL_TONE = {
  "Belum Dimulai": "bg-slate-100 text-slate-700",
  "Dalam Proses": "bg-amber-100 text-amber-800",
  Selesai: "bg-emerald-100 text-emerald-700",
};

const SCORE_LABELS = { 1: "Kurang", 2: "Cukup", 3: "Baik", 4: "Sangat Baik" };
const EMPTY_FILTER = { period: "semua", school: "semua", teacher: "semua", assessor: "semua", role: "semua", status: "semua", rtl: "semua" };
const EXPORT_INCOMPLETE_MESSAGE = "Export PDF hanya tersedia setelah penilaian selesai dan seluruh data wajib sudah lengkap.";

export default function Reports() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports");
      setRows(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memuat report");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const options = useMemo(() => {
    const unique = (key, label) => {
      const map = new Map();
      rows.forEach((r) => { if (r[key]) map.set(r[key], r[label] || r[key]); });
      return [...map.entries()].map(([value, text]) => ({ value, text })).sort((a, b) => a.text.localeCompare(b.text));
    };
    return {
      periods: unique("assessment_period_id", "period_name"),
      schools: unique("school_id", "school_name"),
      teachers: unique("teacher_id", "teacher_name"),
      assessors: unique("assessor_user_id", "assessor_name"),
    };
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filter.period !== "semua" && r.assessment_period_id !== filter.period) return false;
    if (filter.school !== "semua" && r.school_id !== filter.school) return false;
    if (filter.teacher !== "semua" && r.teacher_id !== filter.teacher) return false;
    if (filter.assessor !== "semua" && r.assessor_user_id !== filter.assessor) return false;
    if (filter.role !== "semua" && r.assessor_role !== filter.role) return false;
    if (filter.status !== "semua" && r.status !== filter.status) return false;
    if (filter.rtl !== "semua" && r.status_rtl !== filter.rtl) return false;
    return true;
  }), [rows, filter]);

  const openDetail = async (row) => {
    try {
      const { data } = await api.get(`/reports/${row.assignment_id}`);
      setDetail(data);
      setDetailOpen(true);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal membuka detail report");
    }
  };

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Report</div>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Report Penilaian Kinerja Guru PJOK SD KBB</h1>
        <p className="text-slate-600 mt-1">Laporan online, export PDF, dan perbandingan semester penilaian PJOK Kabupaten Bandung Barat.</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-3">
          <Filter label="Periode" value={filter.period} onChange={(v) => setFilter({ ...filter, period: v })} options={options.periods} />
          {user.role !== "guru" && <Filter label="Guru" value={filter.teacher} onChange={(v) => setFilter({ ...filter, teacher: v })} options={options.teachers} />}
          {user.role === "admin" && <Filter label="Sekolah" value={filter.school} onChange={(v) => setFilter({ ...filter, school: v })} options={options.schools} />}
          {user.role === "admin" && <Filter label="Penilai" value={filter.assessor} onChange={(v) => setFilter({ ...filter, assessor: v })} options={options.assessors} />}
          <StaticFilter label="Role Penilai" value={filter.role} onChange={(v) => setFilter({ ...filter, role: v })} items={["Kepala Sekolah", "Pengawas"]} />
          <StaticFilter label="Status Penilaian" value={filter.status} onChange={(v) => setFilter({ ...filter, status: v })} items={["Draft", "Menunggu Review Guru", "Feedback dari Guru", "Draft Revisi", "Final"]} />
          <StaticFilter label="Status RTL" value={filter.rtl} onChange={(v) => setFilter({ ...filter, rtl: v })} items={["Belum Dimulai", "Dalam Proses", "Selesai"]} />
        </div>
      </Card>

      <Card className="p-0 overflow-hidden" data-testid="report-table">
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Memuat data...</div> : (
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Guru</TableHead>
                <TableHead>Sekolah</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Penilai</TableHead>
                <TableHead>Nilai</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>RTL</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.assignment_id}>
                  <TableCell className="font-medium">{r.teacher_name}<div className="text-xs text-slate-500 font-mono">{r.teacher_nip}</div></TableCell>
                  <TableCell>{r.school_name || "-"}</TableCell>
                  <TableCell>{r.period_name || "-"}<div className="text-xs text-slate-500">{r.academic_year_name} - {r.semester_name}</div></TableCell>
                  <TableCell>{r.assessor_name || "-"}<div className="text-xs text-slate-500">{r.assessor_role}</div></TableCell>
                  <TableCell className="font-semibold">{Number(r.final_percentage || 0).toFixed(2)}%</TableCell>
                  <TableCell><Badge className={`${STATUS_TONE[r.status] || "bg-slate-100 text-slate-700"} border-0`}>{r.status}</Badge></TableCell>
                  <TableCell>{r.status_rtl ? <Badge className={`${RTL_TONE[r.status_rtl] || RTL_TONE["Belum Dimulai"]} border-0`}>{r.status_rtl}</Badge> : "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openDetail(r)} data-testid="report-detail-button">
                      <Eye className="w-4 h-4 mr-1" /> Detail
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Report Penilaian Kinerja Guru PJOK SD KBB</DialogTitle>
          </DialogHeader>
          {detail && <ReportDetail data={detail} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportDetail({ data }) {
  const assignment = data.assignment || {};
  const teacher = data.teacher || {};
  const school = data.school || {};
  const assessor = data.assessor || {};
  const summary = data.summary || {};
  const scoreMap = Object.fromEntries((data.scores || []).map((s) => [s.aspect_id, s]));
  const groups = (data.categories || []).map((c) => ({ ...c, aspects: (data.aspects || []).filter((a) => a.category_id === c.id) }));
  const proposedGroups = (data.categories || []).map((c) => ({ ...c, aspects: (data.proposed_aspects || []).filter((a) => a.category_id === c.id) })).filter((g) => g.aspects.length);
  const evaluation = data.evaluation_followup || {};
  const exportReady = Boolean(data.export_ready);

  const exportPdf = async () => {
    if (!exportReady) {
      toast.error(EXPORT_INCOMPLETE_MESSAGE);
      return;
    }
    try {
      await api.post(`/reports/${assignment.id}/export-log`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || EXPORT_INCOMPLETE_MESSAGE);
      return;
    }
    const html = document.getElementById("report-print-area")?.innerHTML || "";
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Popup browser diblokir. Izinkan popup untuk export PDF.");
      return;
    }
    win.document.write(`<!doctype html><html><head><title>Penilaian Kinerja Guru PJOK SD KBB</title><style>
      @page{margin:18mm} body{font-family:Arial,sans-serif;color:#0f172a;padding:0;font-size:12px;line-height:1.55} h1{font-size:20px;text-align:center;margin:0 0 4px} h2{font-size:16px;margin:0 0 12px;border-bottom:2px solid #0f766e;padding-bottom:7px} h3{font-size:14px;margin:0 0 10px} table{width:100%;border-collapse:collapse;margin:14px 0;page-break-inside:auto} th,td{border:1px solid #94a3b8;padding:8px;font-size:11px;vertical-align:top} th{background:#e2e8f0;text-align:left;font-weight:700}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.card{border:1px solid #cbd5e1;padding:16px;margin:14px 0;border-radius:6px;page-break-inside:avoid}.badge{display:inline-block;border:1px solid #94a3b8;padding:3px 8px;border-radius:999px;font-size:11px}.watermark{position:fixed;top:42%;left:10%;right:10%;text-align:center;font-size:44px;color:#ef4444;opacity:.12;transform:rotate(-18deg);font-weight:bold}.no-print{display:none}.report-header{text-align:center;border-bottom:3px solid #0f766e;padding-bottom:14px;margin-bottom:18px}.signature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.signature-box{border:0;min-height:170px;text-align:center;padding:12px}.signature-box img{height:76px;max-width:100%;object-fit:contain}.signature-line{height:76px;border-bottom:1px solid #0f172a;margin:8px 10px 12px}.page-break{page-break-before:always}
    </style></head><body>${assignment.status !== "Final" ? "<div class='watermark'>DRAFT / BELUM FINAL</div>" : ""}${html}<div style="margin-top:24px;font-size:11px;color:#64748b">Tanggal cetak: ${new Date().toLocaleString("id-ID")}</div><script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-stretch sm:items-end gap-2 no-print">
        {!exportReady && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{EXPORT_INCOMPLETE_MESSAGE}</div>}
        <Button onClick={exportPdf} disabled={!exportReady} className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50" data-testid="export-pdf-button">
          <Download className="w-4 h-4 mr-2" /> Export PDF
        </Button>
      </div>
      <div id="report-print-area" className="space-y-5">
        <div className="report-header">
          <h1>Aplikasi Penilaian Kinerja Guru PJOK SD Kabupaten Bandung Barat</h1>
          <div>Laporan Penilaian Kinerja Guru PJOK SD KBB</div>
          <div>{data.academic_year?.year_name || "-"} | {data.semester?.semester_name || "-"}</div>
          <div className="mt-2"><Badge className={`${assignment.status === "Final" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"} border-0`}>{assignment.status === "Final" ? "Final" : "Draft / Belum Final"}</Badge></div>
        </div>

        <Card className="p-5 card">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-emerald-700" />
            <h2 className="font-heading text-2xl font-bold">Report Penilaian Kinerja Guru PJOK SD KBB</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <Info label="Nama Guru" value={teacher.name || assignment.teacher_name} />
            <Info label="NIP" value={teacher.nip || assignment.teacher_nip} />
            <Info label="Sekolah" value={school.school_name || assignment.school_name} />
            <Info label="Mata Pelajaran" value={teacher.subject || "PJOK"} />
            <Info label="Tahun Ajaran" value={data.academic_year?.year_name} />
            <Info label="Semester" value={data.semester?.semester_name} />
            <Info label="Periode" value={assignment.period_name} />
            <Info label="Tanggal Observasi" value={assignment.observation_date || "-"} />
            <Info label="Penilai" value={assessor.name || assignment.assessor_name} />
            <Info label="Role Penilai" value={assignment.assessor_role} />
            <Info label="Status Penilaian" value={assignment.status} />
            <Info label="Status RTL" value={evaluation.status_rtl || "-"} />
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Summary label="Total Skor" value={summary.total_score} />
          <Summary label="Skor Maksimal" value={summary.max_score} />
          <Summary label="Nilai Akhir" value={`${Number(summary.final_percentage || 0).toFixed(2)}%`} />
          <Summary label="Rata-rata" value={Number(summary.average_score || 0).toFixed(2)} />
          <Summary label="Aspek Dinilai" value={`${summary.scored_count}/${summary.aspect_count}`} />
        </div>

        <CategoryAverage summary={summary} />
        {groups.map((group) => <ScoreTable key={group.id} title={group.category_name} aspects={group.aspects} scoreMap={scoreMap} />)}
        {proposedGroups.length > 0 && (
          <Card className="p-5 card">
            <h3 className="font-heading text-xl font-semibold">Aspek Tambahan / Usulan Guru</h3>
            {proposedGroups.map((group) => <ScoreTable key={group.id} title={group.category_name} aspects={group.aspects} scoreMap={scoreMap} proposed />)}
          </Card>
        )}
        <EvaluationBlock evaluation={evaluation} />
        <FeedbackBlock feedbacks={data.feedbacks || []} status={assignment.status} />
        <CombinedSummary data={data.combined_summary} />
        <SemesterComparison data={data.semester_comparison} />
        <SignatureBlock signatures={data.signatures || []} />
      </div>
    </div>
  );
}

function ScoreTable({ title, aspects, scoreMap, proposed = false }) {
  return (
    <Card className={proposed ? "p-0 shadow-none border-0 card" : "p-5 card"}>
      <h3 className="font-heading text-xl font-semibold mb-3">{title}</h3>
      <Table>
        <TableHeader><TableRow><TableHead>Aspek</TableHead>{proposed && <TableHead>Alasan</TableHead>}<TableHead>Skor</TableHead><TableHead>Keterangan</TableHead><TableHead>Catatan</TableHead></TableRow></TableHeader>
        <TableBody>
          {aspects.map((a) => {
            const score = scoreMap[a.id];
            return <TableRow key={a.id}><TableCell>{a.aspect_name}<div className="text-xs text-slate-500">{a.aspect_description}</div></TableCell>{proposed && <TableCell>{a.reason || "-"}</TableCell>}<TableCell>{score?.score || "-"}</TableCell><TableCell>{SCORE_LABELS[score?.score] || "-"}</TableCell><TableCell>{score?.notes || "-"}</TableCell></TableRow>;
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function CategoryAverage({ summary }) {
  const categories = Object.values(summary.categories || {});
  return (
    <Card className="p-5 card">
      <h3 className="font-heading text-xl font-semibold mb-3">Rata-rata per Kategori</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{categories.map((c) => <Summary key={c.category_name} label={c.category_name} value={Number(c.average_score || 0).toFixed(2)} />)}</div>
    </Card>
  );
}

function EvaluationBlock({ evaluation }) {
  return (
    <Card className="p-5 card">
      <h3 className="font-heading text-xl font-semibold mb-3">Evaluasi & RTL</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        {["kesimpulan_hasil_observasi", "aspek_kelebihan", "aspek_perlu_perbaikan", "penyebab_kendala", "rekomendasi_umum", "kegiatan_pembinaan", "sasaran_target", "waktu_pelaksanaan", "keterangan", "status_rtl"].map((k) => <Info key={k} label={labelize(k)} value={evaluation?.[k] || "-"} />)}
      </div>
    </Card>
  );
}

function FeedbackBlock({ feedbacks, status }) {
  return (
    <Card className="p-5 card">
      <h3 className="font-heading text-xl font-semibold mb-3">Riwayat Feedback Guru</h3>
      {feedbacks.length ? feedbacks.map((f) => <div key={f.id} className="rounded border border-slate-200 p-3 mb-2"><Badge variant="outline">Feedback round {f.feedback_round}</Badge><div className="text-xs text-slate-500 mt-1">{f.created_at ? new Date(f.created_at).toLocaleString("id-ID") : ""}</div><div className="text-sm mt-2 whitespace-pre-wrap">{f.feedback_text}</div></div>) : <div className="text-sm text-slate-500">Belum ada feedback.</div>}
      <div className="text-sm mt-3">Status akhir: <span className="font-semibold">{status}</span></div>
    </Card>
  );
}

function CombinedSummary({ data }) {
  return (
    <Card className="p-5 card">
      <h3 className="font-heading text-xl font-semibold mb-3">Ringkasan Gabungan Guru per Semester</h3>
      <Table><TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Penilai</TableHead><TableHead>Status</TableHead><TableHead>Nilai</TableHead></TableRow></TableHeader><TableBody>{(data?.items || []).map((i) => <TableRow key={i.assignment_id}><TableCell>{i.assessor_role}</TableCell><TableCell>{i.assessor_name}</TableCell><TableCell>{i.status}</TableCell><TableCell>{Number(i.final_percentage || 0).toFixed(2)}%</TableCell></TableRow>)}</TableBody></Table>
      <div className="text-sm mt-2">Rata-rata gabungan: <span className="font-semibold">{Number(data?.combined_average || 0).toFixed(2)}%</span></div>
    </Card>
  );
}

function SemesterComparison({ data }) {
  const icon = data?.label === "Meningkat" ? <TrendingUp className="w-4 h-4" /> : data?.label === "Menurun" ? <TrendingDown className="w-4 h-4" /> : null;
  return (
    <Card className="p-5 card">
      <h3 className="font-heading text-xl font-semibold mb-3">Perbandingan Semester</h3>
      <div className="flex items-center gap-2 mb-3"><Badge variant="outline" className="gap-1">{icon}{data?.label || "Belum ada data pembanding"}</Badge></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Summary label="Semester Sebelumnya" value={data?.previous_value == null ? "-" : `${Number(data.previous_value).toFixed(2)}%`} />
        <Summary label="Semester Sekarang" value={`${Number(data?.current_value || 0).toFixed(2)}%`} />
        <Summary label="Selisih" value={data?.difference == null ? "-" : `${Number(data.difference).toFixed(2)}%`} />
      </div>
      {data?.categories?.length > 0 && <Table><TableHeader><TableRow><TableHead>Kategori</TableHead><TableHead>Sebelumnya</TableHead><TableHead>Sekarang</TableHead><TableHead>Selisih</TableHead><TableHead>Label</TableHead></TableRow></TableHeader><TableBody>{data.categories.map((c) => <TableRow key={c.category_name}><TableCell>{c.category_name}</TableCell><TableCell>{c.previous ?? "-"}</TableCell><TableCell>{c.current ?? "-"}</TableCell><TableCell>{c.difference ?? "-"}</TableCell><TableCell>{c.label}</TableCell></TableRow>)}</TableBody></Table>}
    </Card>
  );
}

function SignatureBlock({ signatures }) {
  const byRole = (role) => signatures.find((s) => s.signer_role === role);
  const blocks = [
    { title: "Guru yang Dinilai", role: "guru" },
    { title: "Kepala Sekolah", role: "kepala_sekolah" },
    { title: "Pengawas", role: "pengawas" },
  ];
  return (
    <Card className="p-5 card page-break">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 signature-grid">
        {blocks.map((block) => {
          const sig = byRole(block.role);
          return (
            <div key={block.role} className="rounded-lg border border-slate-200 p-4 text-center signature-box">
              <div className="font-semibold text-slate-900">{block.title}</div>
              {sig?.signature_image ? (
                <img src={sig.signature_image} alt={block.title} className="h-24 object-contain mx-auto my-3" />
              ) : (
                <div className="h-24 border-b border-slate-800 mx-4 my-3 signature-line" />
              )}
              <div className="text-sm font-medium min-h-[20px]">{cleanText(sig?.signer_name)}</div>
              <div className="text-xs text-slate-500 min-h-[18px]">{sig?.signed_at ? new Date(sig.signed_at).toLocaleDateString("id-ID") : ""}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Filter({ label, value, onChange, options }) {
  return <div className="space-y-1"><div className="text-xs text-slate-500 font-medium">{label}</div><Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="semua">Semua</SelectItem>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.text}</SelectItem>)}</SelectContent></Select></div>;
}

function StaticFilter({ label, value, onChange, items }) {
  return <Filter label={label} value={value} onChange={onChange} options={items.map((i) => ({ value: i, text: i }))} />;
}

function Info({ label, value }) {
  return <div><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div><div className="text-slate-900 font-medium mt-0.5">{value || "-"}</div></div>;
}

function Summary({ label, value }) {
  return <Card className="p-4 card"><div className="text-xs text-slate-500 font-medium">{label}</div><div className="font-heading text-2xl font-bold text-slate-900 mt-1">{value}</div></Card>;
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function labelize(key) {
  return key.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
