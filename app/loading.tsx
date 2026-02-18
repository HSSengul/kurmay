export default function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center bg-[#fffaf3] px-4">
      <div className="w-full max-w-md rounded-3xl border border-[#ead8c5] bg-white/90 p-6 text-center shadow-[0_20px_60px_-40px_rgba(15,23,42,0.35)]">
        <div className="mx-auto h-12 w-12 rounded-full border-4 border-[#ead8c5] border-t-[#caa07a] animate-spin" />
        <div className="mt-4 text-sm font-semibold text-[#3f2a1a]">Yükleniyor…</div>
        <div className="mt-1 text-xs text-[#6b4b33]">Birkaç saniye sürebilir.</div>
      </div>
    </div>
  );
}
