"use client";

import Link from "next/link";

export default function AdminUsersPage() {
  return (
    <div className="border rounded-2xl bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">Admin</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">Kullanıcı Yönetimi</div>
          <div className="mt-1 text-sm text-gray-600">
            Arama + filtre + ban/unban + admin note + risk tag (TODO list’teki gibi).
          </div>
        </div>

        <Link
          href="/admin"
          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
        >
          Dashboard
        </Link>
      </div>

      <div className="mt-4 border rounded-2xl bg-gray-50 p-5 text-gray-700">
        <div className="font-semibold text-gray-900">Yakında</div>
        <div className="mt-1 text-sm">
          Buraya: kullanıcı listesi, UID/email arama, ban/unban, internal note, tüm ilanları pasife çek
          gibi aksiyonlar gelecek.
        </div>
      </div>
    </div>
  );
}
