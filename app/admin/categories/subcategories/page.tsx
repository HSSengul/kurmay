"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  limit,
  writeBatch,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

import {
  ToastView,
  useToast,
  SkeletonCard,
  Field,
  cx,
  safeString,
  normalizeTextTR,
  formatDateTR,
  clampInt,
  copyToClipboard,
} from "@/app/components/admin/ui";

/* =========================
   TYPES
========================= */

type Category = {
  id: string;
  name: string;
  nameLower: string;
  createdAt?: any;
  updatedAt?: any;
};

// Bu projede "subCategories" = alt kategori gibi kullanacağız
type SubCategoryDoc = {
  id: string;
  name: string;
  nameLower: string;
  categoryId: string;
  description?: string;
  createdAt?: any;
  updatedAt?: any;
};

/* =========================
   PRESETS (DEFAULT CATEGORIES)
========================= */

const DEFAULT_CATEGORIES: string[] = [
  "Kutu Oyunları",
  "Konsollar",
  "El Konsolları",
  "Konsol Oyunları",
  "Konsol & PC Ekipmanları",
  "Figürler",
  "TCG",
  "Manga / Çizgi Roman",
  "LEGO / Hobi",
  "Dekor / Poster",
  "Teknoloji",
  "Diğer",
];

/* =========================
   DEFAULT SUBCATEGORIES
   - Key: category nameLower (normalizeTextTR lower)
   - Value: subcategory names
========================= */

// normalizeTextTR kullandığın için KEY'leri güvenli üretelim
const KEY = (categoryName: string) => normalizeTextTR(categoryName).lower;

const DEFAULT_SUBCATEGORIES: Record<string, string[]> = {
  [KEY("Kutu Oyunları")]: [
    "Kutu Oyunları (Genel)",
    "Kart Oyunları",
    "Parti Oyunları",
    "Strateji / Eurogame",
    "Tematik",
    "Wargame",
    "Kooperatif",
    "Aile",
    "Çocuk",
    "Dedektif / Escape Room",
    "Rol Yapma (RPG / D&D)",
    "Miniature Games",
    "Ek Paket (Expansion)",
    "Promo / Promo Kart",
    "Insert / Organizer",
    "Oyun Matı (Playmat)",
    "Zar / Token",
    "Yedek Parça / Eksik Parça",
  ],

  [KEY("Konsollar")]: [
    "PlayStation Konsollar",
    "Xbox Konsollar",
    "Nintendo Konsollar",
    "Retro Konsollar",
    "VR Başlıklar",
    "Mod / Tamir / Parça",
  ],

  [KEY("El Konsolları")]: [
    "Nintendo El Konsolları",
    "PlayStation El Konsolları",
    "PC / Windows El Konsolları",
    "Retro El Konsolları",
    "Mod / Tamir / Parça",
  ],

  [KEY("Konsol Oyunları")]: [
    "PlayStation Oyunları",
    "Xbox Oyunları",
    "Nintendo Oyunları",
    "Retro Oyunlar",
    "Koleksiyon Sürümleri",
    "Steelbook / Özel Baskı",
    "Oyun Kodları (PSN/Xbox/Nintendo)",
    "DLC / Season Pass",
  ],

  [KEY("Konsol & PC Ekipmanları")]: [
    "Controller / Gamepad",
    "Şarj Standı / Dock",
    "Direksiyon Seti (Wheel)",
    "Pedal / Shifter",
    "Arcade Stick",
    "VR Aksesuarları",
    "Kulaklık / Headset",
    "Mikrofon",
    "Kamera (Stream)",
    "Capture Card",
    "Klavye / Mouse",
    "Mousepad",
    "Kablo / Adaptör",
    "Depolama (HDD/SSD)",
    "Taşıma Çantası / Case",
  ],

  [KEY("Figürler")]: [
    "Anime Figürleri",
    "Marvel / DC",
    "Star Wars",
    "Oyun Figürleri",
    "Funko Pop & Vinyl",
    "Nendoroid / Figma",
    "Action Figure",
    "Statue / Büst / Diorama",
    "Model Kit (Gunpla vb.)",
    "3D Printed Figür",
    "Stand / Parça / Aksesuar",
  ],

  [KEY("TCG")]: [
    "Pokémon TCG",
    "Yu-Gi-Oh!",
    "Magic: The Gathering",
    "One Piece TCG",
    "Digimon TCG",
    "Lorcana",
    "Tekli Kart (Singles)",
    "Booster / Pack",
    "Deck / Structure Deck",
    "Sleeve",
    "Binder / Albüm",
    "Deck Box",
    "Playmat",
    "Zar / Token / Sayaç",
  ],

  [KEY("Manga / Çizgi Roman")]: [
    "Manga",
    "Çizgi Roman",
    "Light Novel",
    "Artbook",
    "Koleksiyon Ciltleri",
    "Rehber / Tasarım Kitabı",
  ],

  [KEY("LEGO / Hobi")]: [
    "LEGO Setleri",
    "MiniFig / Parça",
    "Technic / Creator",
    "Puzzle",
    "Maket / Model Kit",
    "Boyama / Mini Paint",
    "Airbrush / Hobi Ekipman",
  ],

  [KEY("Dekor / Poster")]: [
    "Poster",
    "Canvas / Tablo",
    "Sticker / Print",
    "Raf / Display Stand",
    "LED / Işık Dekor",
    "Diorama Dekor",
  ],

  [KEY("Teknoloji")]: [
    "Retro Emülatör Cihazları",
    "Mini PC",
    "Streaming Ekipmanları",
    "Mod Ekipmanları",
  ],

  [KEY("Diğer")]: [
    "Blu-ray / Steelbook Film",
    "Oyun Soundtrack (CD/Vinyl)",
    "Koleksiyon Eşyası",
    "Mystery Box / Sürpriz Set",
    "Karışık Geek Ürün",
  ],

  // fallback
  _default: ["Genel", "Aksesuar", "Diğer"],
};

/* =========================
   LIMITS
========================= */

const MAX_CATEGORY_NAME = 80; // kategori adı
const MAX_SUBCATEGORY_NAME = 120; // alt kategori adı

/* =========================
   PAGE
========================= */

export default function AdminCategoriesPage() {
  const { toast, showToast } = useToast();

  // "categories" -> kategori listesi
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const [categoryName, setCategoryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // UX
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(40);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const trimmedInfo = useMemo(() => normalizeTextTR(categoryName), [categoryName]);
  const trimmedName = trimmedInfo.trimmed;
  const nameLower = trimmedInfo.lower;

  const normalizedSearch = useMemo(
    () => normalizeTextTR(search).lower,
    [search]
  );

  // "subCategories" paneli -> alt kategori yönetimi
  const subCategoriesPanelRef = useRef<HTMLDivElement | null>(null);
  const subCategoryFormRef = useRef<HTMLDivElement | null>(null);

  const [subCategoriesOpen, setSubCategoriesOpen] = useState(false);
  const [subCategoriesCategoryId, setSubCategoriesCategoryId] = useState<string>("");

  const [subCategories, setSubCategories] = useState<SubCategoryDoc[]>([]);
  const [subCategoriesLoading, setSubCategoriesLoading] = useState(false);
  const [subCategoriesSearch, setSubCategoriesSearch] = useState("");

  const [savingSubCategory, setSavingSubCategory] = useState(false);
  const [subCategoryError, setSubCategoryError] = useState("");

  // edit state
  const [editingSubCategoryId, setEditingSubCategoryId] = useState<string | null>(null);

  // SubCategory form (alt kategori)
  const [subCategoryName, setSubCategoryName] = useState("");
  const subCategoryTrimmed = useMemo(
    () => normalizeTextTR(subCategoryName).trimmed,
    [subCategoryName]
  );
  const subCategoryLower = useMemo(
    () => normalizeTextTR(subCategoryName).lower,
    [subCategoryName]
  );

  const [description, setDescription] = useState("");

  const selectedCategoryForSubCategories = useMemo(() => {
    if (!subCategoriesCategoryId) return null;
    return categories.find((b) => b.id === subCategoriesCategoryId) || null;
  }, [categories, subCategoriesCategoryId]);

  /* ================= LOAD CATEGORIES (LIVE) ================= */

  useEffect(() => {
    setCategoriesLoading(true);

    // Firestore koleksiyon adı AYNEN kalsın: "categories"
    const q = query(collection(db, "categories"), orderBy("nameLower", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Category, "id">),
        })) as Category[];

        setCategories(data);
        setCategoriesLoading(false);

        // subCategoriesCategoryId boşsa ilk kategoriye bağla
        setSubCategoriesCategoryId((prev) => {
          if (prev) return prev;
          return data[0]?.id || "";
        });
      },
      () => setCategoriesLoading(false)
    );

    return () => unsub();
  }, []);

  /* ================= SEED DEFAULT CATEGORIES ================= */

  const handleSeedDefaults = async () => {
    setError("");

    try {
      setSaving(true);

      const existing = new Set(
        categories.map((b) => safeString(b.nameLower, "")).filter(Boolean)
      );

      const toAdd = DEFAULT_CATEGORIES.map((name) => {
        const info = normalizeTextTR(name);
        return { name: info.trimmed, nameLower: info.lower };
      }).filter((x) => x.name && !existing.has(x.nameLower));

      if (toAdd.length === 0) {
        showToast({
          type: "info",
          title: "Zaten var",
          text: "Varsayılan kategoriler zaten ekli görünüyor.",
        });
        return;
      }

      // 500 batch limit güvenli: 450 chunk
      let i = 0;
      while (i < toAdd.length) {
        const chunk = toAdd.slice(i, i + 450);
        const batch = writeBatch(db);

        for (const c of chunk) {
          const ref = doc(collection(db, "categories"));
          batch.set(ref, {
            name: c.name,
            nameLower: c.nameLower,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
        i += chunk.length;
      }

      showToast({
        type: "success",
        title: "Varsayılanlar eklendi",
        text: `${toAdd.length} kategori eklendi.`,
      });
    } catch {
      showToast({
        type: "error",
        title: "Hata",
        text: "Varsayılan kategoriler eklenemedi.",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ================= SEED DEFAULT SUBCATEGORIES (SELECTED) ================= */

  const handleSeedDefaultSubcategoriesForSelected = async () => {
    setSubCategoryError("");

    if (!subCategoriesCategoryId) {
      showToast({
        type: "error",
        title: "Kategori seçili değil",
        text: "Önce bir kategori seçmelisin.",
      });
      return;
    }

    const category = categories.find((b) => b.id === subCategoriesCategoryId);
    if (!category) {
      showToast({
        type: "error",
        title: "Kategori bulunamadı",
        text: "Seçili kategori bulunamadı.",
      });
      return;
    }

    const key = safeString(category.nameLower, "");
    const defaults =
      DEFAULT_SUBCATEGORIES[key] || DEFAULT_SUBCATEGORIES["_default"];

    if (!defaults || defaults.length === 0) {
      showToast({
        type: "info",
        title: "Default yok",
        text: "Bu kategori için tanımlı default alt kategori yok.",
      });
      return;
    }

    try {
      setSavingSubCategory(true);

      // Mevcut alt kategorileri Firestore'dan çek (state'e güvenmeyelim)
      const existingSnap = await getDocs(
        query(collection(db, "subCategories"), where("categoryId", "==", subCategoriesCategoryId))
      );

      const existing = new Set<string>();
      for (const d of existingSnap.docs) {
        const data = d.data() as any;
        const nl = safeString(data?.nameLower, "");
        if (nl) existing.add(nl);
      }

      // eklenecekleri çıkar
      const toAdd = defaults
        .map((x) => normalizeTextTR(x))
        .filter((x) => x.trimmed && !existing.has(x.lower));

      if (toAdd.length === 0) {
        showToast({
          type: "info",
          title: "Zaten ekli",
          text: `"${category.name}" için default alt kategoriler zaten var.`,
        });
        return;
      }

      // 500 batch limit güvenli: 450 chunk
      let i = 0;
      while (i < toAdd.length) {
        const chunk = toAdd.slice(i, i + 450);
        const batch = writeBatch(db);

        for (const item of chunk) {
          const ref = doc(collection(db, "subCategories"));
          batch.set(ref, {
            name: item.trimmed,
            nameLower: item.lower,
            categoryId: subCategoriesCategoryId,
            description: "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
        i += chunk.length;
      }

      showToast({
        type: "success",
        title: "Alt kategoriler eklendi",
        text: `${toAdd.length} alt kategori "${category.name}" içine eklendi.`,
      });
    } catch {
      showToast({
        type: "error",
        title: "Hata",
        text: "Alt kategori defaultları eklenemedi.",
      });
    } finally {
      setSavingSubCategory(false);
    }
  };

  /* ================= ADD CATEGORY ================= */

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!trimmedName) {
      setError("Kategori adı boş olamaz.");
      return;
    }

    if (trimmedName.length > MAX_CATEGORY_NAME) {
      setError(`Kategori adı çok uzun. (max ${MAX_CATEGORY_NAME} karakter)`);
      return;
    }

    const exists = categories.some((b) => safeString(b.nameLower, "") === nameLower);
    if (exists) {
      setError("Bu kategori zaten var.");
      return;
    }

    try {
      setSaving(true);

      await addDoc(collection(db, "categories"), {
        name: trimmedName,
        nameLower,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setCategoryName("");
      showToast({
        type: "success",
        title: "Kategori eklendi",
        text: `"${trimmedName}" başarıyla eklendi.`,
      });
    } catch {
      setError("Kategori eklenirken hata oluştu.");
      showToast({
        type: "error",
        title: "Kayıt başarısız",
        text: "Kategori eklenemedi. Tekrar dene.",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ================= EDIT CATEGORY ================= */

  const beginEdit = (b: Category) => {
    setError("");
    setEditingId(b.id);
    setEditingValue(safeString(b.name, ""));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue("");
  };

  const saveEdit = async (b: Category) => {
    setError("");

    const { trimmed, lower } = normalizeTextTR(editingValue);

    if (!trimmed) {
      setError("Kategori adı boş olamaz.");
      return;
    }

    if (trimmed.length > MAX_CATEGORY_NAME) {
      setError(`Kategori adı çok uzun. (max ${MAX_CATEGORY_NAME} karakter)`);
      return;
    }

    const already = categories.some(
      (x) => x.id !== b.id && safeString(x.nameLower, "") === lower
    );
    if (already) {
      setError("Bu kategori adı zaten var.");
      return;
    }

    try {
      setSaving(true);

      await updateDoc(doc(db, "categories", b.id), {
        name: trimmed,
        nameLower: lower,
        updatedAt: serverTimestamp(),
      });

      showToast({
        type: "success",
        title: "Güncellendi",
        text: `"${trimmed}" kaydedildi.`,
      });

      cancelEdit();
    } catch {
      showToast({
        type: "error",
        title: "Hata",
        text: "Güncelleme başarısız.",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ================= DELETE CATEGORY ================= */

  const handleDeleteCategory = async (category: Category) => {
    setError("");

    const ok = confirm(
      `"${category.name}" kategorisini silmek istiyor musun?\n\n⚠️ Bu kategoriye bağlı alt kategoriler varsa sorun çıkarabilir.`
    );
    if (!ok) return;

    try {
      setSaving(true);

      // Soft safety check: alt kategori var mı
      try {
        const subCategoriesSnap = await getDocs(
          query(
            collection(db, "subCategories"),
            where("categoryId", "==", category.id),
            limit(1)
          )
        );
        if (!subCategoriesSnap.empty) {
          const sure = confirm(
            `"${category.name}" kategorisine bağlı en az 1 alt kategori var.\n\nYine de silmek istiyor musun?`
          );
          if (!sure) {
            setSaving(false);
            return;
          }
        }
      } catch {
        // ignore
      }

      await deleteDoc(doc(db, "categories", category.id));
      showToast({
        type: "success",
        title: "Silindi",
        text: `"${category.name}" kaldırıldı.`,
      });

      if (editingId === category.id) cancelEdit();

      // eğer alt kategori paneli bu kategorideyse kapat
      if (subCategoriesCategoryId === category.id) {
        setSubCategoriesOpen(false);
        setSubCategoriesCategoryId("");
        setSubCategories([]);
        setEditingSubCategoryId(null);
      }
    } catch {
      showToast({
        type: "error",
        title: "Silinemedi",
        text: "Kategori silinirken hata oluştu.",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ================= COMPUTED CATEGORIES ================= */

  const filteredCategories = useMemo(() => {
    const s = normalizedSearch;
    const list = [...categories];

    if (!s) return list;

    return list.filter((b) => {
      const n = safeString(b.nameLower, "").toLocaleLowerCase("tr-TR");
      const id = safeString(b.id, "").toLowerCase();
      return n.includes(s) || id.includes(s);
    });
  }, [categories, normalizedSearch]);

  const pagedCategories = useMemo(() => {
    const p = clampInt(pageSize, 10, 200);
    return filteredCategories.slice(0, p);
  }, [filteredCategories, pageSize]);

  const canLoadMore = filteredCategories.length > pagedCategories.length;

  /* ================= SUBCATEGORIES: OPEN PANEL ================= */

  const openSubCategoriesForCategory = (b: Category) => {
    setSubCategoriesOpen(true);
    setSubCategoriesCategoryId(b.id);
    setSubCategoriesSearch("");

    showToast({
      type: "info",
      title: "Alt Kategori Yönetimi",
      text: `"${b.name}" kategorisinin alt kategorileri açıldı.`,
    });

    setTimeout(() => {
      subCategoriesPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  };

  /* ================= LOAD SUBCATEGORIES (LIVE) ================= */

  useEffect(() => {
    if (!subCategoriesOpen || !subCategoriesCategoryId) {
      setSubCategories([]);
      return;
    }

    setSubCategoriesLoading(true);

    const q = query(
      collection(db, "subCategories"),
      where("categoryId", "==", subCategoriesCategoryId),
      orderBy("nameLower", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as SubCategoryDoc[];

        setSubCategories(data);
        setSubCategoriesLoading(false);
      },
      () => {
        setSubCategories([]);
        setSubCategoriesLoading(false);
      }
    );

    return () => unsub();
  }, [subCategoriesOpen, subCategoriesCategoryId]);

  const filteredSubCategories = useMemo(() => {
    const q = normalizeTextTR(subCategoriesSearch).lower;
    if (!q) return subCategories;
    return subCategories.filter((m) =>
      safeString(m.nameLower, m.name.toLowerCase()).includes(q)
    );
  }, [subCategories, subCategoriesSearch]);

  /* ================= SUBCATEGORY FORM UTILS ================= */

  const resetSubCategoryForm = () => {
    setEditingSubCategoryId(null);
    setSubCategoryName("");
    setDescription("");
    setSubCategoryError("");
  };

  const beginSubCategoryEdit = (m: SubCategoryDoc) => {
    setSubCategoryError("");

    if (!subCategoriesOpen) setSubCategoriesOpen(true);
    if (m.categoryId && m.categoryId !== subCategoriesCategoryId) setSubCategoriesCategoryId(m.categoryId);

    setEditingSubCategoryId(m.id);
    setSubCategoryName(safeString(m.name, ""));
    setDescription(safeString(m.description, ""));

    showToast({
      type: "info",
      title: "Alt Kategori Düzenle",
      text: `"${safeString(m.name, "Alt kategori")}" düzenleniyor.`,
    });

    setTimeout(() => {
      subCategoryFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  };

  /* ================= ADD / UPDATE SUBCATEGORY ================= */

  const handleSaveSubCategory = async (e: FormEvent) => {
    e.preventDefault();
    setSubCategoryError("");

    if (!subCategoriesCategoryId) {
      setSubCategoryError("Önce kategori seç.");
      return;
    }

    if (!subCategoryTrimmed) {
      setSubCategoryError("Alt kategori adı boş olamaz.");
      return;
    }

    if (subCategoryTrimmed.length > MAX_SUBCATEGORY_NAME) {
      setSubCategoryError(
        `Alt kategori adı çok uzun. (max ${MAX_SUBCATEGORY_NAME} karakter)`
      );
      return;
    }

    const duplicate = subCategories.some(
      (x) =>
        safeString(x.nameLower, "") === subCategoryLower &&
        x.id !== (editingSubCategoryId || "")
    );
    if (duplicate) {
      setSubCategoryError("Bu alt kategori zaten var.");
      return;
    }

    try {
      setSavingSubCategory(true);

      // EDIT
      if (editingSubCategoryId) {
        await updateDoc(doc(db, "subCategories", editingSubCategoryId), {
          name: subCategoryTrimmed,
          nameLower: subCategoryLower,
          categoryId: subCategoriesCategoryId,
          description: description.trim(),
          updatedAt: serverTimestamp(),
        });

        showToast({
          type: "success",
          title: "Güncellendi",
          text: `"${subCategoryTrimmed}" kaydedildi.`,
        });

        resetSubCategoryForm();
        return;
      }

      // ADD
      await addDoc(collection(db, "subCategories"), {
        name: subCategoryTrimmed,
        nameLower: subCategoryLower,
        categoryId: subCategoriesCategoryId,
        description: description.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      showToast({
        type: "success",
        title: "Alt kategori eklendi",
        text: `"${subCategoryTrimmed}" eklendi.`,
      });

      resetSubCategoryForm();
    } catch {
      setSubCategoryError(
        editingSubCategoryId
          ? "Alt kategori güncellenirken hata oluştu."
          : "Alt kategori eklenirken hata oluştu."
      );
      showToast({
        type: "error",
        title: "Hata",
        text: editingSubCategoryId
          ? "Alt kategori güncellenemedi."
          : "Alt kategori eklenemedi.",
      });
    } finally {
      setSavingSubCategory(false);
    }
  };

  /* ================= DELETE SUBCATEGORY ================= */

  const handleDeleteSubCategory = async (m: SubCategoryDoc) => {
    if (!confirm(`"${m.name}" silinsin mi?`)) return;

    try {
      await deleteDoc(doc(db, "subCategories", m.id));

      if (editingSubCategoryId === m.id) {
        resetSubCategoryForm();
      }

      showToast({
        type: "success",
        title: "Silindi",
        text: `"${m.name}" kaldırıldı.`,
      });
    } catch {
      showToast({
        type: "error",
        title: "Silinemedi",
        text: "Alt kategori silinirken hata oluştu.",
      });
    }
  };

  /* ================= UI ================= */

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      <div className="border rounded-2xl bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Katalog</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">
              Kategori Yönetimi
            </div>
            <div className="mt-1 text-sm text-gray-600">
              Kategori ekle, düzenle, sil. Alt kategorileri aynı sayfada yönet.
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSeedDefaults}
              disabled={saving}
              className={cx(
                "px-3 py-2 rounded-xl text-sm font-semibold text-white",
                saving ? "bg-purple-300" : "bg-purple-600 hover:bg-purple-700"
              )}
              title="Default geek kategorilerini ekler"
            >
              ⚡ Varsayılanları Ekle
            </button>

            <button
              type="button"
              onClick={() => {
                setSearch("");
                setPageSize(40);
                showToast({
                  type: "info",
                  title: "Filtre",
                  text: "Arama temizlendi.",
                });
              }}
              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
            >
              🧹 Temizle
            </button>

            {subCategoriesOpen && (
              <button
                type="button"
                onClick={() => {
                  setSubCategoriesOpen(false);
                  resetSubCategoryForm();
                  showToast({
                    type: "info",
                    title: "Kapatıldı",
                    text: "Alt kategori paneli kapandı.",
                  });
                }}
                className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
              >
                ✖️ Alt Kategori
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 mb-1">Arama</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kategori adı veya ID ara…"
              className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200"
            />
            <div className="mt-1 text-[11px] text-gray-500">
              Toplam:{" "}
              <span className="font-medium text-gray-800">{categories.length}</span>{" "}
              • Gösterilen:{" "}
              <span className="font-medium text-gray-800">
                {pagedCategories.length}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setPageSize((p) => clampInt(p + 20, 10, 200))}
              disabled={!canLoadMore}
              className={cx(
                "px-4 py-2.5 rounded-xl border text-sm",
                canLoadMore
                  ? "bg-white hover:bg-gray-50 active:bg-gray-100"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              +20 Yükle
            </button>
          </div>
        </div>
      </div>

      {/* Add category */}
      <div className="border rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Yeni Kategori Ekle
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Kategori adı tekil olmalı (küçük/büyük harf fark etmez).
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Örn: <span className="font-mono">Kutu Oyunları</span>,{" "}
            <span className="font-mono">Konsollar</span>
          </div>
        </div>

        <form
          onSubmit={handleAddCategory}
          className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"
        >
          <div>
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="Kategori adı…"
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
            />

            {error && <div className="mt-2 text-sm text-red-700">{error}</div>}

            {trimmedName && (
              <div className="mt-2 text-[11px] text-gray-500">
                Kaydedilecek:{" "}
                <span className="font-medium text-gray-900">{trimmedName}</span>{" "}
                <span className="mx-1">•</span>
                Anahtar: <span className="font-mono">{nameLower}</span>
              </div>
            )}
          </div>

          <button
            disabled={saving}
            className={cx(
              "h-[48px] px-5 rounded-xl text-white text-sm font-semibold",
              saving ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {saving ? "Ekleniyor..." : "Kategori Ekle"}
          </button>
        </form>
      </div>

      {/* Categories list */}
      <div className="border rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Kategori Listesi
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Düzenle ile isim düzelt, 🧩 ile alt kategorileri yönet.
            </div>
          </div>
        </div>

        <div className="mt-4">
          {categoriesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : pagedCategories.length === 0 ? (
            <div className="border rounded-2xl bg-gray-50 p-6 text-gray-600">
              <div className="font-semibold text-gray-900">Sonuç bulunamadı</div>
              <div className="mt-1 text-sm">Aramayı değiştir veya temizle.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {pagedCategories.map((b) => {
                const isEditing = editingId === b.id;

                return (
                  <div
                    key={b.id}
                    className="border rounded-2xl p-4 hover:bg-gray-50 transition"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-gray-500">Kategori</div>

                        {!isEditing ? (
                          <div className="mt-1 text-base font-semibold text-gray-900 truncate">
                            {b.name}
                          </div>
                        ) : (
                          <div className="mt-1">
                            <input
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full md:max-w-md border rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                              placeholder="Yeni kategori adı…"
                            />
                            <div className="mt-1 text-[11px] text-gray-500">
                              Anahtar:{" "}
                              <span className="font-mono">
                                {normalizeTextTR(editingValue).lower}
                              </span>
                            </div>
                          </div>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span className="px-2 py-1 rounded-xl border bg-white">
                            ID:{" "}
                            <span className="font-mono text-gray-800">
                              {b.id}
                            </span>
                          </span>
                          <span className="px-2 py-1 rounded-xl border bg-white">
                            Oluşturma:{" "}
                            <span className="text-gray-800">
                              {formatDateTR(b.createdAt)}
                            </span>
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await copyToClipboard(b.id);
                            showToast(
                              ok
                                ? {
                                    type: "success",
                                    title: "Kopyalandı",
                                    text: "Kategori ID panoya kopyalandı.",
                                  }
                                : {
                                    type: "error",
                                    title: "Kopyalanamadı",
                                    text: "Tarayıcı izin vermedi.",
                                  }
                            );
                          }}
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                          title="ID kopyala"
                        >
                          📋 ID
                        </button>

                        <button
                          type="button"
                          onClick={() => openSubCategoriesForCategory(b)}
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                        >
                          🧩 Alt Kategori
                        </button>

                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => beginEdit(b)}
                            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                          >
                            ✏️ Düzenle
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(b)}
                              disabled={saving}
                              className={cx(
                                "px-3 py-2 rounded-xl text-sm font-semibold text-white",
                                saving
                                  ? "bg-green-400"
                                  : "bg-green-600 hover:bg-green-700"
                              )}
                            >
                              {saving ? "Kaydediliyor..." : "Kaydet"}
                            </button>

                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                            >
                              İptal
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleDeleteCategory(b)}
                          className={cx(
                            "px-3 py-2 rounded-xl text-sm font-semibold text-white",
                            saving
                              ? "bg-red-300"
                              : "bg-red-600 hover:bg-red-700"
                          )}
                        >
                          🗑️ Sil
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {canLoadMore && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setPageSize((p) => clampInt(p + 40, 10, 200))}
              className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
            >
              Daha fazla yükle
            </button>
          </div>
        )}
      </div>

      {/* SUBCATEGORY PANEL */}
      <div ref={subCategoriesPanelRef} className="border rounded-2xl bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Katalog</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">
              Alt Kategori Yönetimi
            </div>
            <div className="mt-1 text-sm text-gray-600">
              Kategoriden 🧩 tıklayınca burada açılır. Ayrı sayfa yok.
            </div>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            {subCategoriesOpen && (
              <button
                type="button"
                onClick={handleSeedDefaultSubcategoriesForSelected}
                disabled={savingSubCategory}
                className={cx(
                  "px-3 py-2 rounded-xl text-sm font-semibold text-white",
                  savingSubCategory
                    ? "bg-indigo-300 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700"
                )}
                title="Seçili kategoriye default alt kategorileri ekler"
              >
                ⚡ Default Alt Kategorileri Ekle
              </button>
            )}

            {subCategoriesOpen ? (
              <button
                type="button"
                onClick={() => {
                  setSubCategoriesOpen(false);
                  resetSubCategoryForm();
                }}
                className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
              >
                ✖️ Kapat
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  showToast({
                    type: "info",
                    title: "Alt Kategori Paneli",
                    text: "Bir kategorinin yanında 🧩 Alt Kategori’ye bas.",
                  })
                }
                className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
              >
                ℹ️ Nasıl açarım?
              </button>
            )}
          </div>
        </div>

        {!subCategoriesOpen ? (
          <div className="mt-4 border rounded-2xl bg-gray-50 p-5 text-gray-700">
            <div className="font-semibold text-gray-900">
              Alt kategori paneli kapalı
            </div>
            <div className="mt-1 text-sm">
              Kategori listesinde istediğin kategorinin <b>🧩 Alt Kategori</b>{" "}
              butonuna bas.
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">Seçili Kategori</div>
                <select
                  value={subCategoriesCategoryId}
                  onChange={(e) => {
                    setSubCategoriesCategoryId(e.target.value);
                    resetSubCategoryForm();
                  }}
                  className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200 bg-white"
                >
                  {categories.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>

                <div className="mt-1 text-[11px] text-gray-500">
                  Kategori:{" "}
                  <span className="font-medium text-gray-900">
                    {selectedCategoryForSubCategories?.name || "-"}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Alt kategori ara</div>
                <input
                  value={subCategoriesSearch}
                  onChange={(e) => setSubCategoriesSearch(e.target.value)}
                  placeholder="Alt kategori ara…"
                  className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                />
                <div className="mt-1 text-[11px] text-gray-500">
                  Toplam:{" "}
                  <span className="font-medium text-gray-900">{subCategories.length}</span>{" "}
                  • Gösterilen:{" "}
                  <span className="font-medium text-gray-900">
                    {filteredSubCategories.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Add/Edit subcategory form */}
            <div ref={subCategoryFormRef} className="mt-5 border rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {editingSubCategoryId
                      ? "Alt Kategori Düzenle"
                      : "Yeni Alt Kategori Ekle"}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {editingSubCategoryId
                      ? "Düzenleme aynı sayfada yapılır. Kaydedince anında güncellenir."
                      : "Bu alt kategori seçili kategoriye eklenecek."}
                  </div>
                </div>

                {editingSubCategoryId ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetSubCategoryForm();
                      showToast({
                        type: "info",
                        title: "İptal",
                        text: "Alt kategori düzenleme iptal edildi.",
                      });
                    }}
                    className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                  >
                    İptal
                  </button>
                ) : null}
              </div>

              <form onSubmit={handleSaveSubCategory} className="mt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    label="Alt kategori adı"
                    value={subCategoryName}
                    onChange={setSubCategoryName}
                    placeholder="Örn: Eurogame / Party / PS5 Aksesuar / Pokémon..."
                  />
                  <div />
                </div>

                <div className="border rounded-2xl p-4">
                  <div className="text-sm font-semibold text-gray-900">
                    Açıklama (opsiyonel)
                  </div>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Bu alt kategori neyi kapsıyor? (opsiyonel)"
                    className="mt-2 w-full border rounded-xl px-4 py-3 text-sm min-h-[120px] outline-none focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                {subCategoryError && (
                  <div className="text-sm text-red-700">{subCategoryError}</div>
                )}

                <button
                  disabled={savingSubCategory}
                  className={cx(
                    "w-full py-3 rounded-xl text-sm font-semibold text-white",
                    savingSubCategory
                      ? "bg-green-400"
                      : "bg-green-600 hover:bg-green-700"
                  )}
                >
                  {savingSubCategory
                    ? editingSubCategoryId
                      ? "Güncelleniyor..."
                      : "Ekleniyor..."
                    : editingSubCategoryId
                    ? "Alt Kategoriyi Güncelle"
                    : "Alt Kategori Ekle"}
                </button>
              </form>
            </div>

            {/* Subcategory list */}
            <div className="mt-5">
              <div className="text-sm font-semibold text-gray-900">
                Alt Kategori Listesi
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Sil sadece o alt kategoriyi kaldırır. Düzenle ile gömülü düzenlersin.
              </div>

              <div className="mt-3">
                {subCategoriesLoading ? (
                  <div className="space-y-2">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </div>
                ) : filteredSubCategories.length === 0 ? (
                  <div className="border rounded-2xl bg-gray-50 p-5 text-gray-700">
                    Bu kategoride alt kategori yok.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredSubCategories.map((m) => {
                      const isEditingSubCategory = editingSubCategoryId === m.id;

                      return (
                        <div
                          key={m.id}
                          className={cx(
                            "border rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3",
                            isEditingSubCategory && "ring-2 ring-gray-200"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-semibold text-gray-900 truncate">
                                {m.name}
                              </div>

                              {isEditingSubCategory && (
                                <span className="text-[11px] px-2 py-1 rounded-xl border bg-gray-900 text-white">
                                  Düzenleniyor
                                </span>
                              )}
                            </div>

                            {m.description ? (
                              <div className="mt-1 text-xs text-gray-600 line-clamp-2">
                                {m.description}
                              </div>
                            ) : (
                              <div className="mt-1 text-xs text-gray-400">
                                (Açıklama yok)
                              </div>
                            )}

                            <div className="mt-1 text-[11px] text-gray-500 font-mono">
                              {m.id}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => beginSubCategoryEdit(m)}
                              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                            >
                              ✏️ Düzenle
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteSubCategory(m)}
                              className="px-3 py-2 rounded-xl bg-red-600 text-white text-sm hover:bg-red-700"
                            >
                              🗑️ Sil
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 text-[11px] text-gray-500">
                Not: Firestore bazen index isteyebilir. Konsolda link çıkar.
              </div>
            </div>
          </>
        )}
      </div>

      <div className="text-xs text-gray-500">
        Not: Biz Firestore koleksiyon isimlerini değiştirmedik: <b>categories</b> ve{" "}
        <b>subCategories</b>. Sadece ekranda “Kategori / Alt kategori” diye gösteriyoruz.
      </div>
    </div>
  );
}
