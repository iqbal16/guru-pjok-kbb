import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth, ROLE_LABELS } from "@/context/AuthContext";
import { User, Mail, School, Trophy, GraduationCap, MapPin } from "lucide-react";

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      <Icon className="w-4 h-4 text-emerald-700 mt-0.5" />
      <div className="flex-1">
        <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
        <div className="text-sm text-slate-900 font-medium mt-0.5">{value || "-"}</div>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/profile/me").then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-500 text-sm">Memuat profil...</div>;
  const teacher = data?.teacher;
  const school = data?.school;

  return (
    <div className="space-y-6 max-w-3xl" data-testid="profile-page">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Akun Saya</div>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Profil Saya</h1>
        <p className="text-slate-600 mt-1">Informasi pribadi dan penugasan Anda di sistem.</p>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
          <div className="w-16 h-16 rounded-xl bg-emerald-700 text-white font-bold text-2xl flex items-center justify-center">
            {user.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>
          <div>
            <div className="font-heading text-xl font-bold text-slate-900">{user.name}</div>
            <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0 mt-1">{ROLE_LABELS[user.role]}</Badge>
          </div>
        </div>
        <div className="pt-2">
          <Row icon={User} label="Nama" value={user.name} />
          <Row icon={Mail} label="Email" value={user.email} />
          <Row icon={GraduationCap} label="NIP" value={teacher?.nip} />
          <Row icon={Trophy} label="Mata Pelajaran" value={teacher?.subject || "PJOK"} />
          <Row icon={School} label="Sekolah" value={school?.school_name} />
          <Row icon={MapPin} label="Kecamatan" value={school?.subdistrict} />
        </div>
      </Card>
    </div>
  );
}
