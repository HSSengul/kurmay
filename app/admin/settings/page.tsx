"use client";

export default function AdminSettingsPage() {
  return (
    <div className="border rounded-2xl bg-white p-6">
      <div className="text-xs text-gray-500">Admin</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">Ayarlar</div>
      <div className="mt-2 text-gray-600">
        Feature flags, yasaklı kelime listesi, rate limits, yeni kullanıcı limitleri (TODO list).
      </div>

      <div className="mt-4 border rounded-2xl bg-gray-50 p-5 text-gray-700">
        Buraya: settings/global dokümanı üzerinden toggle’lar ve policy ekranları gelecek.
      </div>
    </div>
  );
}
