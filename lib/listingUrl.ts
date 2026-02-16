export function slugifyTR(input: string) {
  return (input || "")
    .toLocaleLowerCase("tr-TR")
    .trim()
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replaceAll("İ", "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildListingSlug(title: string | undefined, id: string) {
  const slug = slugifyTR(title || "");
  if (!slug) return id;
  return `${slug}-${id}`;
}

export function buildListingPath(id: string, title?: string) {
  return `/ilan/${buildListingSlug(title, id)}`;
}

export function extractListingId(slugOrId: string) {
  const raw = decodeURIComponent(slugOrId || "").trim();
  if (!raw) return "";
  const lastDash = raw.lastIndexOf("-");
  if (lastDash > 0 && lastDash < raw.length - 1) {
    const suffix = raw.slice(lastDash + 1);
    if (suffix.length >= 6) return suffix;
  }
  return raw;
}
