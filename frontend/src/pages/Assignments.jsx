import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Inbox, Play, ClipboardList, Eye } from "lucide-react";
import { toast } from "sonner";

const STATUS_TONE = {
  "Belum Dimulai": "bg-slate-100 text-slate-700",
  "Draft": "bg-amber-100 text-amber-800",
  "Final": "bg-emerald-100 text-emerald-700",
};

function StatusBadge({ status }) {
  return <Badge className={`${STATUS_TONE[status] || "bg-slate-100 text-slate-700"} hover:${STATUS_TONE[status] || "bg-slate-100"} border-0`}>{status}</Badge>;
}

export default function Assignments() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const isPengawas = user.role === "pengawas";
  const isKepsek = user.role === "kepala_sekolah";
  const canCreate = isAdmin || isKepsek;

  const [items, setItems] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assessors, setAssessors] = useState([]); // users with pengawas/kepsek role
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("semua");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ teacher_id: "", assessor_user_id: "", observation_date: "", notes: "" });

  const load = async () => {
    setLoading(true);
    try {
      const calls = [api.get("/assignments"), api.get("/assessment-periods/active")];
      if (canCreate) {
        calls.push(api.get("/teachers"));
        if (isAdmin) calls.push(api.get("/users"));
      }
      const res = await Promise.all(calls);
      setItems(res[0].data);
      setActive(res[1].data?.active || null);
      if (canCreate) {
        setTeachers(res[2].data);
        if (isAdmin) {
          setAssessors(res[3].data.filter((u) => ["pengawas", "kepala_sekolah"].includes(u.role) && u.status === "aktif"));
        }
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // For kepsek: assessors = themselves
  const effectiveAssessors = useMemo(() => {
    if (isAdmin) return assessors;
    if (isKepsek) return [{ id: user.id, name: user.name, role: "kepala_sekolah" }];
    return [];
  }, [isAdmin, isKepsek, assessors, user]);

  const filtered = useMemo(() => items.filter((a) => {
    if (filterStatus !== "semua" && a.status !== filterStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (a.teacher_name || "").toLowerCase().includes(q) ||
           (a.assessor_name || "").toLowerCase().includes(q) ||
           (a.teacher_nip || "").includes(q) ||
           (a.school_name || "").toLowerCase().includes(q);
  }), [items, search, filterStatus]);

  const openAdd = () => {
    if (!active) {
      toast.error("Belum ada periode penilaian aktif.");
      return;
    }
    setEditing(null);
    setForm({
      teacher_id: "",
      assessor_user_id: isKepsek ? user.id : "",
      observation_date: "",
      notes: "",
    });
    setOpen(true);
  };

  const openEdit = (a) => {
    setEditing(a);
    setForm({
      teacher_id: a.teacher_id,
      assessor_user_id: a.assessor_user_id,
      observation_date: a.observation_date || "",
      notes: a.notes || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/assignments/${editing.id}`, form);
        toast.success("Assignment diperbarui");
      } else {
        await api.post("/assignments", form);
        toast.success("Assignment dibuat");
      }
      setOpen(false); await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan");
    }
  };

  const startAssignment = async (a) => {
    try {
      await api.post(`/assignments/${a.id}/start`);
      toast.success("Penilaian dimulai (status Draft)");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memulai");
    }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/assignments/${delTarget.id}`);
      toast.success("Assignment dihapus");
      setDelTarget(null); await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus");
    }
  };

  // For form: teachers list (kepsek sees only their school's teachers via backend filter)
  const teacherOptions = teachers;

  return (
    <div className="space-y-6" data-testid="assignments-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Penilaian PJOK</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">
            {isAdmin ? "Assignment Penilaian" : "Penilaian Saya"}
          </h1>
          <p className="text-slate-600 mt-1">
            {isAdmin && "Kelola penugasan penilaian guru PJOK pada periode aktif."}
            {isPengawas && "Daftar tugas penilaian yang diberikan kepada Anda."}
            {isKepsek && "Penugasan penilaian guru di sekolah Anda."}
          </p>
        </div>
        {canCreate && (
          <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" disabled={!active} data-testid="add-assignment-button">
            <Plus className="w-4 h-4 mr-2" /> Tambah Assignment
          </Button>
        )}
      </div>

      {!active && (
        <Card className="p-5 bg-amber-50 border-amber-200 flex items-center gap-3" data-testid="no-period-warning">
          <ClipboardList className="w-5 h-5 text-amber-700" />
          <div className="text-sm text-amber-900 font-medium">Belum ada periode penilaian aktif. Hubungi Admin untuk mengaktifkan periode.</div>
        </Card>
      )}

      {active && (
        <Card className="p-4 bg-emerald-50 border-emerald-200 flex items-center gap-3">
          <ClipboardList className="w-5 h-5 text-emerald-700" />
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold">Periode Aktif</div>
            <div className="text-slate-900 font-semibold">{active.period_name}</div>
          </div>
          <Badge className="bg-emerald-700 text-white hover:bg-emerald-700 border-0">Aktif</Badge>
        </Card>
      )}

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Cari guru, NIP, sekolah, penilai..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="assignments-search" />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[200px]" data-testid="assignments-filter-status"><SelectValue placeholder="Filter Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua Status</SelectItem>
              <SelectItem value="Belum Dimulai">Belum Dimulai</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          filtered.length === 0 ? (
            <div className="py-12 text-center" data-testid="assignments-empty">
              <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="text-slate-600 font-medium">Belum ada assignment</div>
              {canCreate && active && <div className="text-sm text-slate-500 mt-1">Tambahkan penugasan baru untuk memulai.</div>}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Guru</TableHead>
                    <TableHead>NIP</TableHead>
                    <TableHead>Sekolah</TableHead>
                    <TableHead>Penilai</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Tgl Observasi</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => {
                    const canStart = (isPengawas || isKepsek || isAdmin) && a.assessor_user_id === user.id && a.status === "Belum Dimulai";
                    const canEdit = isAdmin || (isKepsek && a.school_id);
                    return (
                      <TableRow key={a.id} data-testid={`assignment-row-${a.id}`}>
                        <TableCell className="font-medium">{a.teacher_name || "-"}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">{a.teacher_nip || "-"}</TableCell>
                        <TableCell className="text-slate-600">{a.school_name || "-"}</TableCell>
                        <TableCell>{a.assessor_name || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{a.assessor_role}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">{a.observation_date || "-"}</TableCell>
                        <TableCell><StatusBadge status={a.status} /></TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setDetail(a)} data-testid={`detail-${a.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canStart && (
                            <Button size="sm" variant="outline" onClick={() => startAssignment(a)} className="ml-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50" data-testid={`start-${a.id}`}>
                              <Play className="w-3.5 h-3.5 mr-1" /> Mulai Penilaian
                            </Button>
                          )}
                          {canEdit && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => openEdit(a)} data-testid={`edit-${a.id}`}><Pencil className="w-4 h-4" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => setDelTarget(a)} className="text-red-600 hover:text-red-700" data-testid={`delete-${a.id}`}><Trash2 className="w-4 h-4" /></Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
      </Card>

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Ubah Assignment" : "Tambah Assignment"}</DialogTitle>
            <DialogDescription>
              Periode: <span className="font-medium text-slate-900">{active?.period_name || "—"}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="assignment-form">
            <div className="space-y-2">
              <Label>Guru yang Dinilai</Label>
              <Select value={form.teacher_id} onValueChange={(v) => setForm({ ...form, teacher_id: v })}>
                <SelectTrigger data-testid="assignment-teacher-select"><SelectValue placeholder="Pilih guru" /></SelectTrigger>
                <SelectContent>
                  {teacherOptions.filter((t) => t.status === "aktif").map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} {t.nip ? `(${t.nip})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Penilai</Label>
              <Select value={form.assessor_user_id} onValueChange={(v) => setForm({ ...form, assessor_user_id: v })} disabled={isKepsek}>
                <SelectTrigger data-testid="assignment-assessor-select"><SelectValue placeholder="Pilih penilai" /></SelectTrigger>
                <SelectContent>
                  {effectiveAssessors.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.role === "pengawas" ? "Pengawas" : "Kepala Sekolah"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isKepsek && <div className="text-[11px] text-slate-500">Sebagai Kepala Sekolah, Anda otomatis menjadi penilai.</div>}
            </div>
            <div className="space-y-2">
              <Label>Tanggal Observasi (opsional)</Label>
              <Input type="date" value={form.observation_date} onChange={(e) => setForm({ ...form, observation_date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opsional" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="assignment-submit-button">
                {editing ? "Simpan Perubahan" : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detail Assignment</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm" data-testid="assignment-detail">
              <Row label="Guru" value={detail.teacher_name} />
              <Row label="NIP" value={detail.teacher_nip || "-"} />
              <Row label="Sekolah" value={detail.school_name || "-"} />
              <Row label="Penilai" value={`${detail.assessor_name} (${detail.assessor_role})`} />
              <Row label="Periode" value={detail.period_name} />
              <Row label="Jenis" value={detail.assignment_type} />
              <Row label="Tanggal Observasi" value={detail.observation_date || "Belum diatur"} />
              <Row label="Status" value={<StatusBadge status={detail.status} />} />
              <Row label="Catatan" value={detail.notes || "-"} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              Assignment <span className="font-semibold">{delTarget?.teacher_name}</span> akan dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0">
      <div className="text-slate-500 min-w-[140px]">{label}</div>
      <div className="text-slate-900 font-medium text-right flex-1">{value}</div>
    </div>
  );
}
