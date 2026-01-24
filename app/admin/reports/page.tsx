"use client";

export default function AdminReportsPage() {
  return (
    <div className="border rounded-2xl bg-white p-6">
      <div className="text-xs text-gray-500">Admin</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">Rapor Merkezi</div>
      <div className="mt-2 text-gray-600">
        Open / investigating / resolved raporlar + hedefe git + admin aksiyonları (TODO list).
      </div>

      <div className="mt-4 border rounded-2xl bg-gray-50 p-5 text-gray-700">
        Buraya: rapor listesi, filtreler ve resolved akışı geliyor.
      </div>
    </div>
  );
}
