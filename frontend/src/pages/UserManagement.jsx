import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Inbox } from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS } from "@/context/AuthContext";

const ROLE_OPTIONS = ["admin", "pengawas", "kepala_sekolah", "guru"];
const STATUS_OPTIONS = ["aktif", "nonaktif"];

export default function UserManagement() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [principals, setPrincipals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("semua");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: "", email: "", password: "", role: "guru",
    linked_profile_id: "none", status: "aktif",
  });
  const [delTarget, setDelTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [u, t, s, p] = await Promise.all([
        api.get("/users"),
        api.get("/teachers"),
        api.get("/supervisors"),
        api.get("/principals"),
      ]);
      setUsers(u.data);
      setTeachers(t.data);
      setSupervisors(s.data);
      setPrincipals(p.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const profileOptions = useMemo(() => {
    if (form.role === "guru") return teachers.map((x) => ({ id: x.id, label: `${x.name} (${x.nip || "tanpa NIP"})` }));
    if (form.role === "pengawas") return supervisors.map((x) => ({ id: x.id, label: `${x.name}` }));
    if (form.role === "kepala_sekolah") return principals.map((x) => ({ id: x.id, label: `${x.name}` }));
    return [];
  }, [form.role, teachers, supervisors, principals]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (filterRole !== "semua" && u.role !== filterRole) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, search, filterRole]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", email: "", password: "", role: "guru", linked_profile_id: "none", status: "aktif" });
    setOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      name: u.name, email: u.email, password: "",
      role: u.role, linked_profile_id: u.linked_profile_id || "none",
      status: u.status,
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form };
      payload.linked_profile_id = payload.linked_profile_id === "none" ? null : payload.linked_profile_id;
      if (editing) {
        if (!payload.password) delete payload.password;
        await api.put(`/users/${editing.id}`, payload);
        toast.success("Berhasil memperbarui pengguna");
      } else {
        await api.post("/users", payload);
        toast.success("Berhasil menambahkan pengguna");
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
      await api.delete(`/users/${delTarget.id}`);
      toast.success("Berhasil menghapus pengguna");
      setDelTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menghapus");
    }
  };

  return (
    <div className="space-y-6" data-testid="users-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Master Data</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Manajemen Pengguna</h1>
          <p className="text-slate-600 mt-1">Kelola akun pengguna sistem dan hubungkan ke profil terkait.</p>
        </div>
        <Button onClick={openAdd} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-user-button">
          <Plus className="w-4 h-4 mr-2" /> Tambah Pengguna
        </Button>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Cari nama atau email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="users-search"
            />
          </div>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-[200px]" data-testid="users-filter-role">
              <SelectValue placeholder="Filter Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua Role</SelectItem>
              {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 py-10 text-center">Memuat data...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center" data-testid="users-empty">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <div className="text-slate-600 font-medium">Data belum tersedia</div>
            <div className="text-sm text-slate-500 mt-1">Tambahkan pengguna baru untuk memulai.</div>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-slate-600">{u.email}</TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">
                        {ROLE_LABELS[u.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={u.status === "aktif" ? "bg-green-100 text-green-700 hover:bg-green-100 border-0" : "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0"}>
                        {u.status === "aktif" ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(u)} data-testid={`edit-user-${u.email}`}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {u.id !== me.id && (
                        <Button size="sm" variant="ghost" onClick={() => setDelTarget(u)} className="text-red-600 hover:text-red-700" data-testid={`delete-user-${u.email}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
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
            <DialogTitle>{editing ? "Ubah Pengguna" : "Tambah Pengguna"}</DialogTitle>
            <DialogDescription>
              {editing ? "Perbarui informasi pengguna." : "Isi data berikut untuk menambahkan pengguna baru."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="user-form">
            <div className="space-y-2">
              <Label>Nama Lengkap</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name-input" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email-input" />
            </div>
            <div className="space-y-2">
              <Label>{editing ? "Kata Sandi Baru (opsional)" : "Kata Sandi"}</Label>
              <Input type="password" required={!editing} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? "Kosongkan jika tidak diubah" : ""} data-testid="user-password-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v, linked_profile_id: "none" })}>
                  <SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="user-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s === "aktif" ? "Aktif" : "Nonaktif"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.role !== "admin" && (
              <div className="space-y-2">
                <Label>Hubungkan ke Profil ({ROLE_LABELS[form.role]})</Label>
                <Select value={form.linked_profile_id} onValueChange={(v) => setForm({ ...form, linked_profile_id: v })}>
                  <SelectTrigger data-testid="user-profile-select"><SelectValue placeholder="Pilih profil" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tidak dihubungkan —</SelectItem>
                    {profileOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800" data-testid="user-submit-button">
                {editing ? "Simpan Perubahan" : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pengguna?</AlertDialogTitle>
            <AlertDialogDescription>
              Pengguna <span className="font-semibold">{delTarget?.name}</span> akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700" data-testid="confirm-delete-button">
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
