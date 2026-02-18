import { ImageResponse } from "next/og";
import { fetchDocumentEdge } from "@/lib/firestoreEdge";
import { extractListingId } from "@/lib/listingUrl";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

type ListingDoc = {
  title?: string;
  price?: number;
  categoryName?: string;
  subCategoryName?: string;
};

const clamp = (value: string, max = 72) => {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
};

const formatPriceTRY = (v?: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n} ₺`;
  }
};

export default async function OpenGraphImage({
  params,
}: {
  params: { id: string };
}) {
  const listingId = extractListingId(params.id || "");
  const listing = await fetchDocumentEdge<ListingDoc>("listings", listingId);

  const title = clamp(listing?.title || "İlan", 70);
  const categoryLine = [listing?.categoryName, listing?.subCategoryName]
    .filter(Boolean)
    .join(" / ");
  const price = formatPriceTRY(listing?.price);

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
            {title || "İlan"}
          </div>
          {categoryLine ? (
            <div style={{ fontSize: 28, color: "#6f4f32" }}>{categoryLine}</div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 24,
          }}
        >
          <div style={{ fontSize: 22, color: "#8a6b52" }}>
            Güvenli alışveriş · Hızlı iletişim
          </div>
          {price ? (
            <div
              style={{
                padding: "10px 18px",
                borderRadius: 9999,
                background: "#3f2a1a",
                color: "#fff",
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              {price}
            </div>
          ) : null}
        </div>
      </div>
    ),
    size
  );
}
