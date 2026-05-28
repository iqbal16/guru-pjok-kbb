import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { formatApiErrorDetail } from "@/lib/api";
import { toast } from "sonner";
import { Trophy, Loader2, ShieldCheck } from "lucide-react";

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);

  if (user) {
    return null;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success("Berhasil masuk. Selamat datang!");
      navigate("/", { replace: true });
    } catch (e) {
      const msg = formatApiErrorDetail(e?.response?.data?.detail) || "Gagal masuk";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-slate-50">
      {/* Left form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-xl bg-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-700/20">
              <Trophy className="w-6 h-6 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <div className="font-heading text-xl font-bold text-slate-900 leading-tight">PJOK KBB</div>
              <div className="text-xs text-slate-500">Kabupaten Bandung Barat</div>
            </div>
          </div>

          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-3">
              Portal Penilaian Kinerja
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-3">
              Selamat datang.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed">
              Masuk untuk mengelola penilaian kinerja Guru PJOK di Kabupaten Bandung Barat.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" data-testid="login-form">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@pjok-kbb.id"
                required
                autoComplete="email"
                className="h-11 focus-visible:ring-emerald-500"
                data-testid="login-email-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 font-medium">Kata Sandi</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="h-11 focus-visible:ring-emerald-500"
                data-testid="login-password-input"
              />
            </div>

            {err && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="login-error">
                {err}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
              data-testid="login-submit-button"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {submitting ? "Memproses..." : "Masuk"}
            </Button>
          </form>

          <Card className="mt-8 p-4 bg-emerald-50/60 border-emerald-200 text-xs text-emerald-900 space-y-1">
            <div className="font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Akun Uji Coba
            </div>
            <div>Admin: <span className="font-mono">admin@pjok-kbb.id</span> / <span className="font-mono">Admin@123</span></div>
            <div>Pengawas: <span className="font-mono">pengawas@pjok-kbb.id</span> / <span className="font-mono">Pengawas@123</span></div>
            <div>Kepala Sekolah: <span className="font-mono">kepsek@pjok-kbb.id</span> / <span className="font-mono">Kepsek@123</span></div>
            <div>Guru: <span className="font-mono">guru1@pjok-kbb.id</span> / <span className="font-mono">Guru@123</span></div>
          </Card>
        </div>
      </div>

      {/* Right banner */}
      <div className="hidden lg:flex relative bg-emerald-900 overflow-hidden">
        <div
          className="absolute inset-0 opacity-90"
          style={{
            backgroundImage:
              "url('https://static.prod-images.emergentagent.com/jobs/48dbf92f-611d-4c06-bc9d-46b42ac8c8a3/images/63322c1b7ed596b392d9cb4284cd7e53ec4f698a643f6dd84db2c67b0a0b80f0.png')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/80 via-emerald-900/60 to-orange-900/40" />
        <div className="relative z-10 flex flex-col justify-end p-12 text-white">
          <div className="text-xs uppercase tracking-[0.25em] font-bold text-orange-300 mb-3">
            Dinas Pendidikan • KBB
          </div>
          <h2 className="font-heading text-4xl font-bold leading-tight mb-4">
            Mendorong mutu pendidikan jasmani di setiap SD se-Kabupaten Bandung Barat.
          </h2>
          <p className="text-emerald-100/90 max-w-md">
            Satu platform untuk pengawas, kepala sekolah, dan guru — terhubung, terstandar, dan transparan.
          </p>
        </div>
      </div>
    </div>
  );
}
