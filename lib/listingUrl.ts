export function slugifyTR(input: string) {
  const lowered = (input || "").toLocaleLowerCase("tr-TR").trim();
  if (!lowered) return "";

  return lowered
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
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
