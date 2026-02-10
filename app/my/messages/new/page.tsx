// app/my/messages/new/page.tsx
import { Suspense } from "react";
import NewConversationClient from "./NewConversationClient";

export const dynamic = "force-dynamic";

function LoadingFallback() {
  return (
    <div className="min-h-[60vh] px-4 py-12 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-[#ead8c5] bg-white/90 p-6 text-center shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
        <div className="text-lg font-semibold text-[#3f2a1a]">
          Sohbet hazırlanıyor...
        </div>
        <div className="mt-2 text-sm text-[#6b4b33]">
          Lütfen bekle, mesaj sayfasına yönlendiriliyorsun.
        </div>
      </div>
    </div>
  );
}

export default function NewConversationPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <NewConversationClient />
    </Suspense>
  );
}
