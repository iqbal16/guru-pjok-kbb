import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import EvaluationFollowupSection from "@/components/EvaluationFollowupSection";
import DigitalSignatureSection from "@/components/DigitalSignatureSection";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, ArrowLeft, ClipboardCheck, RotateCcw, Save, Send } from "lucide-react";
import { toast } from "sonner";

const SCORE_LABELS = {
  1: "Kurang",
  2: "Cukup",
  3: "Baik",
  4: "Sangat Baik",
};

const STATUS_TONE = {
  "Belum Dimulai": "bg-slate-100 text-slate-700",
  Draft: "bg-amber-100 text-amber-800",
  "Menunggu Review Guru": "bg-blue-100 text-blue-700",
  "Feedback dari Guru": "bg-orange-100 text-orange-700",
  "Draft Revisi": "bg-purple-100 text-purple-700",
  Final: "bg-emerald-100 text-emerald-700",
};

export default function AssessmentForm() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scoreDirty, setScoreDirty] = useState(false);
  const [rtlDirty, setRtlDirty] = useState(false);
  const [rtlValidationRequest, setRtlValidationRequest] = useState(0);
  const [missingAspectIds, setMissingAspectIds] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/assignments/${assignmentId}/assessment-form`);
      setData(data);
      const next = {};
      for (const score of data.scores || []) {
        next[score.aspect_id] = { score: score.score ? String(score.score) : "", notes: score.notes || "" };
      }
      setValues(next);
      setScoreDirty(false);
      setRtlDirty(false);
      setMissingAspectIds([]);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal membuka form penilaian");
      navigate("/assignments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [assignmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const aspects = data?.aspects || [];
    return (data?.categories || []).map((category) => ({
      ...category,
      aspects: aspects.filter((a) => a.category_id === category.id),
    }));
  }, [data]);

  const groupedProposed = useMemo(() => {
    const aspects = data?.proposed_aspects || [];
    return (data?.categories || [])
      .map((category) => ({
        ...category,
        aspects: aspects.filter((a) => a.category_id === category.id),
      }))
      .filter((category) => category.aspects.length > 0);
  }, [data]);

  const proposedSummary = useMemo(() => {
    const aspects = data?.proposed_aspects || [];
    let total = 0;
    let count = 0;
    for (const aspect of aspects) {
      const raw = values[aspect.id]?.score;
      const score = raw ? Number(raw) : 0;
      if (score >= 1 && score <= 4) {
        total += score;
        count += 1;
      }
    }
    return { total, count, aspectCount: aspects.length, average: count ? total / count : 0 };
  }, [data, values]);

  const summary = useMemo(() => {
    const aspects = data?.aspects || [];
    const byCategory = {};
    let total = 0;
    let count = 0;
    for (const category of data?.categories || []) {
      byCategory[category.id] = { total: 0, count: 0, aspectCount: aspects.filter((a) => a.category_id === category.id).length };
    }
    for (const aspect of aspects) {
      const raw = values[aspect.id]?.score;
      const score = raw ? Number(raw) : 0;
      if (score >= 1 && score <= 4) {
        total += score;
        count += 1;
        if (byCategory[aspect.category_id]) {
          byCategory[aspect.category_id].total += score;
          byCategory[aspect.category_id].count += 1;
        }
      }
    }
    const maxScore = aspects.length * 4;
    return {
      total,
      count,
      aspectCount: aspects.length,
      unscored: Math.max(aspects.length - count, 0),
      average: count ? total / count : 0,
      percentage: maxScore ? (total / maxScore) * 100 : 0,
      byCategory,
    };
  }, [data, values]);

  const updateValue = (aspectId, patch) => {
    setValues((prev) => ({
      ...prev,
      [aspectId]: { score: "", notes: "", ...(prev[aspectId] || {}), ...patch },
    }));
    setScoreDirty(true);
    setMissingAspectIds((prev) => prev.filter((id) => id !== aspectId));
  };

  const officialMissingIds = () => (data?.aspects || []).filter((aspect) => {
    const score = Number(values[aspect.id]?.score || 0);
    return score < 1 || score > 4;
  }).map((aspect) => aspect.id);

  const scrollToAspect = (aspectId) => {
    if (!aspectId) return;
    setTimeout(() => document.getElementById(`aspect-${aspectId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  const scrollToRtl = () => {
    setTimeout(() => document.getElementById("evaluation-followup-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const save = async ({ successMessage = "Penilaian berhasil disimpan", silent = false } = {}) => {
    const scores = Object.entries(values)
      .filter(([, v]) => v.score)
      .map(([aspect_id, v]) => ({ aspect_id, score: Number(v.score), notes: v.notes || "" }));
    if (scores.some((s) => s.score < 1 || s.score > 4)) {
      toast.error("Skor wajib berada di rentang 1 sampai 4");
      return false;
    }
    setSaving(true);
    try {
      const { data } = await api.put(`/assignments/${assignmentId}/assessment-scores`, { scores });
      setData(data);
      setScoreDirty(false);
      if (!silent) toast.success(successMessage);
      return true;
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan penilaian");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndContinueToRtl = async () => {
    const saved = await save({ successMessage: "Penilaian disimpan. Silakan lanjut ke Evaluasi & RTL." });
    if (!saved) return;
    const missing = officialMissingIds();
    if (missing.length > 0) {
      setMissingAspectIds(missing);
      toast.error(`Masih ada ${missing.length} aspek resmi yang belum diberi skor.`);
      scrollToAspect(missing[0]);
      return;
    }
    scrollToRtl();
  };

  const sendToTeacher = async () => {
    if (scoreDirty) {
      toast.error("Simpan penilaian terlebih dahulu sebelum lanjut ke Evaluasi & RTL.");
      return;
    }
    if (rtlDirty) {
      toast.error("Simpan Evaluasi & RTL terlebih dahulu sebelum mengirim penilaian ke Guru.");
      scrollToRtl();
      return;
    }
    if (!data.evaluation_complete) {
      toast.error("Evaluasi dan RTL harus dilengkapi sebelum penilaian dikirim ke Guru.");
      setRtlValidationRequest((v) => v + 1);
      scrollToRtl();
      return;
    }
    try {
      const { data } = await api.post(`/assignments/${assignmentId}/send-to-teacher`);
      setData(data);
      toast.success(data.assignment?.status === "Final" ? "Penilaian otomatis menjadi Final" : "Penilaian dikirim ke Guru");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal mengirim penilaian");
    }
  };

  const startRevision = async () => {
    try {
      const { data } = await api.post(`/assignments/${assignmentId}/start-revision`);
      setData(data);
      toast.success("Draft revisi dibuka");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memulai revisi");
    }
  };

  if (loading) return <div className="text-slate-500 text-sm">Memuat form penilaian...</div>;
  if (!data) return null;

  const { assignment, teacher, school, assessor } = data;
  const canAssess = user?.role === "admin" || user?.id === assignment.assessor_user_id;
  const canEditScores = canAssess && ["Draft", "Draft Revisi"].includes(assignment.status);
  const storedScoresComplete = Number(data.summary?.unscored_count || 0) === 0 && Number(data.summary?.aspect_count || 0) > 0;
  const canEditEvaluation = (user?.role === "admin" || user?.id === assignment.assessor_user_id) && assignment.status !== "Final" && storedScoresComplete;
  const hasMySignature = (data.signatures || []).some((s) => s.user_id === user?.id);
  const reviewComplete = !!assignment.teacher_review_completed || ["Disetujui Guru", "Feedback Maksimal Diproses", "Selesai"].includes(assignment.teacher_review_status);
  const canFinalize = user?.id === assignment.assessor_user_id && assignment.status !== "Final" && storedScoresComplete && data.evaluation_complete && hasMySignature && reviewComplete;
  const canSend = canEditScores && storedScoresComplete && data.evaluation_complete && !scoreDirty && !rtlDirty;
  const sendLabel = assignment.status === "Draft Revisi" ? "Kirim Revisi ke Guru" : "Kirim ke Guru";
  const sendDisabledReason = scoreDirty
    ? "Simpan penilaian terlebih dahulu sebelum lanjut ke Evaluasi & RTL."
    : !storedScoresComplete
      ? "Semua aspek resmi harus dinilai dan disimpan sebelum dikirim ke Guru."
      : rtlDirty
        ? "Simpan Evaluasi & RTL terlebih dahulu sebelum mengirim penilaian ke Guru."
        : !data.evaluation_complete
          ? "Evaluasi dan RTL harus dilengkapi sebelum penilaian dikirim ke Guru."
          : "";
  const finalizeDisabledReason = !storedScoresComplete
    ? "Semua aspek resmi harus disimpan terlebih dahulu."
    : !data.evaluation_complete
      ? "Evaluasi dan RTL harus dilengkapi sebelum penilaian dapat difinalisasi."
    : !reviewComplete
      ? "Penilaian harus dikirim dan disetujui oleh Guru terlebih dahulu sebelum RTL dapat difinalisasi."
      : !hasMySignature
        ? "Tanda tangan penilai wajib tersedia sebelum finalisasi."
        : "";

  return (
    <div className="space-y-6" data-testid="assessment-form-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" className="mb-3 px-0 text-slate-600" onClick={() => navigate("/assignments")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Kembali ke Assignment
          </Button>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Form Penilaian Detail</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">{teacher?.name || assignment.teacher_name}</h1>
          <p className="text-slate-600 mt-1">
            {canEditScores ? "Isi atau revisi skor observasi PJOK." : "Penilaian sedang terkunci sesuai status workflow."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {assignment.status === "Feedback dari Guru" && (
            <Button onClick={startRevision} variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50">
              <RotateCcw className="w-4 h-4 mr-2" /> Mulai Revisi
            </Button>
          )}
          {canEditScores && (
            <>
              <Button onClick={save} disabled={saving} className="bg-emerald-700 hover:bg-emerald-800" data-testid="save-assessment-button">
                <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan..." : "Simpan Penilaian"}
              </Button>
              <Button onClick={saveAndContinueToRtl} disabled={saving} variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" data-testid="save-and-go-rtl-button">
                <Save className="w-4 h-4 mr-2" /> Simpan & Lanjut ke RTL
              </Button>
              <Button onClick={sendToTeacher} disabled={!canSend} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-60" data-testid="send-to-teacher-button">
                <Send className="w-4 h-4 mr-2" /> {sendLabel}
              </Button>
            </>
          )}
        </div>
      </div>

      {canEditScores && sendDisabledReason && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <div className="font-semibold">Kirim ke Guru belum tersedia.</div>
              <div className="mt-1">{sendDisabledReason}</div>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <Info label="Nama Guru" value={teacher?.name || assignment.teacher_name} />
          <Info label="NIP" value={teacher?.nip || assignment.teacher_nip || "-"} />
          <Info label="Sekolah" value={school?.school_name || assignment.school_name || "-"} />
          <Info label="Mata Pelajaran" value={teacher?.subject || "PJOK"} />
          <Info label="Periode Penilaian" value={assignment.period_name || "-"} />
          <Info label="Nama Penilai" value={assessor?.name || assignment.assessor_name || "-"} />
          <Info label="Role Penilai" value={assignment.assessor_role || "-"} />
          <Info label="Tanggal Observasi" value={assignment.observation_date || "Belum dijadwalkan"} />
        </div>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Badge className={`${STATUS_TONE[assignment.status] || "bg-slate-100 text-slate-700"} border-0`}>Status Assignment: {assignment.status}</Badge>
          <Badge variant="outline">Feedback Guru: {assignment.feedback_count || 0} dari 2</Badge>
          {scoreDirty && canEditScores && <Badge className="bg-blue-100 text-blue-700 border-0">Ada perubahan skor belum disimpan</Badge>}
          {reviewComplete && assignment.status !== "Final" && <Badge className="bg-emerald-100 text-emerald-800 border-0">Review Guru selesai</Badge>}
          {summary.unscored > 0 && canEditScores && <Badge className="bg-amber-100 text-amber-800 border-0">Semua aspek resmi wajib diberi skor sebelum dikirim</Badge>}
          {assignment.status === "Final" && <Badge className="bg-emerald-700 text-white border-0">Final dan terkunci</Badge>}
        </div>
      </Card>

      {scoreDirty && canEditScores && (
        <Card className="border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <div className="font-semibold">Simpan penilaian terlebih dahulu sebelum lanjut ke Evaluasi & RTL.</div>
              <div className="mt-1">Skor yang baru dipilih di layar belum masuk database, jadi belum bisa dipakai untuk validasi RTL atau kirim ke Guru.</div>
            </div>
          </div>
        </Card>
      )}

      {rtlDirty && canEditScores && (
        <Card className="border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <div className="font-semibold">Simpan Evaluasi & RTL terlebih dahulu sebelum mengirim penilaian ke Guru.</div>
              <div className="mt-1">Perubahan RTL yang terlihat di layar belum masuk database.</div>
            </div>
          </div>
        </Card>
      )}

      {(data.feedbacks || []).length > 0 && (
        <Card className="p-5">
          <h2 className="font-heading text-xl font-semibold text-slate-900 mb-3">Feedback dari Guru</h2>
          <div className="space-y-3">
            {data.feedbacks.map((fb) => (
              <div key={fb.id} className="rounded-lg border border-orange-200 bg-orange-50/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0">Feedback ke-{fb.feedback_round}</Badge>
                  <span className="text-xs text-slate-500">{fb.created_at ? new Date(fb.created_at).toLocaleString("id-ID") : ""}</span>
                </div>
                <div className="text-sm text-slate-800 mt-2 whitespace-pre-wrap">{fb.feedback_text}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Summary label="Total Skor" value={summary.total} />
        <Summary label="Aspek Dinilai" value={`${summary.count}/${summary.aspectCount}`} />
        <Summary label="Belum Dinilai" value={summary.unscored} />
        <Summary label="Rata-rata" value={summary.average.toFixed(2)} />
        <Summary label="Nilai Sementara" value={`${summary.percentage.toFixed(2)}%`} />
      </div>

      <div data-testid="score-form" className="space-y-6">
      {grouped.map((category) => {
        const cat = summary.byCategory[category.id] || { total: 0, count: 0, aspectCount: category.aspects.length };
        const avg = cat.count ? cat.total / cat.count : 0;
        return (
          <Card key={category.id} className="p-5" data-testid={`category-${category.category_name}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-emerald-700" />
                  <h2 className="font-heading text-xl font-semibold text-slate-900">{category.category_name}</h2>
                </div>
                <p className="text-sm text-slate-500 mt-1">{category.description}</p>
              </div>
              <Badge variant="outline">Rata-rata kategori: {avg.toFixed(2)}</Badge>
            </div>

            <div className="space-y-4">
              {category.aspects.map((aspect) => (
                <div
                  key={aspect.id}
                  id={`aspect-${aspect.id}`}
                  className={`rounded-lg border p-4 ${missingAspectIds.includes(aspect.id) ? "border-red-300 bg-red-50" : "border-slate-200"}`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
                    <div>
                      <div className="font-medium text-slate-900">{aspect.aspect_name}</div>
                      {aspect.aspect_description && <div className="text-sm text-slate-500 mt-1">{aspect.aspect_description}</div>}
                    </div>
                    <div className="space-y-2">
                      <Label className={missingAspectIds.includes(aspect.id) ? "text-red-700" : ""}>Skor</Label>
                      <Select disabled={!canEditScores} value={values[aspect.id]?.score || ""} onValueChange={(v) => updateValue(aspect.id, { score: v })}>
                        <SelectTrigger data-testid={`score-${aspect.id}`} className={missingAspectIds.includes(aspect.id) ? "border-red-400 focus:ring-red-500" : ""}><SelectValue placeholder="Pilih skor" /></SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((score) => (
                            <SelectItem key={score} value={String(score)}>{score} - {SCORE_LABELS[score]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {missingAspectIds.includes(aspect.id) && <div className="text-xs text-red-600">Skor aspek ini wajib diisi sebelum lanjut ke RTL.</div>}
                    </div>
                  </div>
                  <div className="space-y-2 mt-3">
                    <Label>Catatan Penilai</Label>
                    <Textarea
                      rows={2}
                      value={values[aspect.id]?.notes || ""}
                      onChange={(e) => updateValue(aspect.id, { notes: e.target.value })}
                      disabled={!canEditScores}
                      placeholder="Catatan opsional untuk aspek ini"
                      data-testid={`notes-${aspect.id}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      </div>

      {groupedProposed.length > 0 && (
        <Card className="p-5" data-testid="proposed-aspects-section">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-orange-600" />
                <h2 className="font-heading text-xl font-semibold text-slate-900">Aspek Tambahan / Usulan Guru</h2>
              </div>
              <p className="text-sm text-slate-500 mt-1">Aspek ini dapat diberi skor dan catatan, tetapi tidak masuk nilai akhir utama.</p>
            </div>
            <Badge variant="outline">
              Info tambahan: {proposedSummary.count}/{proposedSummary.aspectCount} dinilai, rata-rata {proposedSummary.average.toFixed(2)}
            </Badge>
          </div>

          <div className="space-y-6">
            {groupedProposed.map((category) => (
              <div key={category.id} className="space-y-3">
                <div className="font-semibold text-slate-800">{category.category_name}</div>
                {category.aspects.map((aspect) => (
                  <div key={aspect.id} className="rounded-lg border border-orange-200 bg-orange-50/40 p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium text-slate-900">{aspect.aspect_name}</div>
                          <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0">Usulan Guru</Badge>
                        </div>
                        {aspect.aspect_description && <div className="text-sm text-slate-500 mt-1">{aspect.aspect_description}</div>}
                        {aspect.reason && <div className="text-xs text-slate-500 mt-2">Alasan: {aspect.reason}</div>}
                      </div>
                      <div className="space-y-2">
                        <Label>Skor</Label>
                        <Select disabled={!canEditScores} value={values[aspect.id]?.score || ""} onValueChange={(v) => updateValue(aspect.id, { score: v })}>
                          <SelectTrigger data-testid={`score-proposed-${aspect.id}`}><SelectValue placeholder="Pilih skor" /></SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4].map((score) => (
                              <SelectItem key={score} value={String(score)}>{score} - {SCORE_LABELS[score]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2 mt-3">
                      <Label>Catatan Penilai</Label>
                      <Textarea
                        rows={2}
                        value={values[aspect.id]?.notes || ""}
                        onChange={(e) => updateValue(aspect.id, { notes: e.target.value })}
                        disabled={!canEditScores}
                        placeholder="Catatan opsional untuk aspek usulan"
                        data-testid={`notes-proposed-${aspect.id}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      <EvaluationFollowupSection
        data={data}
        setData={setData}
        canEdit={canEditEvaluation}
        canFinalize={canFinalize}
        hasUnsavedScores={scoreDirty}
        onSaveAndContinue={saveAndContinueToRtl}
        finalizeDisabledReason={finalizeDisabledReason}
        onDirtyChange={setRtlDirty}
        validationRequest={rtlValidationRequest}
      />

      <DigitalSignatureSection
        data={data}
        setData={setData}
        canSign={user?.id === assignment.assessor_user_id && assignment.status !== "Final"}
      />
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

function Summary({ label, value }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500 font-medium">{label}</div>
      <div className="font-heading text-2xl font-bold text-slate-900 mt-1">{value}</div>
    </Card>
  );
}
