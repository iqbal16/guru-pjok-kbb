import { useEffect, useState } from "react";
import { useAuth, ROLE_LABELS } from "@/context/AuthContext";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  School,
  GraduationCap,
  UserCog,
  UserCheck,
  Users,
  Trophy,
  ArrowRight,
  Mail,
  MapPin,
  Clock,
  ClipboardList,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
} from "lucide-react";

function StatCard({ title, value, icon: Icon, tone = "emerald", testid }) {
  const tones = {
    emerald: "bg-emerald-100 text-emerald-700",
    orange: "bg-orange-100 text-orange-700",
    blue: "bg-blue-100 text-blue-700",
    purple: "bg-violet-100 text-violet-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <Card className="p-6 hover:shadow-md transition-shadow" data-testid={testid}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-slate-500 font-medium">{title}</div>
          <div className="font-heading text-3xl font-bold text-slate-900 mt-2">{value}</div>
        </div>
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-5 h-5" strokeWidth={2} />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/dashboard/stats"),
      api.get("/assessment-periods/active"),
    ])
      .then(([s, p]) => { setStats(s.data); setActive(p.data?.active || null); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-slate-500 text-sm">Memuat data dashboard...</div>;
  }

  const guruAssignments = stats.my_assignments || [];
  const guruAssignmentByRole = guruAssignments.reduce((acc, item) => {
    acc[item.assessor_role] = item;
    return acc;
  }, {});

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-2">
            Dashboard {ROLE_LABELS[user.role]}
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-slate-900">
            Aplikasi Penilaian Kinerja Guru PJOK SD Kabupaten Bandung Barat
          </h1>
          <p className="text-slate-600 mt-2">
            Halo, {user.name.split(",")[0]}. Berikut ringkasan sistem penilaian kinerja Guru PJOK SD Kabupaten Bandung Barat.
          </p>
        </div>
        <Badge className="bg-orange-100 text-orange-700 border-0 px-3 py-1.5" data-testid="active-period-badge">
          {active ? `Periode Aktif: ${active.period_name}` : "Belum ada periode aktif"}
        </Badge>
      </div>

      {user.role === "admin" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
            <StatCard title="Total Sekolah" value={stats.total_sekolah} icon={School} tone="emerald" testid="stat-total-sekolah" />
            <StatCard title="Total Guru" value={stats.total_guru} icon={GraduationCap} tone="orange" testid="stat-total-guru" />
            <StatCard title="Total Pengawas" value={stats.total_pengawas} icon={UserCog} tone="blue" testid="stat-total-pengawas" />
            <StatCard title="Total Kepala Sekolah" value={stats.total_kepala_sekolah} icon={UserCheck} tone="purple" testid="stat-total-kepsek" />
            <StatCard title="Total Pengguna Aktif" value={stats.total_user_aktif} icon={Users} tone="slate" testid="stat-total-users" />
          </div>

          <div>
            <h3 className="font-heading text-lg font-semibold text-slate-900 mb-3">Status Penilaian - Periode Aktif</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
              <StatCard title="Assignment Kepala Sekolah" value={stats.total_assignment_kepala_sekolah || 0} icon={ClipboardList} tone="emerald" testid="stat-assignment-kepsek" />
              <StatCard title="Assignment Pengawas" value={stats.total_assignment_pengawas || 0} icon={ClipboardCheck} tone="blue" testid="stat-assignment-pengawas" />
              <StatCard title="Assignment Lengkap" value={stats.guru_assignment_lengkap || 0} icon={CheckCircle2} tone="emerald" testid="stat-assignment-lengkap" />
              <StatCard title="Belum Ada Kepala Sekolah" value={stats.guru_belum_assignment_kepala_sekolah || 0} icon={CircleDot} tone="slate" testid="stat-belum-kepsek" />
              <StatCard title="Belum Ada Pengawas" value={stats.guru_belum_assignment_pengawas || 0} icon={GraduationCap} tone="purple" testid="stat-belum-pengawas" />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="font-heading text-xl font-semibold text-slate-900 mb-1">Akses Cepat</h3>
              <p className="text-sm text-slate-500 mb-5">Pintasan ke menu manajemen utama.</p>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="justify-between h-auto py-3" onClick={() => navigate("/users")} data-testid="shortcut-users">
                  <span className="flex items-center gap-2"><Users className="w-4 h-4" /> Pengguna</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" className="justify-between h-auto py-3" onClick={() => navigate("/sekolah")} data-testid="shortcut-sekolah">
                  <span className="flex items-center gap-2"><School className="w-4 h-4" /> Sekolah</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" className="justify-between h-auto py-3" onClick={() => navigate("/guru")} data-testid="shortcut-guru">
                  <span className="flex items-center gap-2"><GraduationCap className="w-4 h-4" /> Guru</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" className="justify-between h-auto py-3" onClick={() => navigate("/assignments")} data-testid="shortcut-assignments">
                  <span className="flex items-center gap-2"><ClipboardList className="w-4 h-4" /> Assignment</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" className="justify-between h-auto py-3" onClick={() => navigate("/permissions")} data-testid="shortcut-permissions">
                  <span className="flex items-center gap-2"><Trophy className="w-4 h-4" /> Hak Akses</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </Card>

            <Card className="p-6 relative overflow-hidden bg-emerald-900 text-white">
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: "url('https://images.pexels.com/photos/33334606/pexels-photo-33334606.jpeg')",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/85 to-emerald-900/40" />
              <div className="relative">
                <div className="text-xs uppercase tracking-[0.2em] font-bold text-orange-300 mb-2">Tahap Berikutnya</div>
                <h3 className="font-heading text-2xl font-bold mb-2">Modul Penilaian Detail</h3>
                <p className="text-emerald-100/90 text-sm mb-4 max-w-sm">
                  Fitur penilaian kinerja per semester, rubrik observasi pengawas, dan rekap kepala sekolah akan tersedia di tahap selanjutnya.
                </p>
                <Badge className="bg-orange-500 hover:bg-orange-500 text-white border-0">Segera Hadir</Badge>
              </div>
            </Card>
          </div>
        </>
      )}

      {user.role === "pengawas" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard title="Sekolah di Wilayah" value={stats.total_sekolah_wilayah} icon={School} tone="emerald" testid="stat-sekolah-wilayah" />
            <StatCard title="Guru yang Dapat Dilihat" value={stats.total_guru_wilayah} icon={GraduationCap} tone="orange" testid="stat-guru-wilayah" />
            <Card className="p-6">
              <div className="text-sm text-slate-500 font-medium">Wilayah Kerja</div>
              <div className="flex items-center gap-2 mt-2">
                <MapPin className="w-5 h-5 text-emerald-700" />
                <div className="font-heading text-xl font-semibold text-slate-900">{stats.wilayah_kerja}</div>
              </div>
              <div className="text-xs text-slate-500 mt-3">Kabupaten Bandung Barat</div>
            </Card>
          </div>
          <Card className="p-6 border-dashed">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-slate-700">
                <ClipboardList className="w-5 h-5 text-emerald-700" />
                <div>
                  <div className="font-medium">Assignment Penilaian Saya</div>
                  <div className="text-sm text-slate-500">{stats.assignment_saya || 0} assignment pada periode aktif</div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/assignments")} data-testid="goto-assignments">
                Buka <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100">
              <div><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-bold text-slate-900">{stats.assignment_saya || 0}</div></div>
              <div><div className="text-xs text-slate-500">Belum Dimulai</div><div className="text-2xl font-bold text-slate-900">{stats.assignment_belum_dimulai || 0}</div></div>
              <div><div className="text-xs text-slate-500">Draft</div><div className="text-2xl font-bold text-amber-700">{stats.assignment_draft || 0}</div></div>
            </div>
          </Card>
        </>
      )}

      {user.role === "kepala_sekolah" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard title="Total Guru di Sekolah" value={stats.total_guru_sekolah} icon={GraduationCap} tone="orange" testid="stat-guru-sekolah" />
            <StatCard title="Sudah Punya Assignment" value={stats.guru_sudah_assignment || 0} icon={CheckCircle2} tone="emerald" testid="stat-guru-sudah-kepsek" />
            <StatCard title="Belum Punya Assignment" value={stats.guru_belum_assignment || 0} icon={CircleDot} tone="slate" testid="stat-guru-belum-kepsek" />
            <StatCard title="Assignment Draft" value={stats.assignment_draft || 0} icon={Clock} tone="purple" testid="stat-draft-kepsek" />
          </div>
          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <School className="w-5 h-5 text-emerald-700" />
                <div>
                  <div className="text-sm text-slate-500 font-medium">Sekolah Anda</div>
                  <div className="font-heading text-lg font-semibold text-slate-900">{stats.nama_sekolah}</div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/assignments")} data-testid="goto-assignments-kepsek">
                Kelola Assignment <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </Card>
        </>
      )}

      {user.role === "guru" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 md:col-span-2">
              <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-3">Profil</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-slate-700">
                  <Users className="w-4 h-4" /> <span className="font-medium">{stats.profil?.name || user.name}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Mail className="w-4 h-4" /> <span>{user.email}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <School className="w-4 h-4" /> <span>{stats.sekolah?.school_name || "Belum diatur"}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Trophy className="w-4 h-4" /> <span>Mapel: {stats.mata_pelajaran}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <GraduationCap className="w-4 h-4" /> <span>NIP: {stats.profil?.nip || "-"}</span>
                </div>
              </div>
            </Card>
            <Card className="p-6 relative overflow-hidden" data-testid="guru-assignment-card">
              <div className="text-xs uppercase tracking-[0.2em] font-bold text-orange-600">Status Penilaian</div>
              {guruAssignments.length > 0 ? (
                <>
                  <h4 className="font-heading text-xl font-semibold text-slate-900 mt-2">Periode aktif</h4>
                  <div className="text-sm text-slate-600 mt-3 space-y-3">
                    {["Kepala Sekolah", "Pengawas"].map((role) => {
                      const assignment = guruAssignmentByRole[role];
                      return (
                        <div key={role} className="rounded-lg border border-slate-200 p-3">
                          <div className="font-medium text-slate-900">
                            {role === "Pengawas" ? "Penilaian Pengawas" : "Penilaian Kepala Sekolah"}
                          </div>
                          {assignment ? (
                            <div className="space-y-1 mt-2">
                              <div className="flex items-center gap-2"><ClipboardCheck className="w-3.5 h-3.5 text-emerald-700" /> Status: {assignment.status}</div>
                              <div className="flex items-center gap-2"><UserCog className="w-3.5 h-3.5 text-emerald-700" /> {assignment.assessor_name}</div>
                              <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-emerald-700" /> Observasi: {assignment.observation_date || "Belum dijadwalkan"}</div>
                            </div>
                          ) : (
                            <div className="text-slate-500 mt-2">Belum ada assignment</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/penilaian-saya")} data-testid="goto-my-assessment">
                    Lihat Detail <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </>
              ) : (
                <>
                  <h4 className="font-heading text-lg font-semibold text-slate-900 mt-2">Belum ada assignment</h4>
                  <p className="text-sm text-slate-600 mt-1">Anda belum ditunjuk dalam penilaian periode aktif.</p>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
