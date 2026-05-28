import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
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
import { Plus, Search, Pencil, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function ObservationAspects() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("semua");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({
    category_id: "", aspect_name: "", aspect_description: "",
    display_order: 1, status: "aktif",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([api.get("/observation-aspects"), api.get("/observation-categories")]);
      setItems(a.data); setCategories(c.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.category_name])), [categories]);

  const filtered = useMemo(() => items.filter((a) => {
    if (filterCat !== "semua" && a.category_id !== filterCat) return false;
    if (!search) return true;
    return a.aspect_name.toLowerCase().includes(search.toLowerCase());
  }), [items, search, filterCat]);

  const openAdd = () => {
    setEditing(null);
    setForm({ category_id: categories[0]?.id || "", aspect_name: "", aspect_description: "", display_order: items.length + 1, status: "aktif" });
    setOpen(true);
  };
  const openEdit = (a) => {
    setEditing(a);
    setForm({
      category_id: a.category_id, aspect_name: a.aspect_name, aspect_description: a.aspect_description || "",
      display_order: a.display_order, status: a.status,
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, display_order: Number(form.display_order) };
      if (editing) { await api.put(`/observation-aspects/${editing.id}`, payload); toast.success("Aspek diperbarui"); }
      else { await api.post("/observation-aspects", payload); toast.success("Aspek ditambahkan"); }
      setOpen(false); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan"); }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/observation-aspects/${delTarget.id}`);
      toast.success("Aspek dihapus");
      setDelTarget(null); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus"); }
  };

  return (
    <div className="space-y-6" data-testid="aspects-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Instrumen Penilaian</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Aspek Penilaian</h1>
          <p className="text-slate-600 mt-1">Daftar aspek observasi dalam tiap kategori untuk penilaian guru PJOK.</p>
        </div>
        <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" disabled={categories.length === 0} data-testid="add-aspect-button">
          <Plus className="w-4 h-4 mr-2" /> Tambah Aspek
        </Button>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Cari aspek..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="aspects-search" />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-[220px]" data-testid="aspects-filter-cat"><SelectValue placeholder="Filter kategori" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua Kategori</SelectItem>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.category_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          filtered.length === 0 ? (
            <div className="py-12 text-center"><Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" /><div className="text-slate-600 font-medium">Belum ada aspek</div></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="w-20">Urutan</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Aspek</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => (
                    <TableRow key={a.id} data-testid={`aspect-row-${a.id}`}>
                      <TableCell className="font-mono">{a.display_order}</TableCell>
                      <TableCell><Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">{catMap[a.category_id] || "?"}</Badge></TableCell>
                      <TableCell className="max-w-xl">{a.aspect_name}</TableCell>
                      <TableCell><Badge className={a.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>{a.status === "aktif" ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(a)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setDelTarget(a)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
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
            <DialogTitle>{editing ? "Ubah Aspek" : "Tambah Aspek"}</DialogTitle>
            <DialogDescription>Aspek harus terhubung ke salah satu kategori observasi.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="aspect-form">
            <div className="space-y-2">
              <Label>Kategori</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger data-testid="aspect-cat-select"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.category_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Nama Aspek</Label><Textarea required rows={2} value={form.aspect_name} onChange={(e) => setForm({ ...form, aspect_name: e.target.value })} data-testid="aspect-name-input" /></div>
            <div className="space-y-2"><Label>Deskripsi (opsional)</Label><Textarea rows={2} value={form.aspect_description} onChange={(e) => setForm({ ...form, aspect_description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Urutan</Label><Input type="number" min={1} required value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="aktif">Aktif</SelectItem><SelectItem value="nonaktif">Nonaktif</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="aspect-submit-button">{editing ? "Simpan Perubahan" : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus aspek?</AlertDialogTitle><AlertDialogDescription>Aspek akan dihapus permanen.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
