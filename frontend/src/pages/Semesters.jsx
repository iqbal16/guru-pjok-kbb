import { useEffect, useState } from "react";
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
import { Plus, Pencil, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function Semesters() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({ semester_name: "", semester_order: 1, status: "aktif" });

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/semesters"); setItems(r.data); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm({ semester_name: "", semester_order: items.length + 1, status: "aktif" }); setOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ semester_name: s.semester_name, semester_order: s.semester_order, status: s.status }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, semester_order: Number(form.semester_order) };
      if (editing) { await api.put(`/semesters/${editing.id}`, payload); toast.success("Berhasil memperbarui semester"); }
      else { await api.post("/semesters", payload); toast.success("Berhasil menambahkan semester"); }
      setOpen(false); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan"); }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/semesters/${delTarget.id}`);
      toast.success("Berhasil menghapus semester");
      setDelTarget(null); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus"); }
  };

  return (
    <div className="space-y-6" data-testid="semesters-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Periode Penilaian</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Semester</h1>
          <p className="text-slate-600 mt-1">Kelola periode semester dalam tahun ajaran.</p>
        </div>
        <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-semester-button">
          <Plus className="w-4 h-4 mr-2" /> Tambah Semester
        </Button>
      </div>

      <Card className="p-6">
        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          items.length === 0 ? (
            <div className="py-12 text-center"><Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" /><div className="text-slate-600 font-medium">Belum ada data</div></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow><TableHead className="w-24">Urutan</TableHead><TableHead>Nama Semester</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((s) => (
                    <TableRow key={s.id} data-testid={`semester-row-${s.semester_name}`}>
                      <TableCell className="font-mono">{s.semester_order}</TableCell>
                      <TableCell className="font-medium">{s.semester_name}</TableCell>
                      <TableCell><Badge className={s.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>{s.status === "aktif" ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setDelTarget(s)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
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
            <DialogTitle>{editing ? "Ubah Semester" : "Tambah Semester"}</DialogTitle>
            <DialogDescription>Contoh: Ganjil (urutan 1), Genap (urutan 2).</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="semester-form">
            <div className="space-y-2"><Label>Nama Semester</Label><Input required value={form.semester_name} onChange={(e) => setForm({ ...form, semester_name: e.target.value })} data-testid="semester-name-input" /></div>
            <div className="space-y-2"><Label>Urutan</Label><Input type="number" min={1} required value={form.semester_order} onChange={(e) => setForm({ ...form, semester_order: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="aktif">Aktif</SelectItem><SelectItem value="nonaktif">Nonaktif</SelectItem></SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="semester-submit-button">{editing ? "Simpan Perubahan" : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus semester?</AlertDialogTitle><AlertDialogDescription>Semester <span className="font-semibold">{delTarget?.semester_name}</span> akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
