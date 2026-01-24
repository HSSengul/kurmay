"use client";

export default function AdminListingsPage() {
  return (
    <div className="border rounded-2xl bg-white p-6">
      <div className="text-xs text-gray-500">Admin</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">İlan Moderasyonu</div>
      <div className="mt-2 text-gray-600">
        Disable/Enable, şüpheli filtreleri, rapor geçmişi ve satıcı linki (TODO list).
      </div>

      <div className="mt-4 border rounded-2xl bg-gray-50 p-5 text-gray-700">
        Buraya: ilan liste + detay + foto gallery + soft disable + review state ekleyeceğiz.
      </div>
    </div>
  );
}
