import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Inbox, Pencil, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";

const EMPTY_FORM = {
  assignment_id: "",
  category_id: "",
  aspect_name: "",
  aspect_description: "",
  reason: "",
};

const STATUS_CLASS = {
  Pending: "bg-amber-100 text-amber-800 hover:bg-amber-100 border-0",
  Approved: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0",
  Rejected: "bg-red-100 text-red-700 hover:bg-red-100 border-0",
  Cancelled: "bg-slate-200 text-slate-700 hover:bg-slate-200 border-0",
};

export default function ProposedAspects() {
  const { user } = useAuth();
  const isGuru = user?.role === "guru";

  return isGuru ? <TeacherProposalView /> : <ReviewerProposalView />;
}

function TeacherProposalView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/proposed-aspects/me");
      setData(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memuat usulan aspek");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const editableAssignments = useMemo(
    () => (data?.assignments || []).filter((a) => !["Final", "Selesai"].includes(a.status)),
    [data]
  );

  const openAdd = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      assignment_id: editableAssignments[0]?.id || "",
      category_id: data?.categories?.[0]?.id || "",
    });
    setOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      assignment_id: item.assignment_id || "",
      category_id: item.category_id || "",
      aspect_name: item.aspect_name || "",
      aspect_description: item.aspect_description || "",
      reason: item.reason || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form };
      if (!payload.assignment_id) delete payload.assignment_id;
      if (editing) {
        await api.put(`/proposed-aspects/${editing.id}`, payload);
        toast.success("Usulan aspek diperbarui");
      } else {
        await api.post("/proposed-aspects", payload);
        toast.success("Usulan aspek dikirim");
      }
      setOpen(false);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan usulan");
    }
  };

  const cancelProposal = async (item) => {
    try {
      await api.post(`/proposed-aspects/${item.id}/cancel`);
      toast.success("Usulan aspek dibatalkan");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal membatalkan usulan");
    }
  };

  const canSubmit = !!data?.active_period && editableAssignments.length > 0;

  return (
    <div className="space-y-6" data-testid="teacher-proposed-aspects-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Usulan Guru</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Usulan Aspek Observasi</h1>
          <p className="text-slate-600 mt-1">Ajukan aspek tambahan yang ingin diamati pada periode aktif.</p>
        </div>
        <Button onClick={openAdd} disabled={!canSubmit} className="bg-emerald-700 hover:bg-emerald-800" data-testid="add-proposed-aspect">
          <Plus className="w-4 h-4 mr-2" /> Tambah Usulan
        </Button>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Info label="Guru" value={data?.teacher?.name} />
          <Info label="Periode Aktif" value={data?.active_period?.period_name || "Belum ada periode aktif"} />
          <Info label="Assignment Aktif" value={editableAssignments.length ? `${editableAssignments.length} assignment` : "Belum tersedia"} />
        </div>
        {!canSubmit && !loading && (
          <div className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Guru hanya bisa mengirim usulan jika ada periode aktif dan assignment pada periode tersebut belum Final.
          </div>
        )}
      </Card>

      <ProposalTable
        loading={loading}
        items={data?.proposals || []}
        mode="teacher"
        onEdit={openEdit}
        onCancel={cancelProposal}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Ubah Usulan Aspek" : "Tambah Usulan Aspek"}</DialogTitle>
            <DialogDescription>Usulan akan masuk status Pending dan menunggu review.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="proposed-aspect-form">
            {editableAssignments.length > 1 && (
              <div className="space-y-2">
                <Label>Assignment Terkait</Label>
                <Select value={form.assignment_id} onValueChange={(v) => setForm({ ...form, assignment_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih assignment" /></SelectTrigger>
                  <SelectContent>
                    {editableAssignments.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.assessor_role} - {a.status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Kategori Observasi</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger data-testid="proposal-category"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>
                  {(data?.categories || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.category_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nama Aspek</Label>
              <Input required value={form.aspect_name} onChange={(e) => setForm({ ...form, aspect_name: e.target.value })} data-testid="proposal-name" />
            </div>
            <div className="space-y-2">
              <Label>Deskripsi Aspek</Label>
              <Textarea rows={3} value={form.aspect_description} onChange={(e) => setForm({ ...form, aspect_description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Alasan Usulan</Label>
              <Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Alasan opsional, tetapi sebaiknya diisi" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Batal</Button>
              <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800">{editing ? "Simpan Perubahan" : "Kirim Usulan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewerProposalView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewStatus, setReviewStatus] = useState("Approved");
  const [reviewNotes, setReviewNotes] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/proposed-aspects/review");
      setItems(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memuat review usulan");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openReview = (item, status) => {
    setReviewTarget(item);
    setReviewStatus(status);
    setReviewNotes(item.review_notes || "");
  };

  const submitReview = async () => {
    if (!reviewTarget) return;
    try {
      await api.post(`/proposed-aspects/${reviewTarget.id}/review`, {
        status: reviewStatus,
        review_notes: reviewNotes,
      });
      toast.success(reviewStatus === "Approved" ? "Usulan disetujui" : "Usulan ditolak");
      setReviewTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan review");
    }
  };

  return (
    <div className="space-y-6" data-testid="review-proposed-aspects-page">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Review Usulan</div>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Review Usulan Aspek</h1>
        <p className="text-slate-600 mt-1">Setujui atau tolak usulan aspek observasi dari guru sesuai kewenangan Anda.</p>
      </div>

      <ProposalTable loading={loading} items={items} mode="reviewer" onReview={openReview} />

      <Dialog open={!!reviewTarget} onOpenChange={(o) => !o && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewStatus === "Approved" ? "Approve Usulan" : "Reject Usulan"}</DialogTitle>
            <DialogDescription>{reviewTarget?.aspect_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Catatan Review</Label>
            <Textarea rows={4} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Catatan review opsional" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>Batal</Button>
            <Button onClick={submitReview} className={reviewStatus === "Approved" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-600 hover:bg-red-700"}>
              {reviewStatus === "Approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProposalTable({ loading, items, mode, onEdit, onCancel, onReview }) {
  if (loading) return <Card className="p-8 text-center text-sm text-slate-500">Memuat data...</Card>;
  if (!items.length) {
    return (
      <Card className="p-10 text-center">
        <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <div className="font-medium text-slate-700">Belum ada usulan aspek</div>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            {mode === "reviewer" && <TableHead>Guru</TableHead>}
            {mode === "reviewer" && <TableHead>Sekolah</TableHead>}
            <TableHead>Periode</TableHead>
            <TableHead>Kategori</TableHead>
            <TableHead>Nama Aspek</TableHead>
            <TableHead>Alasan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Catatan Review</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const pending = item.status === "Pending";
            return (
              <TableRow key={item.id}>
                {mode === "reviewer" && <TableCell className="font-medium">{item.teacher_name || "-"}</TableCell>}
                {mode === "reviewer" && <TableCell>{item.school_name || "-"}</TableCell>}
                <TableCell>{item.period_name || "-"}</TableCell>
                <TableCell><Badge variant="outline">{item.category_name || "-"}</Badge></TableCell>
                <TableCell className="max-w-xs">
                  <div className="font-medium text-slate-900">{item.aspect_name}</div>
                  {item.aspect_description && <div className="text-xs text-slate-500 mt-1">{item.aspect_description}</div>}
                </TableCell>
                <TableCell className="max-w-xs text-slate-600">{item.reason || "-"}</TableCell>
                <TableCell><Badge className={STATUS_CLASS[item.status] || STATUS_CLASS.Pending}>{item.status}</Badge></TableCell>
                <TableCell className="max-w-xs text-slate-600">{item.review_notes || "-"}</TableCell>
                <TableCell className="text-right">
                  {mode === "teacher" && pending && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => onEdit(item)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => onCancel(item)} className="text-red-600 hover:text-red-700"><XCircle className="w-4 h-4" /></Button>
                    </>
                  )}
                  {mode === "reviewer" && pending && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onReview(item, "Approved")} className="text-emerald-700"><CheckCircle2 className="w-4 h-4 mr-1" /> Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => onReview(item, "Rejected")} className="text-red-600"><XCircle className="w-4 h-4 mr-1" /> Reject</Button>
                    </div>
                  )}
                  {!pending && <span className="text-xs text-slate-400">Tidak ada aksi</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-slate-900 font-medium mt-0.5">{value || "-"}</div>
    </div>
  );
}
