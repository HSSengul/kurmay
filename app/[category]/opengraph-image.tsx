import { ImageResponse } from "next/og";
import { listCollectionEdge } from "@/lib/firestoreEdge";
import { slugifyTR } from "@/lib/listingUrl";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

type CategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
};

const normTRAscii = (input: string) => {
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
    .replace(/[\/]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const clamp = (value: string, max = 70) => {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
};

export default async function OpenGraphImage({
  params,
}: {
  params: { category: string };
}) {
  const rawSlug = params.category ? decodeURIComponent(params.category) : "";
  const categories = await listCollectionEdge<CategoryDoc>("categories");
  const key = normTRAscii(rawSlug);
  const match = categories.find((c) => {
    const keys = [c.id, c.slug, c.nameLower, c.name].map((x) =>
      normTRAscii(String(x || ""))
    );
    return keys.includes(key);
  });

  const title = clamp(match?.name || rawSlug || "Kategori", 70);
  const canonicalSlug = match
    ? slugifyTR(match.slug || match.nameLower || match.name)
    : rawSlug;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #fff7ed 0%, #f6efe5 45%, #efe0d0 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          color: "#3f2a1a",
          fontFamily: "Arial, sans-serif",
          padding: "64px 72px",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -140,
            top: -100,
            width: 380,
            height: 380,
            borderRadius: 9999,
            background: "rgba(217, 162, 108, 0.18)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 60,
            bottom: -140,
            width: 320,
            height: 320,
            borderRadius: 9999,
            background: "rgba(111, 79, 50, 0.12)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 9999,
              background: "#d28b50",
            }}
          />
          <div style={{ fontSize: 28, fontWeight: 700 }}>İlanSitesi</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>
            {title || "Kategori"}
          </div>
          <div style={{ fontSize: 28, color: "#6f4f32" }}>
            {canonicalSlug ? `Kategori: ${canonicalSlug}` : "Kategori ilanları"}
          </div>
        </div>
        <div style={{ fontSize: 22, color: "#8a6b52" }}>
          Uygun fiyatlar · Hızlı iletişim · Güvenli alışveriş
        </div>
      </div>
    ),
    size
  );
}
