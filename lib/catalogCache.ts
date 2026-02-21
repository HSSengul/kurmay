import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

type CacheEntry<T> = {
  data: T;
  ts: number;
};

const TTL_MS = 5 * 60 * 1000;
const CATEGORY_CACHE_KEY = "kf_categories_v1";
const SUBCATEGORY_CACHE_KEY = "kf_subcategories_v1";

let categoriesCache: CacheEntry<any[]> | null = null;
let subCategoriesCache: CacheEntry<any[]> | null = null;

const isFresh = (entry?: CacheEntry<any> | null) =>
  !!entry && Date.now() - entry.ts < TTL_MS;

function readSession<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed?.data || !parsed?.ts) return null;
    if (!isFresh(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, entry: CacheEntry<T>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // ignore storage failures
  }
}

export function clearCatalogCache() {
  categoriesCache = null;
  subCategoriesCache = null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(CATEGORY_CACHE_KEY);
      window.sessionStorage.removeItem(SUBCATEGORY_CACHE_KEY);
    } catch {
      // ignore
    }
  }
}

export async function getCategoriesCached(opts?: { force?: boolean }) {
  if (!opts?.force && isFresh(categoriesCache)) {
    return categoriesCache!.data;
  }

  if (!opts?.force) {
    const session = readSession<any[]>(CATEGORY_CACHE_KEY);
    if (session) {
      categoriesCache = session;
      return session.data;
    }
  }

  const snap = await getDocs(collection(db, "categories"));
  const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const entry: CacheEntry<any[]> = { data, ts: Date.now() };
  categoriesCache = entry;
  writeSession(CATEGORY_CACHE_KEY, entry);
  return data;
}

export async function getSubCategoriesCached(opts?: { force?: boolean }) {
  if (!opts?.force && isFresh(subCategoriesCache)) {
    return subCategoriesCache!.data;
  }

  if (!opts?.force) {
    const session = readSession<any[]>(SUBCATEGORY_CACHE_KEY);
    if (session) {
      subCategoriesCache = session;
      return session.data;
    }
  }

  // Tek kaynak: categories koleksiyonundaki parentId alanı.
  // Legacy subCategories koleksiyonunu artık okumuyoruz.
  const categories = await getCategoriesCached(opts);
  const data = (categories || [])
    .filter((d: any) => d?.parentId)
    .map((d: any) => ({
      id: d.id,
      ...(d as any),
      categoryId: d.categoryId || d.parentId,
    }));
  const entry: CacheEntry<any[]> = { data, ts: Date.now() };
  subCategoriesCache = entry;
  writeSession(SUBCATEGORY_CACHE_KEY, entry);
  return data;
}
