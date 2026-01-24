"use client";

export default function AdminLogsPage() {
  return (
    <div className="border rounded-2xl bg-white p-6">
      <div className="text-xs text-gray-500">Admin</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">Admin Loglar</div>
      <div className="mt-2 text-gray-600">
        Kim ne yaptı ne zaman? Denetlenebilirlik (TODO list).
      </div>

      <div className="mt-4 border rounded-2xl bg-gray-50 p-5 text-gray-700">
        Buraya: adminLogs collection viewer + filtre + kritik aksiyon onay popup ekleyeceğiz.
      </div>
    </div>
  );
}
