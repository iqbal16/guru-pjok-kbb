import { useEffect, useRef, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PenLine, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";

export default function DigitalSignatureSection({ data, setData, canSign }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [saving, setSaving] = useState(false);
  const assignment = data?.assignment || {};
  const signatures = data?.signatures || [];
  const mine = signatures.find((s) => s.user_id === user?.id);
  const locked = assignment.status === "Final";
  const canEdit = canSign && !locked;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canEdit) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, [canEdit]);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const start = (e) => {
    if (!canEdit) return;
    drawing.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing.current || !canEdit) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const saveImage = async (image) => {
    setSaving(true);
    try {
      const { data: signature } = await api.post(`/assignments/${assignment.id}/digital-signature`, { signature_image: image });
      const nextSigs = [...signatures.filter((s) => s.user_id !== signature.user_id), signature];
      setData({ ...data, signatures: nextSigs });
      toast.success("Tanda tangan digital tersimpan");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail) || "Gagal menyimpan tanda tangan");
    } finally {
      setSaving(false);
    }
  };

  const saveCanvas = () => saveImage(canvasRef.current.toDataURL("image/png"));

  const upload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => saveImage(reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <Card className="p-5" data-testid="digital-signature-section">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="font-heading text-xl font-semibold text-slate-900">Tanda Tangan Digital</h2>
          <p className="text-sm text-slate-500 mt-1">Tanda tangan internal aplikasi untuk report penilaian.</p>
        </div>
        <Badge className={mine ? "bg-emerald-100 text-emerald-700 border-0" : "bg-slate-100 text-slate-700 border-0"}>
          {mine ? "Sudah Ditandatangani" : "Belum Ditandatangani"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {signatures.map((s) => (
          <div key={s.id} className="rounded-lg border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-900">{s.signer_name}</div>
            <div className="text-xs text-slate-500 capitalize">{s.signer_role}</div>
            {s.signature_image && <img src={s.signature_image} alt="Tanda tangan" className="h-24 object-contain my-3 border rounded bg-white w-full" />}
            <div className="text-xs text-slate-500">{s.signed_at ? new Date(s.signed_at).toLocaleString("id-ID") : "-"}</div>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-4">
          <Label>{mine ? "Ubah Tanda Tangan" : "Tambah Tanda Tangan"}</Label>
          <canvas
            ref={canvasRef}
            width={520}
            height={160}
            className="mt-2 w-full max-w-xl h-40 bg-white border rounded cursor-crosshair touch-none"
            onMouseDown={start}
            onMouseMove={move}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={move}
            onTouchEnd={end}
          />
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button onClick={saveCanvas} disabled={saving} className="bg-emerald-700 hover:bg-emerald-800">
              <PenLine className="w-4 h-4 mr-2" /> Simpan Tanda Tangan
            </Button>
            <Button type="button" variant="outline" onClick={clear}>
              <RotateCcw className="w-4 h-4 mr-2" /> Bersihkan
            </Button>
            <label className="inline-flex items-center px-3 py-2 rounded-md border text-sm cursor-pointer hover:bg-slate-50">
              <Upload className="w-4 h-4 mr-2" /> Upload Gambar
              <Input type="file" accept="image/*" className="hidden" onChange={upload} />
            </label>
          </div>
        </div>
      )}
    </Card>
  );
}
