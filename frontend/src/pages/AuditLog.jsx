import { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, History, Search } from "lucide-react";
import { toast } from "sonner";

const EMPTY_FILTER = { date_from: "", date_to: "", user_id: "semua", role: "semua", action: "semua", module: "semua", search: "" };

export default function AuditLog() {
  const [items, setItems] = useState([]);
  const [options, setOptions] = useState({ users: [], roles: [], actions: [], modules: [] });
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  const params = useMemo(() => Object.fromEntries(Object.entries(filter).filter(([, v]) => v && v !== "semua")), [filter]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [logs, opts] = await Promise.all([api.get("/audit-logs", { params }), api.get("/audit-logs/options")]);
      setItems(Array.isArray(logs.data) ? logs.data : (logs.data?.logs || []));
      setOptions(opts.data);
    } catch (e) {
      const message = formatApiErrorDetail(e?.response?.data?.detail) || "Gagal memuat audit log";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6" data-testid="audit-log-page">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 mb-1">Sistem</div>
        <h1 className="font-heading text-3xl font-bold text-slate-900">Audit Log</h1>
        <p className="text-slate-600 mt-1">Riwayat aktivitas pengguna dan perubahan data aplikasi.</p>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-3">
          <Input type="date" value={filter.date_from} onChange={(e) => setFilter({ ...filter, date_from: e.target.value })} />
          <Input type="date" value={filter.date_to} onChange={(e) => setFilter({ ...filter, date_to: e.target.value })} />
          <Select value={filter.user_id} onValueChange={(v) => setFilter({ ...filter, user_id: v })}>
            <SelectTrigger><SelectValue placeholder="User" /></SelectTrigger>
            <SelectContent><SelectItem value="semua">Semua User</SelectItem>{options.users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filter.role} onValueChange={(v) => setFilter({ ...filter, role: v })}>
            <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent><SelectItem value="semua">Semua Role</SelectItem>{options.roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filter.action} onValueChange={(v) => setFilter({ ...filter, action: v })}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent><SelectItem value="semua">Semua Action</SelectItem>{options.actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filter.module} onValueChange={(v) => setFilter({ ...filter, module: v })}>
            <SelectTrigger><SelectValue placeholder="Modul" /></SelectTrigger>
            <SelectContent><SelectItem value="semua">Semua Modul</SelectItem>{options.modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="Cari..." value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
            </div>
            <Button onClick={load} className="bg-emerald-700 hover:bg-emerald-800">Filter</Button>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden" data-testid="audit-log-table">
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Memuat audit log...</div> : error ? (
          <div className="p-10 text-center text-sm text-red-600">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center" data-testid="audit-log-empty">
            <History className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <div className="font-medium text-slate-700">Belum ada aktivitas audit log.</div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Modul</TableHead>
                <TableHead>Record</TableHead>
                <TableHead className="text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap">{log.created_at ? new Date(log.created_at).toLocaleString("id-ID") : "-"}</TableCell>
                  <TableCell>{log.user_name}</TableCell>
                  <TableCell><Badge variant="outline">{log.user_role}</Badge></TableCell>
                  <TableCell><Badge className="bg-slate-100 text-slate-700 border-0">{log.action}</Badge></TableCell>
                  <TableCell>{log.table_name}</TableCell>
                  <TableCell className="font-mono text-xs">{log.record_id || "-"}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setDetail(log)}><Eye className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Detail Audit Log</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Info label="Waktu" value={detail.created_at ? new Date(detail.created_at).toLocaleString("id-ID") : "-"} />
                <Info label="User" value={`${detail.user_name} (${detail.user_role})`} />
                <Info label="Action" value={detail.action} />
                <Info label="Modul" value={detail.table_name} />
                <Info label="Record ID" value={detail.record_id || "-"} />
              </div>
              <JsonBlock title="Old Value" value={detail.old_value} />
              <JsonBlock title="New Value" value={detail.new_value} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }) {
  return <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="font-medium text-slate-900">{value}</div></div>;
}

function JsonBlock({ title, value }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{title}</div>
      <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(value || {}, null, 2)}</pre>
    </div>
  );
}
