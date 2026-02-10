"use client";

export default function AdminLogsPage() {
  return (
    <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-6 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
        Admin
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900">
        Admin Loglar
      </div>
      <div className="mt-2 text-slate-600">
        Kim ne yaptı ne zaman? Denetlenebilirlik (TODO list).
      </div>

      <div className="mt-4 border border-slate-200/80 rounded-2xl bg-slate-50 p-5 text-slate-700">
        Buraya: adminLogs collection viewer + filtre + kritik aksiyon onay popup ekleyeceğiz.
      </div>
    </div>
  );
}
