import type { MetadataRoute } from "next";
import { buildListingPath, slugifyTR } from "@/lib/listingUrl";
import { listCollection, normTRAscii } from "@/lib/firestoreRest";

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

type ListingDoc = {
  id: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
  status?: string;
};

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000";

const safeSlug = (name?: string, slug?: string, nameLower?: string) => {
  if (slug) return slugifyTR(slug);
  if (nameLower) return slugifyTR(nameLower);
  if (name) return slugifyTR(name);
  return "";
};

const toIso = (v?: string) => {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const items: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: new Date() },
  ];
  const seen = new Set<string>([siteUrl]);

  const pushUrl = (url: string, lastModified?: string | Date) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push({ url, lastModified });
  };

  const categoriesAll = await listCollection<CategoryDoc>("categories");
  const categories = categoriesAll.filter((c) => !c.parentId && c.enabled !== false);
  const subCategories = categoriesAll
    .filter((c) => !!c.parentId && c.enabled !== false)
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameLower: c.nameLower,
      slug: c.slug,
      parentId: c.parentId,
      enabled: c.enabled,
    })) as SubCategoryDoc[];
  const listings = await listCollection<ListingDoc>("listings", 500, 10);

  const categoryMap = new Map<string, CategoryDoc>();
  categories.forEach((c) => categoryMap.set(c.id, c));

  for (const c of categories) {
    if (c.parentId) continue;
    const slug = safeSlug(c.name, c.slug, c.nameLower || normTRAscii(c.name));
    if (!slug) continue;
    pushUrl(`${siteUrl}/${encodeURIComponent(slug)}`, new Date());
  }

  for (const s of subCategories) {
    const parentId = s.parentId || "";
    const parent = categoryMap.get(parentId || "");
    if (!parent) continue;
    const catSlug = safeSlug(
      parent.name,
      parent.slug,
      parent.nameLower || normTRAscii(parent.name)
    );
    const subSlug = safeSlug(
      s.name,
      s.slug,
      s.nameLower || normTRAscii(s.name)
    );
    if (!catSlug || !subSlug) continue;
    pushUrl(
      `${siteUrl}/${encodeURIComponent(catSlug)}/${encodeURIComponent(subSlug)}`,
      new Date()
    );
  }

  const activeListings = listings.filter(
    (l) => !l.status || l.status === "active"
  );

  for (const l of activeListings) {
    if (!l.id) continue;
    const url = `${siteUrl}${buildListingPath(l.id, l.title)}`;
    pushUrl(url, toIso(l.updatedAt) || toIso(l.createdAt) || undefined);
  }

  return items;
}
