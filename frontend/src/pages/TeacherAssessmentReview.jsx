import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { formatApiErrorDetail } from "@/lib/api";
import EvaluationFollowupSection from "@/components/EvaluationFollowupSection";
import DigitalSignatureSection from "@/components/DigitalSignatureSection";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, CheckCircle2, ClipboardCheck, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

const STATUS_TONE = {
  "Menunggu Review Guru": "bg-blue-100 text-blue-700",
  "Feedback dari Guru": "bg-orange-100 text-orange-700",
  "Draft Revisi": "bg-purple-100 text-purple-700",
  Final: "bg-emerald-100 text-emerald-700",
};

const SCORE_LABELS = {
  1: "Kurang",
  2: "Cukup",
  3: "Baik",
  4: "Sangat Baik",
};

export default function TeacherAssessmentReview() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/assignments/${assignmentId}/teacher-review`);
      setData(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal membuka review penilaian");
      navigate("/penilaian-saya");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [assignmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoreMap = useMemo(() => Object.fromEntries((data?.scores || []).map((s) => [s.aspect_id, s])), [data]);
  const officialGroups = useMemo(() => groupByCategory(data?.categories || [], data?.aspects || []), [data]);
  const proposedGroups = useMemo(() => groupByCategory(data?.categories || [], data?.proposed_aspects || []).filter((g) => g.aspects.length), [data]);

  const approve = async () => {
    try {
      const { data } = await api.post(`/assignments/${assignmentId}/teacher-approve`);
      setData(data);
      toast.success(data.assignment?.status === "Final" ? "Penilaian disetujui dan menjadi Final" : "Penilaian disetujui. Penilai akan menyelesaikan finalisasi.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyetujui penilaian");
    }
  };

  const submitFeedback = async () => {
    try {
      const { data } = await api.post(`/assignments/${assignmentId}/teacher-feedback`, { feedback_text: feedbackText });
      setData(data);
      setFeedbackOpen(false);
      setFeedbackText("");
      toast.success("Feedback dikirim ke penilai");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal mengirim feedback");
    }
  };

  if (loading) return <div className="text-slate-500 text-sm">Memuat review penilaian...</div>;
  if (!data) return null;

  const { assignment, teacher, school, assessor, summary } = data;
  const reviewComplete = !!assignment.teacher_review_completed || ["Disetujui Guru", "Feedback Maksimal Diproses", "Selesai"].includes(assignment.teacher_review_status);
  const canReview = assignment.status === "Menunggu Review Guru" && !reviewComplete;
  const canFeedback = canReview && (assignment.feedback_count || 0) < 2;
  const hasMySignature = (data.signatures || []).some((s) => s.user_id === user?.id);

  return (
    <div className="space-y-6" data-testid="teacher-review-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" className="mb-3 px-0 text-slate-600" onClick={() => navigate("/penilaian-saya")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Kembali ke Penilaian Saya
          </Button>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Review Penilaian Saya</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">{assignment.assessor_role}</h1>
          <p className="text-slate-600 mt-1">Periksa hasil penilaian. Skor dan catatan tidak dapat diubah oleh Guru.</p>
        </div>
        {canReview && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={approve} disabled={!hasMySignature} className="bg-emerald-700 hover:bg-emerald-800" data-testid="teacher-approve-button">
              <CheckCircle2 className="w-4 h-4 mr-2" /> Setujui / OK
            </Button>
            <Button onClick={() => setFeedbackOpen(true)} disabled={!canFeedback} variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" data-testid="teacher-feedback-button">
              <MessageSquareText className="w-4 h-4 mr-2" /> Beri Feedback
            </Button>
          </div>
        )}
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <Info label="Nama Guru" value={teacher?.name || assignment.teacher_name} />
          <Info label="NIP" value={teacher?.nip || assignment.teacher_nip || "-"} />
          <Info label="Sekolah" value={school?.school_name || assignment.school_name || "-"} />
          <Info label="Periode Penilaian" value={assignment.period_name || "-"} />
          <Info label="Nama Penilai" value={assessor?.name || assignment.assessor_name || "-"} />
          <Info label="Role Penilai" value={assignment.assessor_role || "-"} />
          <Info label="Tanggal Observasi" value={assignment.observation_date || "Belum dijadwalkan"} />
          <Info label="Feedback" value={`${assignment.feedback_count || 0} dari 2`} />
        </div>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Badge className={`${STATUS_TONE[assignment.status] || "bg-slate-100 text-slate-700"} border-0`}>{assignment.status}</Badge>
          {reviewComplete && assignment.status !== "Final" && <Badge className="bg-emerald-100 text-emerald-800 border-0">Review Guru selesai</Badge>}
          {assignment.status === "Final" && <Badge className="bg-emerald-700 text-white border-0">Final dan terkunci</Badge>}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Summary label="Total Skor" value={summary.total_score} />
        <Summary label="Aspek Dinilai" value={`${summary.scored_count}/${summary.aspect_count}`} />
        <Summary label="Belum Dinilai" value={summary.unscored_count} />
        <Summary label="Rata-rata" value={Number(summary.average_score || 0).toFixed(2)} />
        <Summary label="Nilai Akhir" value={`${Number(summary.final_percentage || 0).toFixed(2)}%`} />
      </div>

      {officialGroups.map((category) => (
        <ScoreGroup key={category.id} category={category} scoreMap={scoreMap} />
      ))}

      {proposedGroups.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardCheck className="w-5 h-5 text-orange-600" />
            <h2 className="font-heading text-xl font-semibold text-slate-900">Aspek Tambahan / Usulan Guru</h2>
          </div>
          <div className="space-y-5">
            {proposedGroups.map((category) => (
              <ScoreGroup key={category.id} category={category} scoreMap={scoreMap} proposed />
            ))}
          </div>
        </Card>
      )}

      {(data.feedbacks || []).length > 0 && (
        <Card className="p-5">
          <h2 className="font-heading text-xl font-semibold text-slate-900 mb-3">Riwayat Feedback</h2>
          <div className="space-y-3">
            {data.feedbacks.map((fb) => (
              <div key={fb.id} className="rounded-lg border border-orange-200 bg-orange-50/50 p-4">
                <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0">Feedback ke-{fb.feedback_round}</Badge>
                <div className="text-sm text-slate-800 mt-2 whitespace-pre-wrap">{fb.feedback_text}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <EvaluationFollowupSection data={data} setData={setData} canEdit={false} canFinalize={false} />

      <DigitalSignatureSection data={data} setData={setData} canSign={canReview} />

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Beri Feedback</DialogTitle>
            <DialogDescription>Feedback maksimal 2 kali untuk setiap assignment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Catatan Feedback</Label>
            <Textarea rows={5} value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="Tulis feedback umum terhadap hasil penilaian" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackOpen(false)}>Batal</Button>
            <Button onClick={submitFeedback} className="bg-orange-600 hover:bg-orange-700">Kirim Feedback</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function groupByCategory(categories, aspects) {
  return categories.map((category) => ({ ...category, aspects: aspects.filter((a) => a.category_id === category.id) }));
}

function ScoreGroup({ category, scoreMap, proposed = false }) {
  const Wrapper = proposed ? "div" : Card;
  return (
    <Wrapper className={proposed ? "p-0" : "p-5"}>
      <div className="flex items-center gap-2 mb-4">
        {!proposed && <ClipboardCheck className="w-5 h-5 text-emerald-700" />}
        <h2 className="font-heading text-xl font-semibold text-slate-900">{category.category_name}</h2>
      </div>
      <div className="space-y-4">
        {category.aspects.map((aspect) => {
          const score = scoreMap[aspect.id];
          return (
            <div key={aspect.id} className={`rounded-lg border p-4 ${proposed ? "border-orange-200 bg-orange-50/40" : "border-slate-200"}`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="max-w-3xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium text-slate-900">{aspect.aspect_name}</div>
                    {proposed && <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0">Usulan Guru</Badge>}
                  </div>
                  {aspect.aspect_description && <div className="text-sm text-slate-500 mt-1">{aspect.aspect_description}</div>}
                  {aspect.reason && <div className="text-xs text-slate-500 mt-2">Alasan: {aspect.reason}</div>}
                </div>
                <Badge variant="outline">
                  {score?.score ? `${score.score} - ${SCORE_LABELS[score.score]}` : "Belum dinilai"}
                </Badge>
              </div>
              <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Catatan Penilai</div>
                <div className="text-sm text-slate-800 whitespace-pre-wrap">{score?.notes || "-"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Wrapper>
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
