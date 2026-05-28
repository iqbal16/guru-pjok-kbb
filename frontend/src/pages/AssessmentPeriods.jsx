import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Inbox, CalendarCheck2, CheckCircle2, Power } from "lucide-react";
import { toast } from "sonner";

export default function AssessmentPeriods() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [items, setItems] = useState([]);
  const [years, setYears] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({
    academic_year_id: "", semester_id: "", period_name: "",
    start_date: "", end_date: "", status: "aktif", is_active: false,
  });

  const load = async () => {
    setLoading(true);
    try {
      const calls = [api.get("/assessment-periods")];
      if (isAdmin) {
        calls.push(api.get("/academic-years"));
        calls.push(api.get("/semesters"));
      }
      const res = await Promise.all(calls);
      setItems(res[0].data);
      if (isAdmin) { setYears(res[1].data); setSemesters(res[2].data); }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const activePeriod = useMemo(() => items.find((p) => p.is_active), [items]);

  const openAdd = () => {
    setEditing(null);
    setForm({ academic_year_id: "", semester_id: "", period_name: "", start_date: "", end_date: "", status: "aktif", is_active: false });
    setOpen(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      academic_year_id: p.academic_year_id, semester_id: p.semester_id, period_name: p.period_name,
      start_date: p.start_date || "", end_date: p.end_date || "",
      status: p.status, is_active: !!p.is_active,
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) { await api.put(`/assessment-periods/${editing.id}`, form); toast.success("Periode diperbarui"); }
      else { await api.post("/assessment-periods", form); toast.success("Periode ditambahkan"); }
      setOpen(false); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan"); }
  };

  const activate = async (p) => {
    try {
      await api.post(`/assessment-periods/${p.id}/activate`);
      toast.success(`${p.period_name} diaktifkan`);
      await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal mengaktifkan"); }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/assessment-periods/${delTarget.id}`);
      toast.success("Periode dihapus");
      setDelTarget(null); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus"); }
  };

  // Non-admin: read-only view of active period
  if (!isAdmin) {
    return (
      <div className="space-y-6 max-w-3xl" data-testid="periods-page-readonly">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Periode Penilaian</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Periode Aktif</h1>
          <p className="text-slate-600 mt-1">Informasi periode penilaian PJOK yang sedang berlangsung.</p>
        </div>
        {loading ? <div className="text-sm text-slate-500">Memuat...</div> :
          !activePeriod ? (
            <Card className="p-8 text-center border-dashed">
              <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="text-slate-700 font-medium">Belum ada periode aktif</div>
              <div className="text-sm text-slate-500 mt-1">Admin belum mengaktifkan periode penilaian.</div>
            </Card>
          ) : (
            <Card className="p-6 relative overflow-hidden bg-emerald-900 text-white" data-testid="active-period-card">
              <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-orange-500/20 blur-3xl" />
              <div className="relative space-y-3">
                <Badge className="bg-orange-500 hover:bg-orange-500 text-white border-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Aktif</Badge>
                <div className="font-heading text-3xl font-bold">{activePeriod.period_name}</div>
                <div className="grid grid-cols-2 gap-6 pt-3 text-sm">
                  <div>
                    <div className="text-emerald-300/80 text-xs uppercase tracking-wider mb-1">Tahun Ajaran</div>
                    <div className="font-medium">{activePeriod.academic_year_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-emerald-300/80 text-xs uppercase tracking-wider mb-1">Semester</div>
                    <div className="font-medium">{activePeriod.semester_name || "-"}</div>
                  </div>
                  <div>
                    <div className="text-emerald-300/80 text-xs uppercase tracking-wider mb-1">Mulai</div>
                    <div className="font-medium">{activePeriod.start_date || "-"}</div>
                  </div>
                  <div>
                    <div className="text-emerald-300/80 text-xs uppercase tracking-wider mb-1">Berakhir</div>
                    <div className="font-medium">{activePeriod.end_date || "-"}</div>
                  </div>
                </div>
              </div>
            </Card>
          )
        }
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="periods-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Periode Penilaian</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Periode Penilaian</h1>
          <p className="text-slate-600 mt-1">Atur siklus penilaian per tahun ajaran & semester. Hanya satu periode dapat aktif.</p>
        </div>
        <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-period-button">
          <Plus className="w-4 h-4 mr-2" /> Tambah Periode
        </Button>
      </div>

      {activePeriod && (
        <Card className="p-4 bg-emerald-50 border-emerald-200 flex items-center gap-3" data-testid="active-period-banner">
          <CalendarCheck2 className="w-5 h-5 text-emerald-700" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">Periode Aktif Saat Ini</div>
            <div className="text-slate-900 font-semibold">{activePeriod.period_name}</div>
          </div>
        </Card>
      )}

      <Card className="p-6">
        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          items.length === 0 ? (
            <div className="py-12 text-center"><Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" /><div className="text-slate-600 font-medium">Belum ada periode</div></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Nama Periode</TableHead>
                    <TableHead>Tahun Ajaran</TableHead>
                    <TableHead>Semester</TableHead>
                    <TableHead>Rentang</TableHead>
                    <TableHead>Aktif</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p.id} data-testid={`period-row-${p.id}`}>
                      <TableCell className="font-medium">{p.period_name}</TableCell>
                      <TableCell>{p.academic_year_name || "-"}</TableCell>
                      <TableCell>{p.semester_name || "-"}</TableCell>
                      <TableCell className="text-slate-600 text-sm">{p.start_date || "-"} → {p.end_date || "-"}</TableCell>
                      <TableCell>
                        {p.is_active ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Aktif</Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => activate(p)} data-testid={`activate-${p.id}`}>
                            <Power className="w-3.5 h-3.5 mr-1.5" /> Aktifkan
                          </Button>
                        )}
                      </TableCell>
                      <TableCell><Badge className={p.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>{p.status === "aktif" ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setDelTarget(p)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Ubah Periode" : "Tambah Periode"}</DialogTitle>
            <DialogDescription>Kombinasi tahun ajaran + semester harus unik.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="period-form">
            <div className="space-y-2">
              <Label>Tahun Ajaran</Label>
              <Select value={form.academic_year_id} onValueChange={(v) => setForm({ ...form, academic_year_id: v })}>
                <SelectTrigger data-testid="period-year-select"><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
                <SelectContent>{years.map((y) => <SelectItem key={y.id} value={y.id}>{y.year_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Semester</Label>
              <Select value={form.semester_id} onValueChange={(v) => setForm({ ...form, semester_id: v })}>
                <SelectTrigger data-testid="period-semester-select"><SelectValue placeholder="Pilih semester" /></SelectTrigger>
                <SelectContent>{semesters.map((s) => <SelectItem key={s.id} value={s.id}>{s.semester_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Nama Periode</Label><Input required value={form.period_name} onChange={(e) => setForm({ ...form, period_name: e.target.value })} placeholder="Semester Genap 2025/2026" data-testid="period-name-input" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Mulai</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Berakhir</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4 items-end">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="aktif">Aktif</SelectItem><SelectItem value="nonaktif">Nonaktif</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="cursor-pointer">Set sebagai periode aktif</Label>
                  <div className="text-[11px] text-slate-500 mt-0.5">Periode lain otomatis nonaktif.</div>
                </div>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} data-testid="period-active-switch" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="period-submit-button">{editing ? "Simpan Perubahan" : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus periode?</AlertDialogTitle><AlertDialogDescription>Periode <span className="font-semibold">{delTarget?.period_name}</span> akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
