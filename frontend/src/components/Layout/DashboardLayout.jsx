import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABELS } from "@/context/AuthContext";
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
  ClipboardList,
  ClipboardCheck,
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
  { to: "/assignments", label: "Penilaian Saya", icon: ClipboardCheck, roles: ["pengawas", "kepala_sekolah"], testid: "menu-penilaian-saya" },
  { to: "/penilaian-saya", label: "Penilaian Saya", icon: ClipboardCheck, roles: ["guru"], testid: "menu-penilaian-saya-guru" },
  { section: "Sistem", roles: ["admin"] },
  { to: "/permissions", label: "Pengaturan Hak Akses", icon: ShieldCheck, roles: ["admin"], testid: "menu-permissions" },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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
      {/* Sidebar */}
      <aside className="w-[260px] bg-emerald-950 text-emerald-50 fixed inset-y-0 left-0 flex flex-col" data-testid="sidebar">
        <div className="px-6 py-6 border-b border-emerald-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <div className="font-heading font-bold text-base leading-tight">PJOK KBB</div>
              <div className="text-[11px] text-emerald-300/80 leading-tight">Penilaian Kinerja Guru</div>
            </div>
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
          Kab. Bandung Barat • Jenjang SD
        </div>
      </aside>

      {/* Main */}
      <div className="ml-[260px] flex-1 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="h-[72px] bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-20">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600">Dinas Pendidikan</div>
            <div className="text-sm text-slate-500">Sistem Penilaian Kinerja Guru PJOK SD</div>
          </div>
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
        </header>

        <main className="flex-1 p-6 md:p-8" data-testid="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
