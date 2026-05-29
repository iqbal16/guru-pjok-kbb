import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, CalendarCheck2, User, School, Clock, AlertCircle } from "lucide-react";

const STATUS_TONE = {
  "Belum Dimulai": "bg-slate-100 text-slate-700",
  Draft: "bg-amber-100 text-amber-800",
  Final: "bg-emerald-100 text-emerald-700",
};

const ROLES = ["Kepala Sekolah", "Pengawas"];

export default function MyAssessment() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/assignments/me").then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  const assignmentsByRole = useMemo(() => {
    const out = {};
    for (const item of data?.assignments || []) out[item.assessor_role] = item;
    return out;
  }, [data]);

  if (loading) return <div className="text-slate-500 text-sm">Memuat...</div>;
  const period = data?.active_period;
  const assignments = data?.assignments || [];

  return (
    <div className="space-y-6 max-w-5xl" data-testid="my-assessment-page">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Penilaian PJOK</div>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Penilaian Saya</h1>
        <p className="text-slate-600 mt-1">Status penilaian kinerja Anda pada periode aktif.</p>
      </div>

      {!period ? (
        <Card className="p-8 text-center border-dashed">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <div className="text-slate-700 font-medium">Belum ada periode penilaian aktif</div>
          <div className="text-sm text-slate-500 mt-1">Tunggu Admin mengaktifkan periode untuk semester ini.</div>
        </Card>
      ) : assignments.length === 0 ? (
        <Card className="p-8 text-center border-dashed" data-testid="status-no-assignment">
          <ClipboardCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <div className="text-slate-700 font-medium">Belum ada assignment penilaian</div>
          <div className="text-sm text-slate-500 mt-1">Anda belum ditunjuk dalam penilaian periode <span className="font-medium">{period.period_name}</span>.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {ROLES.map((role) => (
            <AssessmentCard key={role} role={role} period={period} assignment={assignmentsByRole[role]} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssessmentCard({ role, period, assignment }) {
  const title = role === "Pengawas" ? "Penilaian Pengawas" : "Penilaian Kepala Sekolah";
  if (!assignment) {
    return (
      <Card className="p-6 border-dashed" data-testid={`my-assessment-${role.toLowerCase().replace(" ", "-")}-empty`}>
        <Badge className="bg-slate-100 text-slate-700 border-0 mb-4">{title}</Badge>
        <div className="text-slate-700 font-medium">Belum ada assignment</div>
        <div className="text-sm text-slate-500 mt-1">Assignment {title.toLowerCase()} belum dibuat untuk periode {period.period_name}.</div>
      </Card>
    );
  }

  return (
    <Card className="p-6 relative overflow-hidden" data-testid={`my-assessment-${role.toLowerCase().replace(" ", "-")}-card`}>
      <div className="relative space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Badge className="bg-emerald-700 text-white border-0">
            <CalendarCheck2 className="w-3 h-3 mr-1" /> {period.period_name}
          </Badge>
          <Badge className={`${STATUS_TONE[assignment.status] || "bg-slate-100"} border-0 px-3 py-1`} data-testid="my-assessment-status">
            Status: {assignment.status}
          </Badge>
        </div>

        <div>
          <div className="font-heading text-xl font-semibold text-slate-900">{title}</div>
          <div className="text-sm text-slate-500 mt-1">{assignment.assignment_type}</div>
        </div>

        <div className="pt-2 space-y-3">
          <DetailRow icon={User} label="Penilai" value={assignment.assessor_name || "-"} />
          <DetailRow icon={School} label="Sekolah" value={assignment.school_name || "-"} />
          <DetailRow icon={Clock} label="Tanggal Observasi" value={assignment.observation_date || "Belum dijadwalkan"} />
          <DetailRow icon={ClipboardCheck} label="Jenis Penilaian" value={title} />
        </div>

        {assignment.notes && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">Catatan Penilai</div>
            <div className="text-sm text-slate-800">{assignment.notes}</div>
          </div>
        )}
      </div>
    </Card>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-emerald-700 mt-0.5" />
      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
        <div className="text-sm text-slate-900 font-medium mt-0.5">{value}</div>
      </div>
    </div>
  );
}
