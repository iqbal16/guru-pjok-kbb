import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import EvaluationFollowupSection from "@/components/EvaluationFollowupSection";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_TONE = {
  "Belum Dimulai": "bg-slate-100 text-slate-700",
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

const EMPTY_FILTER = {
  period: "semua",
  school: "semua",
  teacher: "semua",
  assessor: "semua",
  assignmentStatus: "semua",
  rtlStatus: "semua",
  hasEvaluation: "semua",
};

export default function EvaluationFollowupsAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [dialog, setDialog] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/evaluation-followups/admin");
      setRows(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memuat Manajemen Evaluasi & RTL");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const options = useMemo(() => {
    const unique = (items, key, label) => {
      const map = new Map();
      for (const row of items) {
        const a = row.assignment || {};
        if (a[key]) map.set(a[key], a[label] || a[key]);
      }
      return [...map.entries()].map(([value, text]) => ({ value, text })).sort((a, b) => a.text.localeCompare(b.text));
    };
    return {
      periods: unique(rows, "assessment_period_id", "period_name"),
      schools: unique(rows, "school_id", "school_name"),
      teachers: unique(rows, "teacher_id", "teacher_name"),
      assessors: unique(rows, "assessor_user_id", "assessor_name"),
    };
  }, [rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    const a = row.assignment || {};
    const e = row.evaluation_followup || {};
    if (filter.period !== "semua" && a.assessment_period_id !== filter.period) return false;
    if (filter.school !== "semua" && a.school_id !== filter.school) return false;
    if (filter.teacher !== "semua" && a.teacher_id !== filter.teacher) return false;
    if (filter.assessor !== "semua" && a.assessor_user_id !== filter.assessor) return false;
    if (filter.assignmentStatus !== "semua" && a.status !== filter.assignmentStatus) return false;
    if (filter.rtlStatus !== "semua" && e.status_rtl !== filter.rtlStatus) return false;
    if (filter.hasEvaluation === "yes" && !row.has_evaluation) return false;
    if (filter.hasEvaluation === "no" && (row.has_evaluation || row.evaluation_deleted)) return false;
    if (filter.hasEvaluation === "deleted" && !row.evaluation_deleted) return false;
    return true;
  }), [rows, filter]);

  const openDialog = (row, mode) => {
    setDialog({
      mode,
      data: {
        assignment: row.assignment,
        evaluation_followup: row.evaluation_deleted ? null : row.evaluation_followup,
        evaluation_complete: row.evaluation_complete,
      },
    });
  };

  const refreshDialogData = (next) => {
    setDialog((prev) => prev ? { ...prev, data: next } : null);
    load();
  };

  const deleteRtl = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/assignments/${deleteTarget.assignment.id}/evaluation-followup`);
      toast.success("Evaluasi & RTL dihapus secara soft delete");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus Evaluasi & RTL");
    }
  };

  const restoreRtl = async (row) => {
    try {
      await api.post(`/assignments/${row.assignment.id}/evaluation-followup/restore`);
      toast.success("Evaluasi & RTL direstore");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal restore Evaluasi & RTL");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-evaluation-followups-page">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Admin</div>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Manajemen Evaluasi & RTL</h1>
        <p className="text-slate-600 mt-1">Kelola Evaluasi dan Rencana Tindak Lanjut untuk seluruh assignment.</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-3">
          <FilterSelect label="Periode" value={filter.period} onChange={(v) => setFilter({ ...filter, period: v })} options={options.periods} />
          <FilterSelect label="Sekolah" value={filter.school} onChange={(v) => setFilter({ ...filter, school: v })} options={options.schools} />
          <FilterSelect label="Guru" value={filter.teacher} onChange={(v) => setFilter({ ...filter, teacher: v })} options={options.teachers} />
          <FilterSelect label="Penilai" value={filter.assessor} onChange={(v) => setFilter({ ...filter, assessor: v })} options={options.assessors} />
          <StaticSelect label="Status Penilaian" value={filter.assignmentStatus} onChange={(v) => setFilter({ ...filter, assignmentStatus: v })} items={["Belum Dimulai", "Draft", "Menunggu Review Guru", "Feedback dari Guru", "Draft Revisi", "Final"]} />
          <StaticSelect label="Status RTL" value={filter.rtlStatus} onChange={(v) => setFilter({ ...filter, rtlStatus: v })} items={["Belum Dimulai", "Dalam Proses", "Selesai"]} />
          <StaticSelect label="Data RTL" value={filter.hasEvaluation} onChange={(v) => setFilter({ ...filter, hasEvaluation: v })} items={[["yes", "Sudah Ada"], ["no", "Belum Ada"], ["deleted", "Terhapus"]]} />
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">Memuat data...</div>
        ) : (
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Guru</TableHead>
                <TableHead>Sekolah</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Penilai</TableHead>
                <TableHead>Status Penilaian</TableHead>
                <TableHead>Status RTL</TableHead>
                <TableHead>Ketersediaan</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const a = row.assignment || {};
                const e = row.evaluation_followup || {};
                const final = a.status === "Final";
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.teacher_name || "-"}</TableCell>
                    <TableCell>{a.school_name || "-"}</TableCell>
                    <TableCell>{a.period_name || "-"}</TableCell>
                    <TableCell>{a.assessor_name || "-"} <div className="text-xs text-slate-500">{a.assessor_role}</div></TableCell>
                    <TableCell><Badge className={`${STATUS_TONE[a.status] || "bg-slate-100 text-slate-700"} border-0`}>{a.status}</Badge></TableCell>
                    <TableCell>{row.has_evaluation ? <Badge className={`${RTL_TONE[e.status_rtl] || RTL_TONE["Belum Dimulai"]} border-0`}>{e.status_rtl}</Badge> : "-"}</TableCell>
                    <TableCell>
                      {row.evaluation_deleted ? <Badge className="bg-red-100 text-red-700 border-0">Terhapus</Badge> :
                        row.has_evaluation ? <Badge className="bg-emerald-100 text-emerald-700 border-0">Sudah Ada</Badge> :
                        <Badge className="bg-slate-100 text-slate-700 border-0">Belum Ada</Badge>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {row.has_evaluation && <Button size="sm" variant="ghost" onClick={() => openDialog(row, "view")}><Eye className="w-4 h-4" /></Button>}
                      {!final && !row.evaluation_deleted && (
                        <Button size="sm" variant="ghost" onClick={() => openDialog(row, row.has_evaluation ? "edit" : "add")}>
                          {row.has_evaluation ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </Button>
                      )}
                      {!final && row.has_evaluation && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(row)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
                      )}
                      {!final && row.evaluation_deleted && (
                        <Button size="sm" variant="ghost" onClick={() => restoreRtl(row)} className="text-emerald-700"><RotateCcw className="w-4 h-4" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "view" ? "Lihat Evaluasi & RTL" : dialog?.mode === "add" ? "Tambah Evaluasi & RTL" : "Edit Evaluasi & RTL"}</DialogTitle>
          </DialogHeader>
          {dialog && (
            <EvaluationFollowupSection
              data={dialog.data}
              setData={refreshDialogData}
              canEdit={dialog.mode !== "view" && dialog.data.assignment?.status !== "Final"}
              canFinalize={false}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Evaluasi & RTL?</AlertDialogTitle>
            <AlertDialogDescription>Data akan ditandai terhapus, bukan dihapus permanen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={deleteRtl} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-slate-500 font-medium">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="semua">Semua</SelectItem>
          {options.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.text}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function StaticSelect({ label, value, onChange, items }) {
  const normalized = items.map((item) => Array.isArray(item) ? { value: item[0], text: item[1] } : { value: item, text: item });
  return <FilterSelect label={label} value={value} onChange={onChange} options={normalized} />;
}
