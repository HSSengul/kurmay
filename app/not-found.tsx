import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center bg-[#fffaf3] px-4">
      <div className="w-full max-w-lg rounded-3xl border border-[#ead8c5] bg-white/90 p-8 text-center shadow-[0_20px_60px_-40px_rgba(15,23,42,0.35)]">
        <div className="text-sm uppercase tracking-[0.2em] text-[#a9825e]">
          404
        </div>
        <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-[#3f2a1a]">
          Sayfa bulunamadı
        </h1>
        <p className="mt-3 text-sm text-[#6b4b33]">
          Aradığın sayfa kaldırılmış, taşınmış ya da hiç var olmamış olabilir.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-[#1f2a24] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#2b3b32]"
          >
            Ana sayfaya dön
          </Link>
        </div>
      </div>
    </div>
  );
}
