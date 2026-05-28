import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/context/AuthContext";
import { toast } from "sonner";

const MENU_LABELS = {
  dashboard: "Dashboard",
  user_management: "Manajemen Pengguna",
  data_sekolah: "Data Sekolah",
  data_guru: "Data Guru",
  data_pengawas: "Data Pengawas",
  data_kepala_sekolah: "Data Kepala Sekolah",
  role_permission: "Pengaturan Hak Akses",
};

const ROLES = ["admin", "pengawas", "kepala_sekolah", "guru"];

export default function Permissions() {
  const [perms, setPerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("admin");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/permissions");
      setPerms(r.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const byRole = useMemo(() => {
    const m = {};
    for (const p of perms) {
      m[p.role] = m[p.role] || {};
      m[p.role][p.menu_name] = p;
    }
    return m;
  }, [perms]);

  const toggle = async (perm, field) => {
    const updated = { can_create: perm.can_create, can_read: perm.can_read, can_update: perm.can_update, can_delete: perm.can_delete, [field]: !perm[field] };
    setPerms((old) => old.map((p) => p.id === perm.id ? { ...p, ...updated } : p));
    try {
      await api.put(`/permissions/${perm.id}`, updated);
      toast.success("Hak akses diperbarui");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memperbarui");
      load();
    }
  };

  return (
    <div className="space-y-6" data-testid="permissions-page">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Pengaturan Sistem</div>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Pengaturan Hak Akses</h1>
        <p className="text-slate-600 mt-1">Atur izin Create, Read, Update, dan Delete untuk setiap role pada tiap menu.</p>
      </div>

      <Card className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            {ROLES.map((r) => <TabsTrigger key={r} value={r} data-testid={`tab-${r}`}>{ROLE_LABELS[r]}</TabsTrigger>)}
          </TabsList>
          {ROLES.map((role) => (
            <TabsContent key={role} value={role}>
              {loading ? (
                <div className="text-sm text-slate-500 py-10 text-center">Memuat...</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left py-3 px-4 font-medium">Menu</th>
                        <th className="text-center py-3 px-4 font-medium">Lihat</th>
                        <th className="text-center py-3 px-4 font-medium">Tambah</th>
                        <th className="text-center py-3 px-4 font-medium">Ubah</th>
                        <th className="text-center py-3 px-4 font-medium">Hapus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(MENU_LABELS).map((menu) => {
                        const p = byRole[role]?.[menu];
                        if (!p) return null;
                        const disabled = role === "admin"; // admin always full
                        return (
                          <tr key={menu} className="border-t border-slate-100">
                            <td className="py-3 px-4 font-medium text-slate-800">{MENU_LABELS[menu]}</td>
                            <td className="text-center py-3 px-4">
                              <Checkbox checked={disabled ? true : p.can_read} disabled={disabled} onCheckedChange={() => !disabled && toggle(p, "can_read")} data-testid={`perm-${role}-${menu}-read`} />
                            </td>
                            <td className="text-center py-3 px-4">
                              <Checkbox checked={disabled ? true : p.can_create} disabled={disabled} onCheckedChange={() => !disabled && toggle(p, "can_create")} data-testid={`perm-${role}-${menu}-create`} />
                            </td>
                            <td className="text-center py-3 px-4">
                              <Checkbox checked={disabled ? true : p.can_update} disabled={disabled} onCheckedChange={() => !disabled && toggle(p, "can_update")} data-testid={`perm-${role}-${menu}-update`} />
                            </td>
                            <td className="text-center py-3 px-4">
                              <Checkbox checked={disabled ? true : p.can_delete} disabled={disabled} onCheckedChange={() => !disabled && toggle(p, "can_delete")} data-testid={`perm-${role}-${menu}-delete`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {role === "admin" && (
                <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">Info</Badge>
                  Administrator selalu memiliki seluruh hak akses dan tidak dapat dibatasi.
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </Card>
    </div>
  );
}
