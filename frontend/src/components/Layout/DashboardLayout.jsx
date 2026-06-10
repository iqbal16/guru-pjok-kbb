import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth, ROLE_LABELS } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  LayoutDashboard,
  Users,
  School,
  GraduationCap,
  UserCog,
  UserCheck,
  ShieldCheck,
  LogOut,
  Trophy,
  User,
  CalendarRange,
  CalendarDays,
  CalendarCheck2,
  Layers,
  ListChecks,
  Lightbulb,
  ClipboardPenLine,
  ClipboardList,
  ClipboardCheck,
  FileText,
  FolderUp,
  Menu,
  X,
  Bell,
  History,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const MENU = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "pengawas", "kepala_sekolah", "guru"], testid: "menu-dashboard" },
  { to: "/profil", label: "Profil Saya", icon: User, roles: ["guru"], testid: "menu-profile" },
  { section: "Master Data", roles: ["admin", "pengawas", "kepala_sekolah"] },
  { to: "/users", label: "Manajemen Pengguna", icon: Users, roles: ["admin"], testid: "menu-users" },
  { to: "/sekolah", label: "Data Sekolah", icon: School, roles: ["admin", "pengawas", "kepala_sekolah"], testid: "menu-sekolah" },
  { to: "/guru", label: "Data Guru", icon: GraduationCap, roles: ["admin", "pengawas", "kepala_sekolah"], testid: "menu-guru" },
  { to: "/pengawas", label: "Data Pengawas", icon: UserCog, roles: ["admin"], testid: "menu-pengawas" },
  { to: "/kepala-sekolah", label: "Data Kepala Sekolah", icon: UserCheck, roles: ["admin"], testid: "menu-kepsek" },
  { section: "Periode & Instrumen", roles: ["admin", "pengawas", "kepala_sekolah", "guru"] },
  { to: "/tahun-ajaran", label: "Tahun Ajaran", icon: CalendarRange, roles: ["admin"], testid: "menu-tahun-ajaran" },
  { to: "/semester", label: "Semester", icon: CalendarDays, roles: ["admin"], testid: "menu-semester" },
  { to: "/periode-penilaian", label: "Periode Penilaian", icon: CalendarCheck2, roles: ["admin", "pengawas", "kepala_sekolah", "guru"], testid: "menu-periode" },
  { to: "/komponen-observasi", label: "Komponen Observasi", icon: Layers, roles: ["admin", "pengawas", "kepala_sekolah", "guru"], testid: "menu-komponen" },
  { to: "/aspek-penilaian", label: "Aspek Penilaian", icon: ListChecks, roles: ["admin"], testid: "menu-aspek" },
  { section: "Penilaian", roles: ["admin", "pengawas", "kepala_sekolah", "guru"] },
  { to: "/assignments", label: "Assignment Penilaian", icon: ClipboardList, roles: ["admin"], testid: "menu-assignments" },
  { to: "/bukti-pendukung", label: "Bukti Pendukung", icon: FolderUp, roles: ["admin"], testid: "menu-evidence-admin" },
  { to: "/evaluasi-rtl", label: "Manajemen Evaluasi & RTL", icon: ClipboardPenLine, roles: ["admin"], testid: "menu-evaluasi-rtl" },
  { to: "/assignments", label: "Penilaian Saya", icon: ClipboardCheck, roles: ["pengawas", "kepala_sekolah"], testid: "menu-penilaian-saya" },
  { to: "/penilaian-saya", label: "Penilaian Saya", icon: ClipboardCheck, roles: ["guru"], testid: "menu-penilaian-saya-guru" },
  { to: "/bukti-pendukung", label: "Bukti Pendukung Penilaian", icon: FolderUp, roles: ["guru"], testid: "menu-evidence" },
  { to: "/reports", label: "Report Penilaian", icon: FileText, roles: ["admin", "pengawas", "kepala_sekolah", "guru"], testid: "menu-reports" },
  { to: "/notifikasi", label: "Notifikasi", icon: Bell, roles: ["admin", "pengawas", "kepala_sekolah", "guru"], testid: "menu-notifikasi" },
  { to: "/usulan-aspek-observasi", label: "Usulan Aspek Observasi", icon: Lightbulb, roles: ["guru"], testid: "menu-usulan-aspek" },
  { to: "/review-usulan-aspek", label: "Review Usulan Aspek", icon: Lightbulb, roles: ["admin", "pengawas", "kepala_sekolah"], testid: "menu-review-usulan-aspek" },
  { section: "Sistem", roles: ["admin"] },
  { to: "/audit-log", label: "Audit Log", icon: History, roles: ["admin"], testid: "menu-audit-log" },
  { to: "/permissions", label: "Pengaturan Hak Akses", icon: ShieldCheck, roles: ["admin"], testid: "menu-permissions" },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    const loadUnread = async () => {
      try {
        const { data } = await api.get("/notifications/unread-count");
        if (alive) setUnread(data.count || 0);
      } catch (_) {}
    };
    loadUnread();
    const timer = setInterval(loadUnread, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [user]);

  if (!user) return null;
  const menus = MENU.filter((m) => m.roles.includes(user.role));
  const initials = (user.name || "U")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen flex bg-slate-50">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Tutup menu"
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      <aside
        className={`w-[260px] bg-emerald-950 text-emerald-50 fixed inset-y-0 left-0 z-40 flex flex-col transform transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        data-testid="sidebar"
      >
        <div className="px-6 py-6 border-b border-emerald-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <div className="font-heading font-bold text-base leading-tight">Penilaian Kinerja Guru PJOK SD KBB</div>
              <div className="text-[11px] text-emerald-300/80 leading-tight">Kabupaten Bandung Barat</div>
            </div>
            <button
              type="button"
              aria-label="Tutup menu"
              className="ml-auto rounded-md p-2 text-emerald-100 hover:bg-emerald-900 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {menus.map((m, idx) => {
            if (m.section) {
              return (
                <div key={`sec-${idx}`} className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-[0.2em] font-bold text-emerald-300/60">
                  {m.section}
                </div>
              );
            }
            return (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.to === "/"}
                data-testid={m.testid}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-emerald-800 text-white border-r-4 border-orange-500 font-semibold"
                      : "text-emerald-100/80 hover:bg-emerald-900/60 hover:text-white"
                  }`
                }
              >
                <m.icon className="w-5 h-5" strokeWidth={2} />
                <span>{m.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-emerald-900/60 text-[11px] text-emerald-300/70">
          Kab. Bandung Barat - Jenjang SD
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-screen lg:ml-[260px] min-w-0">
        {/* Topbar */}
        <header className="h-[72px] bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Buka menu"
              className="rounded-md border border-slate-200 p-2 text-slate-700 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600">Dinas Pendidikan</div>
            <div className="text-sm text-slate-500 truncate">Aplikasi Penilaian Kinerja Guru PJOK SD Kabupaten Bandung Barat</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/notifikasi")}
            className="relative rounded-full border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
            data-testid="notification-button"
            aria-label="Buka notifikasi"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 group" data-testid="profile-dropdown-trigger">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-semibold text-slate-900">{user.name}</div>
                  <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0 mt-0.5 text-[10px]">
                    {ROLE_LABELS[user.role]}
                  </Badge>
                </div>
                <Avatar className="h-10 w-10 ring-2 ring-emerald-100">
                  <AvatarFallback className="bg-emerald-700 text-white font-semibold">{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-semibold">{user.name}</div>
                <div className="text-xs text-slate-500 font-normal">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {user.role === "guru" && (
                <DropdownMenuItem onClick={() => navigate("/profil")} data-testid="dropdown-profile">
                  <User className="w-4 h-4 mr-2" /> Profil Saya
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={logout} data-testid="logout-button" className="text-red-600 focus:text-red-700">
                <LogOut className="w-4 h-4 mr-2" /> Keluar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 min-w-0" data-testid="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
