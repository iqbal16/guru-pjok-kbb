import { AlertCircle } from "lucide-react";

export default function FormErrorSummary({ errors = [], title = "Periksa kembali data berikut:" }) {
  const visibleErrors = errors.filter(Boolean);
  if (!visibleErrors.length) return null;

  const scrollToField = (field) => {
    if (!field) return;
    document.getElementById(field)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
      <div className="mb-2 flex items-start gap-2 font-semibold">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
        <span>{title}</span>
      </div>
      <div className="space-y-1">
        {visibleErrors.map((error, index) => (
          <button
            key={`${error.field || "error"}-${index}`}
            type="button"
            onClick={() => scrollToField(error.field)}
            className="block w-full rounded-md px-2 py-1 text-left hover:bg-red-100"
          >
            {error.message}
          </button>
        ))}
      </div>
    </div>
  );
}
