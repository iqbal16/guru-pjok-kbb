import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Download, Eye, FileText, Trash2, Video } from "lucide-react";
import { toast } from "sonner";

export function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export default function EvidenceFileList({ files = [], canDelete = false, onDelete, emptyText = "Belum ada file bukti pendukung." }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const openBlob = async (file, disposition = "inline") => {
    try {
      const response = await api.get(`/evidence/files/${file.id}/download?disposition=${disposition}`, { responseType: "blob" });
      const blob = new Blob([response.data], { type: file.mime_type || response.data.type });
      const url = URL.createObjectURL(blob);
      if (disposition === "attachment") {
        const link = document.createElement("a");
        link.href = url;
        link.download = file.original_filename || "bukti-pendukung";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        return;
      }
      if (file.file_category === "video") {
        if (preview?.url) URL.revokeObjectURL(preview.url);
        setPreview({ ...file, url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Gagal membuka file bukti pendukung");
    }
  };

  if (!files.length) {
    return <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">{emptyText}</div>;
  }

  return (
    <div className="space-y-3">
      {files.map((file) => {
        const isVideo = file.file_category === "video";
        const Icon = isVideo ? Video : FileText;
        return (
          <Card key={file.id} className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${isVideo ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900" title={file.original_filename}>{file.original_filename}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge variant="outline">{isVideo ? "Video" : "Dokumen"}</Badge>
                    <span>{(file.extension || "").toUpperCase()}</span>
                    <span>{formatBytes(file.size_bytes)}</span>
                    <span>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleString("id-ID") : "-"}</span>
                    {file.status === "locked" && <Badge className="border-0 bg-slate-100 text-slate-700">Terkunci</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => openBlob(file, "inline")}>
                  <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => openBlob(file, "attachment")}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Download
                </Button>
                {canDelete && (
                  <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => onDelete?.(file)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Hapus
                  </Button>
                )}
              </div>
            </div>
            {preview?.id === file.id && (
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
                <video src={preview.url} controls className="h-auto w-full max-h-[420px]" />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
