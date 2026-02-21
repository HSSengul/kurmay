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
  parentId?: string | null;
  enabled?: boolean;
};

type SubCategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
  parentId?: string | null;
  enabled?: boolean;
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

const matchesDocKey = (
  normalizedKey: string,
  slugKey: string,
  doc: { id?: string; slug?: string; nameLower?: string; name?: string }
) => {
  const normKeys = [doc.id, doc.slug, doc.nameLower, doc.name].map((x) =>
    normTRAscii(String(x || ""))
  );
  const slugKeys = [doc.slug, doc.nameLower, doc.name].map((x) =>
    slugifyTR(String(x || ""))
  );
  return normKeys.includes(normalizedKey) || slugKeys.includes(slugKey);
};

const clamp = (value: string, max = 72) => {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
};

export default async function OpenGraphImage({
  params,
}: {
  params: { category: string; subCategory: string };
}) {
  const rawCategory = params.category ? decodeURIComponent(params.category) : "";
  const rawSubCategory = params.subCategory
    ? decodeURIComponent(params.subCategory)
    : "";

  const categoriesAll = await listCollectionEdge<CategoryDoc>("categories");
  const categories = categoriesAll.filter((c) => !c.parentId && c.enabled !== false);
  const subCategories = categoriesAll
    .filter((c) => !!c.parentId && c.enabled !== false)
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameLower: c.nameLower,
      slug: c.slug,
      parentId: c.parentId || undefined,
      enabled: c.enabled,
    })) as SubCategoryDoc[];
  const key = normTRAscii(rawCategory);
  const categorySlugKey = slugifyTR(rawCategory);
  const matchCategory = categories.find((c) =>
    matchesDocKey(key, categorySlugKey, c)
  );

  const subKey = normTRAscii(rawSubCategory);
  const subSlugKey = slugifyTR(rawSubCategory);
  const matchSub = subCategories.find((s) => {
    if (s.parentId !== matchCategory?.id) return false;
    return matchesDocKey(subKey, subSlugKey, s);
  });

  const categoryTitle = clamp(matchCategory?.name || rawCategory || "Kategori");
  const subTitle = clamp(matchSub?.name || rawSubCategory || "Alt kategori");
  const canonicalCategorySlug = matchCategory
    ? slugifyTR(matchCategory.slug || matchCategory.nameLower || matchCategory.name)
    : rawCategory;
  const canonicalSubSlug = matchSub
    ? slugifyTR(matchSub.slug || matchSub.nameLower || matchSub.name)
    : rawSubCategory;

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
            {subTitle || "Alt kategori"}
          </div>
          <div style={{ fontSize: 28, color: "#6f4f32" }}>
            {categoryTitle ? `${categoryTitle} / ${subTitle}` : subTitle}
          </div>
        </div>
        <div style={{ fontSize: 22, color: "#8a6b52" }}>
          {canonicalCategorySlug && canonicalSubSlug
            ? `${canonicalCategorySlug}/${canonicalSubSlug}`
            : "Uygun fiyatlar · Hızlı iletişim · Güvenli alışveriş"}
        </div>
      </div>
    ),
    size
  );
}
