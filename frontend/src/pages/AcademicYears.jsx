import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function AcademicYears() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({ year_name: "", start_date: "", end_date: "", status: "aktif" });

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/academic-years"); setItems(r.data); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter((i) => !search || i.year_name.includes(search)), [items, search]);

  const openAdd = () => { setEditing(null); setForm({ year_name: "", start_date: "", end_date: "", status: "aktif" }); setOpen(true); };
  const openEdit = (y) => { setEditing(y); setForm({ year_name: y.year_name, start_date: y.start_date || "", end_date: y.end_date || "", status: y.status }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) { await api.put(`/academic-years/${editing.id}`, form); toast.success("Berhasil memperbarui tahun ajaran"); }
      else { await api.post("/academic-years", form); toast.success("Berhasil menambahkan tahun ajaran"); }
      setOpen(false); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan"); }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/academic-years/${delTarget.id}`);
      toast.success("Berhasil menghapus tahun ajaran");
      setDelTarget(null); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus"); }
  };

  return (
    <div className="space-y-6" data-testid="academic-years-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Periode Penilaian</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Tahun Ajaran</h1>
          <p className="text-slate-600 mt-1">Kelola tahun ajaran sekolah untuk siklus penilaian PJOK.</p>
        </div>
        <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-ay-button">
          <Plus className="w-4 h-4 mr-2" /> Tambah Tahun Ajaran
        </Button>
      </div>

      <Card className="p-6">
        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Cari tahun ajaran..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="ay-search" />
        </div>
        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          filtered.length === 0 ? (
            <div className="py-12 text-center"><Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" /><div className="text-slate-600 font-medium">Belum ada data</div></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow><TableHead>Tahun Ajaran</TableHead><TableHead>Mulai</TableHead><TableHead>Berakhir</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((y) => (
                    <TableRow key={y.id} data-testid={`ay-row-${y.year_name.replace("/","-")}`}>
                      <TableCell className="font-medium font-mono">{y.year_name}</TableCell>
                      <TableCell className="text-slate-600">{y.start_date || "-"}</TableCell>
                      <TableCell className="text-slate-600">{y.end_date || "-"}</TableCell>
                      <TableCell><Badge className={y.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>{y.status === "aktif" ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(y)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setDelTarget(y)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
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
            <DialogTitle>{editing ? "Ubah Tahun Ajaran" : "Tambah Tahun Ajaran"}</DialogTitle>
            <DialogDescription>Contoh format: 2025/2026</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="ay-form">
            <div className="space-y-2"><Label>Nama Tahun Ajaran</Label><Input required placeholder="2025/2026" value={form.year_name} onChange={(e) => setForm({ ...form, year_name: e.target.value })} data-testid="ay-name-input" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Tanggal Mulai</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Tanggal Berakhir</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="aktif">Aktif</SelectItem><SelectItem value="nonaktif">Nonaktif</SelectItem></SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="ay-submit-button">{editing ? "Simpan Perubahan" : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus tahun ajaran?</AlertDialogTitle><AlertDialogDescription>Tahun ajaran <span className="font-semibold">{delTarget?.year_name}</span> akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
