import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function Teachers() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [items, setItems] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSchool, setFilterSchool] = useState("semua");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({
    name: "", nip: "", school_id: "none", subject: "PJOK",
    grade_level: "SD", employment_status: "PNS", status: "aktif",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([api.get("/teachers"), api.get("/schools")]);
      setItems(t.data);
      setSchools(s.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const schoolMap = useMemo(() => Object.fromEntries(schools.map((s) => [s.id, s])), [schools]);
  const employmentLabel = (value) => (value === "PNS" ? "PNS" : "Non PNS");
  const filtered = useMemo(() => items.filter((t) => {
    if (filterSchool !== "semua" && t.school_id !== filterSchool) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.nip || "").includes(q);
  }), [items, search, filterSchool]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", nip: "", school_id: "none", subject: "PJOK", grade_level: "SD", employment_status: "PNS", status: "aktif" });
    setOpen(true);
  };
  const openEdit = (t) => {
    setEditing(t);
    setForm({
      name: t.name, nip: t.nip || "", school_id: t.school_id || "none",
      subject: t.subject || "PJOK", grade_level: t.grade_level || "SD",
      employment_status: employmentLabel(t.employment_status), status: t.status,
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, school_id: form.school_id === "none" ? null : form.school_id };
      if (editing) {
        await api.put(`/teachers/${editing.id}`, payload);
        toast.success("Berhasil memperbarui guru");
      } else {
        await api.post("/teachers", payload);
        toast.success("Berhasil menambahkan guru");
      }
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan");
    }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/teachers/${delTarget.id}`);
      toast.success("Berhasil menghapus guru");
      setDelTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus");
    }
  };

  return (
    <div className="space-y-6" data-testid="teachers-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Master Data</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Data Guru PJOK</h1>
          <p className="text-slate-600 mt-1">Daftar guru Penjas/PJOK di Kabupaten Bandung Barat.</p>
        </div>
        {isAdmin && (
          <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-teacher-button">
            <Plus className="w-4 h-4 mr-2" /> Tambah Guru
          </Button>
        )}
      </div>

      <Card className="p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Cari nama atau NIP..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="teachers-search" />
          </div>
          <Select value={filterSchool} onValueChange={setFilterSchool}>
            <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Filter Sekolah" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua Sekolah</SelectItem>
              {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.school_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="text-slate-600 font-medium">Data belum tersedia</div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>NIP</TableHead>
                    <TableHead>Sekolah</TableHead>
                    <TableHead>Mapel</TableHead>
                    <TableHead>Kepegawaian</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead className="text-right">Aksi</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.id} data-testid={`teacher-row-${t.id}`}>
                      <TableCell className="font-medium min-w-[180px]">{t.name}</TableCell>
                      <TableCell className="font-mono text-sm text-slate-600">{t.nip || "-"}</TableCell>
                      <TableCell className="text-slate-600 min-w-[220px]">{schoolMap[t.school_id]?.school_name || "-"}</TableCell>
                      <TableCell>
                        <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0">{t.subject}</Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">{employmentLabel(t.employment_status)}</TableCell>
                      <TableCell>
                        <Badge className={t.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>
                          {t.status === "aktif" ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(t)}><Pencil className="w-4 h-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setDelTarget(t)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Ubah Guru" : "Tambah Guru"}</DialogTitle>
            <DialogDescription>Lengkapi data guru PJOK.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="teacher-form">
            <div className="space-y-2">
              <Label>Nama Guru</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="teacher-name-input" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>NIP</Label>
                <Input value={form.nip} onChange={(e) => setForm({ ...form, nip: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Status Kepegawaian</Label>
                <Select value={form.employment_status} onValueChange={(v) => setForm({ ...form, employment_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PNS">PNS</SelectItem>
                    <SelectItem value="Non PNS">Non PNS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sekolah</Label>
              <Select value={form.school_id} onValueChange={(v) => setForm({ ...form, school_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih sekolah" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Belum ditempatkan</SelectItem>
                  {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.school_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Mata Pelajaran</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aktif">Aktif</SelectItem>
                    <SelectItem value="nonaktif">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="teacher-submit-button">
                {editing ? "Simpan Perubahan" : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus guru?</AlertDialogTitle>
            <AlertDialogDescription>
              Guru <span className="font-semibold">{delTarget?.name}</span> akan dihapus.
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
