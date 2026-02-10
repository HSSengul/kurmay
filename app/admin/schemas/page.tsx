// app/admin/schemas/page.tsx
"use client";

import { useState } from "react";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

import {
  ToastView,
  useToast,
  cx,
  normalizeTextTR,
  safeString,
} from "@/app/components/admin/ui";

/* =========================
   TYPES
========================= */

type Category = {
  id: string; // categories doc id
  name: string;
  nameLower: string;
};

type FieldType = "text" | "number" | "select" | "boolean" | "multiselect";

type SchemaField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;

  placeholder?: string;
  min?: number | null;
  max?: number | null;
  options?: string[];
};

/**
 * Schema kategori bazlidir:
 * Firestore:
 *   listingSchemas/{categoryId}
 */
type ListingSchemaDoc = {
  categoryId: string;
  version: number;
  fields: SchemaField[];
  createdAt?: any;
  updatedAt?: any;
};

/* =========================
   TEMPLATES (FIELD LISTS)
   - Kategori ismine göre otomatik seçilir
   - UI’da seçim yok
========================= */

// 🎲 Kutu oyunu / Kart oyunu / Party / Eurogame vb.
const TEMPLATE_BOARDGAME: SchemaField[] = [
  {
    key: "gameName",
    label: "Oyunun Resmi Adı",
    type: "text",
    required: false,
    placeholder: "Örn: Catan / Terraforming Mars",
  },
  {
    key: "minPlayers",
    label: "Minimum oyuncu",
    type: "number",
    required: true,
    min: 1,
    max: 50,
  },
  {
    key: "maxPlayers",
    label: "Maksimum oyuncu",
    type: "number",
    required: true,
    min: 1,
    max: 50,
  },
  {
    key: "minPlaytime",
    label: "Minimum süre (dk)",
    type: "number",
    required: false,
    min: 1,
    max: 1000,
  },
  {
    key: "maxPlaytime",
    label: "Maksimum süre (dk)",
    type: "number",
    required: false,
    min: 1,
    max: 1000,
  },
  {
    key: "suggestedAge",
    label: "Yaş önerisi",
    type: "select",
    required: false,
    options: ["3", "7", "13", "18"],
  },
  {
    key: "language",
    label: "Dil",
    type: "select",
    required: false,
    options: [
      "Türkçe",
      "İngilizce",
      "Almanca",
      "Fransızca",
      "İtalyanca",
      "İspanyolca",
      "Diğer",
    ],
  },
  {
    key: "completeContent",
    label: "İçerik tam mı?",
    type: "boolean",
    required: true,
  },
  {
    key: "sleeved",
    label: "Sleeve kullanıldı mı?",
    type: "boolean",
    required: false,
  },
];

// 🎮 Konsol (donanım)
const TEMPLATE_CONSOLE: SchemaField[] = [
  {
    key: "consoleModel",
    label: "Model / Sürüm",
    type: "text",
    required: true,
    placeholder: "Örn: PS5 Slim / Series X / Switch OLED",
  },
  {
    key: "storage",
    label: "Depolama",
    type: "select",
    required: false,
    options: [
      "32GB",
      "64GB",
      "128GB",
      "256GB",
      "512GB",
      "1TB",
      "2TB",
      "4TB",
      "Yok / Belirsiz",
    ],
  },
  {
    key: "modded",
    label: "Modlu mu?",
    type: "boolean",
    required: false,
  },
  {
    key: "box",
    label: "Kutu var mı?",
    type: "boolean",
    required: false,
  },
  {
    key: "controllerCount",
    label: "Kumanda sayısı",
    type: "number",
    required: false,
    min: 0,
    max: 10,
  },
  {
    key: "accessories",
    label: "Aksesuarlar / Ek parçalar",
    type: "text",
    required: false,
    placeholder: "Örn: 2. kontrolcü, dock, HDMI",
  },
  {
    key: "purchaseYear",
    label: "Satın alma yılı",
    type: "number",
    required: false,
    min: 1980,
    max: 2100,
  },
  {
    key: "warrantyStatus",
    label: "Garanti durumu",
    type: "select",
    required: false,
    options: ["Devam ediyor", "Bitmiş", "Bilinmiyor"],
  },
  {
    key: "usageLevel",
    label: "Kullanım yoğunluğu",
    type: "select",
    required: false,
    options: ["Az", "Orta", "Yoğun"],
  },
  {
    key: "batteryHealth",
    label: "Pil sağlığı",
    type: "select",
    required: false,
    options: ["Çok iyi", "İyi", "Orta", "Zayıf", "Bilinmiyor"],
  },
  {
    key: "screenCondition",
    label: "Ekran durumu",
    type: "select",
    required: false,
    options: ["Çiziksiz", "Hafif çizik", "Belirgin çizik", "Kırık", "Bilinmiyor"],
  },
  {
    key: "stickDrift",
    label: "Stick drift var mı?",
    type: "select",
    required: false,
    options: ["Yok", "Var", "Bilinmiyor"],
  },
];

// 🕹️ Konsol oyunu (disk/kutu)
const TEMPLATE_CONSOLE_GAME: SchemaField[] = [
  {
    key: "platform",
    label: "Platform",
    type: "select",
    required: true,
    options: ["PS5", "PS4", "Xbox Series", "Xbox One", "Switch", "PC", "Diğer"],
  },
  {
    key: "region",
    label: "Bölge",
    type: "select",
    required: false,
    options: ["PAL", "NTSC-U", "NTSC-J", "Bilinmiyor"],
  },
  {
    key: "language",
    label: "Oyun dili",
    type: "select",
    required: false,
    options: ["Türkçe", "İngilizce", "Karışık", "Bilinmiyor"],
  },
  {
    key: "discCondition",
    label: "Disk kondisyonu",
    type: "select",
    required: false,
    options: ["Çiziksiz", "Hafif çizik", "Belirgin çizik", "Bilinmiyor"],
  },
  {
    key: "box",
    label: "Kutu var mı?",
    type: "boolean",
    required: false,
  },
];

// 🃏 TCG / Koleksiyon kartı
const TEMPLATE_TCG: SchemaField[] = [
  {
    key: "game",
    label: "TCG Türü",
    type: "select",
    required: true,
    options: [
      "Pokémon",
      "Yu-Gi-Oh!",
      "Magic: The Gathering",
      "One Piece",
      "Lorcana",
      "Diğer",
    ],
  },
  {
    key: "setName",
    label: "Set / Seri",
    type: "text",
    required: false,
    placeholder: "Örn: Base Set / Evolving Skies",
  },
  {
    key: "condition",
    label: "Kondisyon",
    type: "select",
    required: true,
    options: ["Mint", "Near Mint", "Excellent", "Good", "Played", "Poor"],
  },
  {
    key: "graded",
    label: "Graded mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "isHolo",
    label: "Holo / Foil",
    type: "boolean",
    required: false,
  },
];

// 🧸 Figür / Statue / Büst / Action figure
const TEMPLATE_FIGURE: SchemaField[] = [
  {
    key: "brand",
    label: "Marka",
    type: "select",
    required: false,
    options: ["Funko", "Bandai", "Hasbro", "McFarlane", "Good Smile", "Diğer"],
  },
  {
    key: "series",
    label: "Seri / Evren",
    type: "text",
    required: false,
    placeholder: "Örn: Marvel / Star Wars / Anime",
  },
  {
    key: "scale",
    label: "Ölçek",
    type: "select",
    required: false,
    options: ["1/12", "1/10", "1/8", "1/6", "N/A"],
  },
  {
    key: "box",
    label: "Kutu var mı?",
    type: "boolean",
    required: false,
  },
  {
    key: "accessoriesFull",
    label: "Tüm parçalar var mı?",
    type: "boolean",
    required: true,
  },
];

// 🧩 Aksesuar / Ekipman / Sleeve / Binder / Playmat / Kablo vb.
const TEMPLATE_ACCESSORY: SchemaField[] = [
  {
    key: "compatibility",
    label: "Uyumluluk",
    type: "text",
    required: true,
    placeholder: "Örn: PS5 / Switch / PC",
  },
  {
    key: "original",
    label: "Orijinal mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "warranty",
    label: "Garantili mi?",
    type: "boolean",
    required: false,
  },
];

/* =========================
   HELPERS
========================= */

function sanitizeKey(raw: string) {
  const n = normalizeTextTR(raw).lower;
  return n
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function cloneFields(fields: SchemaField[]) {
  return fields.map((f) => ({
    key: safeString(f.key, ""),
    label: safeString(f.label, ""),
    type: f.type,
    required: !!f.required,
    placeholder: f.placeholder ? safeString(f.placeholder, "") : "",
    min: f.min ?? null,
    max: f.max ?? null,
    options: Array.isArray(f.options) ? [...f.options] : [],
  }));
}

function normalizeFieldsForSave(fields: SchemaField[]) {
  const seen = new Set<string>();
  const out: SchemaField[] = [];

  for (const f of fields) {
    const key = sanitizeKey(f.key);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = safeString(f.label, "").trim().slice(0, 80);
    const placeholder = safeString(f.placeholder || "", "").trim().slice(0, 120);
    const type = f.type;

    const min = f.min == null ? null : Number(f.min);
    const max = f.max == null ? null : Number(f.max);

    const options =
      type === "select" || type === "multiselect"
        ? (Array.isArray(f.options) ? f.options : [])
            .map((x) => safeString(x, "").trim())
            .filter(Boolean)
            .slice(0, 50)
        : [];

    out.push({
      key,
      label: label || key,
      type,
      required: !!f.required,
      placeholder: placeholder || "",
      min: Number.isFinite(min as any) ? min : null,
      max: Number.isFinite(max as any) ? max : null,
      options,
    });
  }

  return out;
}

/**
 * Kategori ismine gore template secimi
 */
function pickTemplateFields(categoryLower: string): SchemaField[] {
  const c = safeString(categoryLower, "").toLowerCase();

  // yardımcı matcher
  const has = (...parts: string[]) => parts.some((p) => c.includes(p));

  // 1) TCG alt kategorileri: sleeve/binder/playmat -> accessory, diğerleri -> tcg
  if (has("tcg", "koleksiyon kart")) return TEMPLATE_TCG;

  // 2) Konsol Oyunlari
  if (has("konsol oyun")) return TEMPLATE_CONSOLE_GAME;

  // 3) Konsollar
  if (has("konsol")) return TEMPLATE_CONSOLE;

  // 4) Oyun Aksesuarlari / Hobi Ekipmanlari
  if (has("aksesuar", "hobi ekipman")) return TEMPLATE_ACCESSORY;

  // 5) Figurler
  if (has("figur")) return TEMPLATE_FIGURE;

  // 6) Miniature & Wargame
  if (has("miniature", "wargame")) return TEMPLATE_FIGURE;

  // 7) Masaustu RPG
  if (has("masaustu rpg", "rpg")) return TEMPLATE_BOARDGAME;

  // 8) VR / Sanal Gerceklik
  if (has("vr", "sanal gerceklik")) return TEMPLATE_CONSOLE;

  // 9) Retro Oyun / Retro Konsol
  if (has("retro")) return TEMPLATE_CONSOLE_GAME;

  // 10) Puzzle / Zeka Oyunlari
  if (has("puzzle", "zeka")) return TEMPLATE_BOARDGAME;

  // 11) Strateji rehberleri / kitaplar
  if (has("rehber", "kitap")) return TEMPLATE_ACCESSORY;

  // 12) Kart oyunlari / Kutu oyunlari
  if (has("kart oyun", "kutu oyun")) return TEMPLATE_BOARDGAME;

  // 13) Koleksiyon urunleri
  if (has("koleksiyon urun")) return TEMPLATE_FIGURE;

  // fallback
  return TEMPLATE_ACCESSORY;
}

/* =========================
   PAGE
========================= */

export default function AdminSchemasPage() {
  const { toast, showToast } = useToast();
  const [running, setRunning] = useState(false);

  const seedAllSchemasSingleButton = async () => {
    if (running) return;

    try {
      setRunning(true);

      // 1) categories cek
      const categoriesSnap = await getDocs(
        query(collection(db, "categories"), orderBy("order", "asc"))
      );

      const categories: Category[] = categoriesSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      if (categories.length === 0) {
        showToast({
          type: "info",
          title: "Kategori yok",
        text: "categories koleksiyonunda kategori bulunamadi.",
        });
        return;
      }

      // 3) mevcut schema doc'larını çek (createdAt kontrolü için)
      const existingSnap = await getDocs(collection(db, "listingSchemas"));
      const existingIds = new Set<string>(existingSnap.docs.map((d) => d.id));
      const existingById = new Map<string, any>();
      for (const d of existingSnap.docs) {
        existingById.set(d.id, d.data());
      }

      // 4) batch write (500 limit -> 450 güvenli chunk)
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let archived = 0;

      let batch = writeBatch(db);
      let opCount = 0;

      const commitChunk = async () => {
        if (opCount === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      };

      for (const c of categories) {
        const categoryLower = safeString(c.nameLower, "");
        const template = pickTemplateFields(categoryLower);
        const normalizedFields = normalizeFieldsForSave(cloneFields(template));

        if (!normalizedFields || normalizedFields.length === 0) {
          skipped++;
          continue;
        }

        const ref = doc(db, "listingSchemas", c.id);

        // createdAt sadece ilk kez
        if (!existingIds.has(c.id)) {
          const payload: ListingSchemaDoc = {
            categoryId: c.id,
            version: 1,
            fields: normalizedFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          batch.set(ref, payload);
          created++;
        } else {
          const prev = existingById.get(c.id);
          if (prev) {
            const archiveRef = doc(
              collection(db, "listingSchemasArchive", c.id, "versions")
            );
            batch.set(archiveRef, {
              ...prev,
              sourceCategoryId: c.id,
              archivedAt: serverTimestamp(),
              archivedFrom: "seedAllSchemasSingleButton",
            });
            archived++;
            opCount++;
            if (opCount >= 450) {
              await commitChunk();
            }
          }
          batch.update(ref, {
            categoryId: c.id,
            version: 1,
            fields: normalizedFields,
            updatedAt: serverTimestamp(),
          });
          updated++;
        }

        opCount++;

        if (opCount >= 450) {
          await commitChunk();
        }
      }

      await commitChunk();

      showToast({
        type: "success",
        title: "Tamam ✅",
        text: `Şema yükleme tamamlandı. Oluşturulan: ${created}, Güncellenen: ${updated}, Yedeklenen: ${archived}, Atlanan: ${skipped}.`,
      });
    } catch (e: any) {
      console.error("seedAllSchemasSingleButton error:", e);
      showToast({
        type: "error",
        title: "Hata",
        text: e?.message || "Seed sırasında hata oluştu.",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      {/* Ekranda TEK kontrol: tek buton */}
      <div className="border rounded-2xl bg-white p-8 flex items-center justify-center">
        <button
          type="button"
          onClick={seedAllSchemasSingleButton}
          disabled={running}
          className={cx(
            "w-full max-w-xl py-6 rounded-2xl text-lg font-bold transition",
            running
              ? "bg-blue-300 text-white cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 text-white"
          )}
        >
          {running
            ? "Yükleniyor... (tüm kategori şablonları yazılıyor)"
            : "🚀 TÜM KATEGORİ ŞABLONLARINI TEK TUŞLA YÜKLE"}
        </button>
      </div>
    </div>
  );
}
