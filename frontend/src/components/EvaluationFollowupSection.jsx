import { useCallback, useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Save } from "lucide-react";
import { toast } from "sonner";

const EMPTY = {
  kesimpulan_hasil_observasi: "",
  aspek_kelebihan: "",
  aspek_perlu_perbaikan: "",
  penyebab_kendala: "",
  rekomendasi_umum: "",
  kegiatan_pembinaan: "",
  sasaran_target: "",
  waktu_pelaksanaan: "",
  keterangan: "",
  status_rtl: "Belum Dimulai",
};

const RTL_TONE = {
  "Belum Dimulai": "bg-slate-100 text-slate-700",
  "Dalam Proses": "bg-amber-100 text-amber-800",
  Selesai: "bg-emerald-100 text-emerald-700",
};

const REQUIRED_FIELDS = [
  ["kesimpulan_hasil_observasi", "Kesimpulan Hasil Observasi"],
  ["aspek_kelebihan", "Aspek Kelebihan"],
  ["aspek_perlu_perbaikan", "Aspek Perlu Perbaikan"],
  ["rekomendasi_umum", "Rekomendasi Umum"],
  ["kegiatan_pembinaan", "Kegiatan Pembinaan"],
  ["sasaran_target", "Sasaran / Target"],
  ["waktu_pelaksanaan", "Waktu Pelaksanaan"],
  ["status_rtl", "Status RTL"],
];

export default function EvaluationFollowupSection({
  data,
  setData,
  canEdit,
  canFinalize,
  hasUnsavedScores = false,
  onSaveAndContinue,
  finalizeDisabledReason = "",
  onDirtyChange,
  validationRequest = 0,
}) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});

  const validateRequired = useCallback((scroll = false) => {
    const nextErrors = {};
    for (const [field, label] of REQUIRED_FIELDS) {
      if (!String(form[field] || "").trim()) nextErrors[field] = `${label} wajib diisi.`;
    }
    setErrors(nextErrors);
    if (scroll && Object.keys(nextErrors).length > 0) {
      const first = Object.keys(nextErrors)[0];
      setTimeout(() => document.getElementById(`rtl-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    }
    return Object.keys(nextErrors).length === 0;
  }, [form]);

  useEffect(() => {
    setForm({ ...EMPTY, ...(data?.evaluation_followup || {}) });
    setDirty(false);
    setErrors({});
    onDirtyChange?.(false);
  }, [data?.evaluation_followup, onDirtyChange]);

  useEffect(() => {
    if (validationRequest) validateRequired(true);
  }, [validationRequest, validateRequired]);

  if (!data) return null;

  const assignment = data.assignment || {};
  const readonly = !canEdit;
  const isComplete = !!data.evaluation_complete;
  const statusRtl = form.status_rtl || "Belum Dimulai";
  const saveBlockedByUnsavedScores = hasUnsavedScores && !readonly;

  const save = async () => {
    if (saveBlockedByUnsavedScores) {
      toast.error("Simpan penilaian terlebih dahulu sebelum lanjut ke Evaluasi & RTL.");
      return;
    }
    setSaving(true);
    try {
      const { data: next } = await api.put(`/assignments/${assignment.id}/evaluation-followup`, form);
      setData(next);
      setDirty(false);
      setErrors({});
      onDirtyChange?.(false);
      toast.success("Evaluasi & RTL tersimpan");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan Evaluasi & RTL");
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (finalizeDisabledReason) {
      toast.error(finalizeDisabledReason);
      return;
    }
    try {
      const { data: next } = await api.post(`/assignments/${assignment.id}/finalize`);
      setData(next);
      toast.success("Penilaian berhasil difinalisasi");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal finalisasi penilaian");
    }
  };

  const set = (patch) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    onDirtyChange?.(true);
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  };

  return (
    <Card className="p-5" data-testid="evaluation-followup-section">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h2 className="font-heading text-xl font-semibold text-slate-900">Evaluasi & RTL</h2>
          <p className="text-sm text-slate-500 mt-1">Kesimpulan observasi dan rencana tindak lanjut untuk assignment ini.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`${RTL_TONE[statusRtl] || RTL_TONE["Belum Dimulai"]} border-0`}>Status RTL: {statusRtl}</Badge>
          {assignment.status === "Final" && <Badge className="bg-emerald-700 text-white border-0">Terkunci</Badge>}
          {hasUnsavedScores && !readonly && <Badge className="bg-blue-100 text-blue-700 border-0">Skor belum disimpan</Badge>}
          {dirty && !readonly && <Badge className="bg-blue-100 text-blue-700 border-0">RTL belum disimpan</Badge>}
          {!readonly && !isComplete && <Badge className="bg-amber-100 text-amber-800 border-0">Lengkapi RTL sebelum Final</Badge>}
        </div>
      </div>

      {saveBlockedByUnsavedScores && (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <div className="flex-1">
              <div className="font-semibold">Simpan penilaian terlebih dahulu sebelum lanjut ke Evaluasi & RTL.</div>
              <div className="mt-1">Skor yang baru dipilih belum tersimpan, sehingga RTL belum bisa divalidasi dengan benar.</div>
            </div>
            {onSaveAndContinue && (
              <Button type="button" size="sm" onClick={onSaveAndContinue} className="bg-emerald-700 hover:bg-emerald-800">
                Simpan & Lanjut
              </Button>
            )}
          </div>
        </div>
      )}

      {!readonly && !hasUnsavedScores && finalizeDisabledReason && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <div className="font-semibold">Finalisasi belum tersedia.</div>
              <div className="mt-1">{finalizeDisabledReason}</div>
            </div>
          </div>
        </div>
      )}

      {Object.keys(errors).length > 0 && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="mb-2 flex items-start gap-2 font-semibold">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <span>Lengkapi Evaluasi & RTL sebelum penilaian dikirim ke Guru.</span>
          </div>
          <div className="space-y-1">
            {Object.entries(errors).map(([field, message]) => (
              <button
                key={field}
                type="button"
                onClick={() => document.getElementById(`rtl-${field}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="block w-full rounded-md px-2 py-1 text-left hover:bg-red-100"
              >
                {message}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm mb-5">
        <Info label="Guru" value={data.teacher?.name || assignment.teacher_name} />
        <Info label="Sekolah" value={data.school?.school_name || assignment.school_name} />
        <Info label="Periode" value={assignment.period_name} />
        <Info label="Penilai" value={data.assessor?.name || assignment.assessor_name} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="rtl-form">
        <Field id="rtl-kesimpulan_hasil_observasi" label="Kesimpulan Hasil Observasi" required error={errors.kesimpulan_hasil_observasi} value={form.kesimpulan_hasil_observasi} disabled={readonly} onChange={(v) => set({ kesimpulan_hasil_observasi: v })} />
        <Field id="rtl-aspek_kelebihan" label="Aspek Kelebihan" required error={errors.aspek_kelebihan} value={form.aspek_kelebihan} disabled={readonly} onChange={(v) => set({ aspek_kelebihan: v })} />
        <Field id="rtl-aspek_perlu_perbaikan" label="Aspek Perlu Perbaikan" required error={errors.aspek_perlu_perbaikan} value={form.aspek_perlu_perbaikan} disabled={readonly} onChange={(v) => set({ aspek_perlu_perbaikan: v })} />
        <Field label="Penyebab / Kendala" value={form.penyebab_kendala} disabled={readonly} onChange={(v) => set({ penyebab_kendala: v })} />
        <Field id="rtl-rekomendasi_umum" label="Rekomendasi Umum" required error={errors.rekomendasi_umum} value={form.rekomendasi_umum} disabled={readonly} onChange={(v) => set({ rekomendasi_umum: v })} />
        <Field id="rtl-kegiatan_pembinaan" label="Kegiatan Pembinaan" required error={errors.kegiatan_pembinaan} value={form.kegiatan_pembinaan} disabled={readonly} onChange={(v) => set({ kegiatan_pembinaan: v })} />
        <Field id="rtl-sasaran_target" label="Sasaran / Target" required error={errors.sasaran_target} value={form.sasaran_target} disabled={readonly} onChange={(v) => set({ sasaran_target: v })} />
        <div id="rtl-waktu_pelaksanaan" className="space-y-2">
          <Label className={errors.waktu_pelaksanaan ? "text-red-700" : ""}>Waktu Pelaksanaan <span className="text-red-500">*</span></Label>
          <Input type="date" value={form.waktu_pelaksanaan || ""} disabled={readonly} onChange={(e) => set({ waktu_pelaksanaan: e.target.value })} className={errors.waktu_pelaksanaan ? "border-red-400 focus-visible:ring-red-500" : ""} />
          {errors.waktu_pelaksanaan && <div className="text-xs text-red-600">{errors.waktu_pelaksanaan}</div>}
        </div>
        <Field label="Keterangan" value={form.keterangan} disabled={readonly} onChange={(v) => set({ keterangan: v })} />
        <div id="rtl-status_rtl" className="space-y-2">
          <Label className={errors.status_rtl ? "text-red-700" : ""}>Status RTL <span className="text-red-500">*</span></Label>
          <Select value={statusRtl} disabled={readonly} onValueChange={(v) => set({ status_rtl: v })}>
            <SelectTrigger className={errors.status_rtl ? "border-red-400 focus:ring-red-500" : ""}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Belum Dimulai">Belum Dimulai</SelectItem>
              <SelectItem value="Dalam Proses">Dalam Proses</SelectItem>
              <SelectItem value="Selesai">Selesai</SelectItem>
            </SelectContent>
          </Select>
          {errors.status_rtl && <div className="text-xs text-red-600">{errors.status_rtl}</div>}
        </div>
      </div>

      {!readonly && (
        <div className="flex items-center justify-end gap-2 mt-5 flex-wrap">
          <Button onClick={save} disabled={saving} className="bg-emerald-700 hover:bg-emerald-800" data-testid="save-rtl-button">
            <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan..." : "Simpan Evaluasi & RTL"}
          </Button>
          {(canFinalize !== false || finalizeDisabledReason) && (
            <Button onClick={finalize} disabled={!canFinalize || !isComplete || !!finalizeDisabledReason} variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60" data-testid="finalization-button">
              <CheckCircle2 className="w-4 h-4 mr-2" /> Finalisasi Penilaian
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function Field({ id, label, value, disabled, onChange, required = false, error = "" }) {
  return (
    <div id={id} className="space-y-2">
      <Label className={error ? "text-red-700" : ""}>{label} {required && <span className="text-red-500">*</span>}</Label>
      <Textarea rows={3} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={error ? "border-red-400 focus-visible:ring-red-500" : ""} data-testid="rtl-field" />
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
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
