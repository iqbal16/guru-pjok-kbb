import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const TYPE_TONE = {
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
};

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/notifications");
      setItems(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memuat notifikasi");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const markRead = async (n) => {
    try {
      await api.post(`/notifications/${n.id}/read`);
      setItems((prev) => prev.map((it) => it.id === n.id ? { ...it, is_read: true, read_at: new Date().toISOString() } : it));
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menandai notifikasi");
    }
  };

  const markAll = async () => {
    try {
      await api.post("/notifications/mark-all-read");
      setItems((prev) => prev.map((it) => ({ ...it, is_read: true })));
      toast.success("Semua notifikasi ditandai dibaca");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menandai semua");
    }
  };

  const goRelated = async (n) => {
    if (!n.is_read) await markRead(n);
    if (n.related_module === "assessment_assignments") navigate("/assignments");
    else if (n.related_module === "teacher_proposed_aspects") navigate("/usulan-aspek-observasi");
    else if (n.related_module === "evaluation_followups") navigate("/evaluasi-rtl");
  };

  const unread = items.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6" data-testid="notifications-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Sistem</div>
          <h1 className="font-heading text-3xl font-bold text-slate-900">Notifikasi</h1>
          <p className="text-slate-600 mt-1">{unread} notifikasi belum dibaca.</p>
        </div>
        <Button variant="outline" onClick={markAll} disabled={unread === 0} data-testid="notification-mark-all-read">
          <CheckCheck className="w-4 h-4 mr-2" /> Tandai Semua Dibaca
        </Button>
      </div>

      <Card className="divide-y divide-slate-100 overflow-hidden" data-testid="notification-list">
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Memuat notifikasi...</div> :
          items.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Bell className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              Belum ada notifikasi.
            </div>
          ) : items.map((n) => (
            <div key={n.id} className={`p-4 sm:p-5 ${n.is_read ? "bg-white" : "bg-emerald-50/50"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900">{n.title}</h3>
                    <Badge className={`${TYPE_TONE[n.type] || TYPE_TONE.info} border-0`}>{n.type || "info"}</Badge>
                    {!n.is_read && <Badge className="bg-red-100 text-red-700 border-0">Baru</Badge>}
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{n.message}</p>
                  <div className="text-xs text-slate-500 mt-2">{n.created_at ? new Date(n.created_at).toLocaleString("id-ID") : "-"}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!n.is_read && <Button size="sm" variant="outline" onClick={() => markRead(n)} data-testid="notification-mark-read">Dibaca</Button>}
                  {n.related_module && <Button size="sm" variant="ghost" onClick={() => goRelated(n)}><ExternalLink className="w-4 h-4" /></Button>}
                </div>
              </div>
            </div>
          ))}
      </Card>
    </div>
  );
}
