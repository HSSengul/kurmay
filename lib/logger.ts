const isDev = process.env.NODE_ENV !== "production";

export function devLog(...args: any[]) {
  if (isDev) console.log(...args);
}

export function devWarn(...args: any[]) {
  if (isDev) console.warn(...args);
}

export function devError(...args: any[]) {
  if (isDev) console.error(...args);
}

type FriendlyFallback = string;

export function getFriendlyErrorMessage(
  err: any,
  fallback: FriendlyFallback = "Bir hata oluştu. Lütfen tekrar deneyin."
) {
  const code =
    typeof err?.code === "string"
      ? err.code.toLowerCase()
      : typeof err?.name === "string"
      ? err.name.toLowerCase()
      : "";

  if (code.includes("permission-denied")) return "Bu işlem için yetkin yok.";
  if (code.includes("unauthenticated")) return "Lütfen giriş yapın.";
  if (code.includes("not-found")) return "Kayıt bulunamadı.";
  if (code.includes("unavailable")) return "Servise ulaşılamıyor. Tekrar dene.";
  if (code.includes("resource-exhausted"))
    return "Çok fazla istek yapıldı. Biraz sonra dene.";
  if (code.includes("failed-precondition"))
    return "İşlem şu anda yapılamıyor.";
  if (code.includes("already-exists")) return "Bu kayıt zaten var.";
  if (code.includes("deadline-exceeded")) return "İşlem zaman aşımına uğradı.";
  if (code.includes("cancelled")) return "İşlem iptal edildi.";
  if (code.includes("auth/")) return "Giriş işlemi başarısız oldu.";

  return fallback;
}
