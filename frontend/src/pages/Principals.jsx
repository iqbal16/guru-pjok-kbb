import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
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

export default function Principals() {
  const [items, setItems] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({ name: "", nip: "", school_id: "none", status: "aktif" });

  const load = async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([api.get("/principals"), api.get("/schools")]);
      setItems(p.data); setSchools(s.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const schoolMap = useMemo(() => Object.fromEntries(schools.map((s) => [s.id, s])), [schools]);
  const filtered = useMemo(() => items.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return i.name.toLowerCase().includes(q) || (i.nip || "").includes(q);
  }), [items, search]);

  const openAdd = () => { setEditing(null); setForm({ name: "", nip: "", school_id: "none", status: "aktif" }); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ name: p.name, nip: p.nip || "", school_id: p.school_id || "none", status: p.status }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, school_id: form.school_id === "none" ? null : form.school_id };
      if (editing) { await api.put(`/principals/${editing.id}`, payload); toast.success("Berhasil memperbarui kepala sekolah"); }
      else { await api.post("/principals", payload); toast.success("Berhasil menambahkan kepala sekolah"); }
      setOpen(false); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan"); }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/principals/${delTarget.id}`);
      toast.success("Berhasil menghapus kepala sekolah");
      setDelTarget(null); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus"); }
  };

  return (
    <div className="space-y-6" data-testid="principals-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Master Data</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Data Kepala Sekolah</h1>
          <p className="text-slate-600 mt-1">Kepala Sekolah SD di Kabupaten Bandung Barat.</p>
        </div>
        <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-principal-button">
          <Plus className="w-4 h-4 mr-2" /> Tambah Kepala Sekolah
        </Button>
      </div>

      <Card className="p-6">
        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Cari nama atau NIP..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="principals-search" />
        </div>
        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          filtered.length === 0 ? (
            <div className="py-12 text-center"><Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" /><div className="text-slate-600 font-medium">Data belum tersedia</div></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow><TableHead>Nama</TableHead><TableHead>NIP</TableHead><TableHead>Sekolah</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id} data-testid={`principal-row-${p.id}`}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="font-mono text-sm text-slate-600">{p.nip || "-"}</TableCell>
                      <TableCell className="text-slate-600">{schoolMap[p.school_id]?.school_name || "-"}</TableCell>
                      <TableCell>
                        <Badge className={p.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>
                          {p.status === "aktif" ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
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
            <DialogTitle>{editing ? "Ubah Kepala Sekolah" : "Tambah Kepala Sekolah"}</DialogTitle>
            <DialogDescription>Lengkapi data kepala sekolah.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="principal-form">
            <div className="space-y-2"><Label>Nama</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>NIP</Label><Input value={form.nip} onChange={(e) => setForm({ ...form, nip: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Sekolah</Label>
              <Select value={form.school_id} onValueChange={(v) => setForm({ ...form, school_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih sekolah" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Belum ditugaskan —</SelectItem>
                  {schools.map((s) => <SelectItem key={s.id} value={s.id}>{s.school_name}</SelectItem>)}
                </SelectContent>
              </Select>
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
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="principal-submit-button">{editing ? "Simpan Perubahan" : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus kepala sekolah?</AlertDialogTitle><AlertDialogDescription>Kepala sekolah <span className="font-semibold">{delTarget?.name}</span> akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
