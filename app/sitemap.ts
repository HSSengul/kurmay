import type { MetadataRoute } from "next";
import { buildListingPath, slugifyTR } from "@/lib/listingUrl";
import { listCollection, normTRAscii } from "@/lib/firestoreRest";

type CategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
  parentId?: string | null;
};

type SubCategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
  parentId?: string | null;
  categoryId?: string | null;
};

type ListingDoc = {
  id: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
};

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

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

  const categories = await listCollection<CategoryDoc>("categories");
  const subCategories = await listCollection<SubCategoryDoc>("subCategories");
  const listings = await listCollection<ListingDoc>("listings", 500, 10);

  const categoryMap = new Map<string, CategoryDoc>();
  categories.forEach((c) => categoryMap.set(c.id, c));

  for (const c of categories) {
    if (c.parentId) continue;
    const slug = safeSlug(c.name, c.slug, c.nameLower || normTRAscii(c.name));
    if (!slug) continue;
    items.push({
      url: `${siteUrl}/${encodeURIComponent(slug)}`,
      lastModified: new Date(),
    });
  }

  for (const s of subCategories) {
    const parentId = s.categoryId || s.parentId || "";
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
    items.push({
      url: `${siteUrl}/${encodeURIComponent(catSlug)}/${encodeURIComponent(
        subSlug
      )}`,
      lastModified: new Date(),
    });
  }

  for (const l of listings) {
    if (!l.id) continue;
    items.push({
      url: `${siteUrl}${buildListingPath(l.id, l.title)}`,
      lastModified: toIso(l.updatedAt) || toIso(l.createdAt) || undefined,
    });
  }

  return items;
}
