import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function Schools() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [form, setForm] = useState({
    npsn: "", school_name: "", district: "Kabupaten Bandung Barat",
    subdistrict: "", address: "", status: "aktif",
  });

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/schools");
      setItems(r.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.school_name.toLowerCase().includes(q) || s.npsn.includes(q) || (s.subdistrict || "").toLowerCase().includes(q);
  }), [items, search]);

  const openAdd = () => {
    setEditing(null);
    setForm({ npsn: "", school_name: "", district: "Kabupaten Bandung Barat", subdistrict: "", address: "", status: "aktif" });
    setOpen(true);
  };
  const openEdit = (s) => {
    setEditing(s);
    setForm({ npsn: s.npsn, school_name: s.school_name, district: s.district, subdistrict: s.subdistrict, address: s.address || "", status: s.status });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/schools/${editing.id}`, form);
        toast.success("Berhasil memperbarui sekolah");
      } else {
        await api.post("/schools", form);
        toast.success("Berhasil menambahkan sekolah");
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
      await api.delete(`/schools/${delTarget.id}`);
      toast.success("Berhasil menghapus sekolah");
      setDelTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus");
    }
  };

  return (
    <div className="space-y-6" data-testid="schools-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Master Data</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Data Sekolah</h1>
          <p className="text-slate-600 mt-1">Daftar Sekolah Dasar di wilayah Kabupaten Bandung Barat.</p>
        </div>
        {isAdmin && (
          <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-school-button">
            <Plus className="w-4 h-4 mr-2" /> Tambah Sekolah
          </Button>
        )}
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Cari nama sekolah, NPSN, atau kecamatan..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="schools-search" />
          </div>
        </div>
        {loading ? <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div> :
          filtered.length === 0 ? (
            <div className="py-12 text-center" data-testid="schools-empty">
              <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="text-slate-600 font-medium">Data belum tersedia</div>
              {isAdmin && <Button onClick={openAdd} className="mt-4 bg-emerald-700 hover:bg-emerald-800">Tambah Sekolah</Button>}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>NPSN</TableHead>
                    <TableHead>Nama Sekolah</TableHead>
                    <TableHead>Kecamatan</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead className="text-right">Aksi</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id} data-testid={`school-row-${s.npsn}`}>
                      <TableCell className="font-mono text-sm">{s.npsn}</TableCell>
                      <TableCell className="font-medium">{s.school_name}</TableCell>
                      <TableCell className="text-slate-600">{s.subdistrict}</TableCell>
                      <TableCell>
                        <Badge className={s.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>
                          {s.status === "aktif" ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => setDelTarget(s)} className="text-red-600 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Ubah Sekolah" : "Tambah Sekolah"}</DialogTitle>
            <DialogDescription>Lengkapi data sekolah dasar.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="school-form">
            <div className="space-y-2">
              <Label>NPSN</Label>
              <Input required value={form.npsn} onChange={(e) => setForm({ ...form, npsn: e.target.value })} data-testid="school-npsn-input" />
            </div>
            <div className="space-y-2">
              <Label>Nama Sekolah</Label>
              <Input required value={form.school_name} onChange={(e) => setForm({ ...form, school_name: e.target.value })} data-testid="school-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kabupaten</Label>
                <Input value={form.district} disabled />
              </div>
              <div className="space-y-2">
                <Label>Kecamatan</Label>
                <Input required value={form.subdistrict} onChange={(e) => setForm({ ...form, subdistrict: e.target.value })} placeholder="Contoh: Lembang" data-testid="school-subdistrict-input" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Alamat</Label>
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} />
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="school-submit-button">
                {editing ? "Simpan Perubahan" : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus sekolah?</AlertDialogTitle>
            <AlertDialogDescription>
              Sekolah <span className="font-semibold">{delTarget?.school_name}</span> akan dihapus.
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
