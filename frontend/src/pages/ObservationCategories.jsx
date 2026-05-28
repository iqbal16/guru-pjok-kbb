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
import { Plus, Pencil, Trash2, Inbox, FolderTree, Layers, ListChecks } from "lucide-react";
import { toast } from "sonner";

const SCORE_REF = [
  { v: 1, label: "Kurang", tone: "bg-red-100 text-red-700" },
  { v: 2, label: "Cukup", tone: "bg-amber-100 text-amber-700" },
  { v: 3, label: "Baik", tone: "bg-emerald-100 text-emerald-700" },
  { v: 4, label: "Sangat Baik", tone: "bg-emerald-700 text-white" },
];

export default function ObservationCategories() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [items, setItems] = useState([]);
  const [aspects, setAspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({ category_name: "", description: "", display_order: 1, status: "aktif" });

  const load = async () => {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([api.get("/observation-categories"), api.get("/observation-aspects")]);
      setItems(c.data); setAspects(a.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const aspectsByCat = useMemo(() => {
    const m = {};
    for (const a of aspects) { (m[a.category_id] = m[a.category_id] || []).push(a); }
    Object.values(m).forEach((arr) => arr.sort((x, y) => x.display_order - y.display_order));
    return m;
  }, [aspects]);

  const openAdd = () => { setEditing(null); setForm({ category_name: "", description: "", display_order: items.length + 1, status: "aktif" }); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ category_name: c.category_name, description: c.description || "", display_order: c.display_order, status: c.status }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, display_order: Number(form.display_order) };
      if (editing) { await api.put(`/observation-categories/${editing.id}`, payload); toast.success("Kategori diperbarui"); }
      else { await api.post("/observation-categories", payload); toast.success("Kategori ditambahkan"); }
      setOpen(false); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan"); }
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.delete(`/observation-categories/${delTarget.id}`);
      toast.success("Kategori dihapus");
      setDelTarget(null); await load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus"); }
  };

  return (
    <div className="space-y-6" data-testid="categories-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Instrumen Penilaian</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Komponen Observasi</h1>
          <p className="text-slate-600 mt-1">Kategori observasi PJOK beserta aspek-aspek penilaiannya.</p>
        </div>
        {isAdmin && (
          <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-category-button">
            <Plus className="w-4 h-4 mr-2" /> Tambah Kategori
          </Button>
        )}
      </div>

      {/* Score reference */}
      <Card className="p-5 bg-orange-50/50 border-orange-200">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks className="w-4 h-4 text-orange-700" />
          <div className="text-xs uppercase tracking-wider font-semibold text-orange-700">Referensi Skala Penilaian</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SCORE_REF.map((s) => (
            <div key={s.v} className="rounded-lg bg-white border border-orange-100 p-3 flex items-center gap-3">
              <Badge className={`${s.tone} border-0 w-7 h-7 rounded-full flex items-center justify-center text-base font-bold hover:${s.tone}`}>{s.v}</Badge>
              <div className="text-sm font-semibold text-slate-900">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-slate-600 mt-3">Skor ini akan digunakan saat input penilaian pada tahap berikutnya.</div>
      </Card>

      {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
        items.length === 0 ? (
          <Card className="p-12 text-center"><Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" /><div className="text-slate-600 font-medium">Belum ada kategori observasi</div></Card>
        ) : (
          <div className="space-y-4">
            {items.map((c) => (
              <Card key={c.id} className="p-6" data-testid={`category-card-${c.category_name}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                      {c.display_order}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-heading text-xl font-semibold text-slate-900">{c.category_name}</h3>
                        <Badge className={c.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>{c.status === "aktif" ? "Aktif" : "Nonaktif"}</Badge>
                        <Badge variant="outline" className="text-xs">{(aspectsByCat[c.id] || []).length} aspek</Badge>
                      </div>
                      {c.description && <p className="text-sm text-slate-600 mt-1">{c.description}</p>}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setDelTarget(c)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  )}
                </div>
                {(aspectsByCat[c.id] || []).length > 0 && (
                  <ol className="mt-4 space-y-1.5 pl-13" style={{ paddingLeft: "3.25rem" }}>
                    {(aspectsByCat[c.id] || []).map((a, idx) => (
                      <li key={a.id} className="text-sm text-slate-700 flex items-start gap-2" data-testid={`aspect-item-${a.id}`}>
                        <span className="text-emerald-700 font-mono text-xs mt-0.5 shrink-0">{idx + 1}.</span>
                        <span>{a.aspect_name}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            ))}
          </div>
        )
      }

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Ubah Kategori" : "Tambah Kategori"}</DialogTitle>
            <DialogDescription>Misal: Persiapan, Pelaksanaan, Penilaian.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="category-form">
            <div className="space-y-2"><Label>Nama Kategori</Label><Input required value={form.category_name} onChange={(e) => setForm({ ...form, category_name: e.target.value })} data-testid="category-name-input" /></div>
            <div className="space-y-2"><Label>Deskripsi</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
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
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="category-submit-button">{editing ? "Simpan Perubahan" : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus kategori?</AlertDialogTitle><AlertDialogDescription>Kategori <span className="font-semibold">{delTarget?.category_name}</span> akan dihapus. Pastikan tidak ada aspek di dalamnya.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Ya, Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
