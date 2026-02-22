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
import { devError } from "@/lib/logger";

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
    label: "Oyunun adi",
    type: "text",
    required: false,
    placeholder: "Orn: Catan / Terraforming Mars",
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
    label: "Minimum sure (dk)",
    type: "number",
    required: false,
    min: 1,
    max: 1000,
  },
  {
    key: "maxPlaytime",
    label: "Maksimum sure (dk)",
    type: "number",
    required: false,
    min: 1,
    max: 1000,
  },
  {
    key: "suggestedAge",
    label: "Yas onerisi",
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
      "Turkce",
      "Ingilizce",
      "Almanca",
      "Fransizca",
      "Italyanca",
      "Ispanyolca",
      "Diger",
    ],
  },
  {
    key: "completeContent",
    label: "Icerik tam mi?",
    type: "boolean",
    required: true,
  },
  {
    key: "sleeved",
    label: "Sleeve kullanildi mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_CARDGAME: SchemaField[] = [
  {
    key: "gameName",
    label: "Oyun adi",
    type: "text",
    required: true,
    placeholder: "Orn: Exploding Kittens / Uno",
  },
  {
    key: "playerRange",
    label: "Oyuncu araligi",
    type: "select",
    required: false,
    options: ["1-2", "2-4", "2-6", "4+", "Degisken"],
  },
  {
    key: "language",
    label: "Dil",
    type: "select",
    required: false,
    options: ["Turkce", "Ingilizce", "Diger"],
  },
  {
    key: "completeContent",
    label: "Icerik tam mi?",
    type: "boolean",
    required: true,
  },
  {
    key: "sleeved",
    label: "Sleeve kullanildi mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_CONSOLE: SchemaField[] = [
  {
    key: "consoleModel",
    label: "Model / Surum",
    type: "text",
    required: true,
    placeholder: "Orn: PS5 Slim / Series X / Switch OLED",
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
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "controllerCount",
    label: "Kumanda sayisi",
    type: "number",
    required: false,
    min: 0,
    max: 10,
  },
  {
    key: "accessories",
    label: "Aksesuarlar / Ek parcalar",
    type: "text",
    required: false,
    placeholder: "Orn: 2. kontrolcu, dock, HDMI",
  },
  {
    key: "purchaseYear",
    label: "Satin alma yili",
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
    options: ["Devam ediyor", "Bitmis", "Bilinmiyor"],
  },
  {
    key: "usageLevel",
    label: "Kullanim yogunlugu",
    type: "select",
    required: false,
    options: ["Az", "Orta", "Yogun"],
  },
  {
    key: "batteryHealth",
    label: "Pil sagligi",
    type: "select",
    required: false,
    options: ["Cok iyi", "Iyi", "Orta", "Zayif", "Bilinmiyor"],
  },
  {
    key: "screenCondition",
    label: "Ekran durumu",
    type: "select",
    required: false,
    options: ["Ciziksiz", "Hafif cizik", "Belirgin cizik", "Kirik", "Bilinmiyor"],
  },
  {
    key: "stickDrift",
    label: "Stick drift var mi?",
    type: "select",
    required: false,
    options: ["Yok", "Var", "Bilinmiyor"],
  },
];

const TEMPLATE_CONSOLE_GAME: SchemaField[] = [
  {
    key: "platform",
    label: "Platform",
    type: "select",
    required: true,
    options: ["PS5", "PS4", "Xbox Series", "Xbox One", "Switch", "PC", "Diger"],
  },
  {
    key: "format",
    label: "Format",
    type: "select",
    required: true,
    options: ["Disk", "Kartus", "Dijital Kod", "DLC / Season Pass", "Koleksiyon / Steelbook"],
  },
  {
    key: "region",
    label: "Bolge",
    type: "select",
    required: false,
    options: ["PAL", "NTSC-U", "NTSC-J", "Bilinmiyor"],
  },
  {
    key: "language",
    label: "Oyun dili",
    type: "select",
    required: false,
    options: ["Turkce", "Ingilizce", "Karisik", "Bilinmiyor"],
  },
  {
    key: "discCondition",
    label: "Disk/Kartus kondisyonu",
    type: "select",
    required: false,
    options: ["Ciziksiz", "Hafif cizik", "Belirgin cizik", "Bilinmiyor"],
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_RETRO_MIXED: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: ["Retro Konsol", "Retro Oyun", "Aksesuar / Parca", "Diger"],
  },
  {
    key: "platform",
    label: "Platform",
    type: "select",
    required: false,
    options: [
      "Atari",
      "NES",
      "SNES",
      "Sega Master System",
      "Sega Mega Drive",
      "PS1",
      "PS2",
      "Nintendo 64",
      "GameCube",
      "Diger",
    ],
  },
  {
    key: "format",
    label: "Format",
    type: "select",
    required: false,
    options: ["Kartus", "Disk", "Kaset", "Dijital Kod", "Diger"],
  },
  {
    key: "region",
    label: "Bolge",
    type: "select",
    required: false,
    options: ["PAL", "NTSC-U", "NTSC-J", "Bilinmiyor"],
  },
  {
    key: "works",
    label: "Calisiyor mu?",
    type: "boolean",
    required: false,
  },
  {
    key: "modded",
    label: "Modlu mu?",
    type: "boolean",
    required: false,
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_TCG: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: [
      "Tekli Kart",
      "Deck / Structure Deck",
      "Booster / Pack",
      "Booster Box",
      "Koleksiyon / Lot",
      "Aksesuar",
    ],
  },
  {
    key: "tcgName",
    label: "TCG",
    type: "select",
    required: false,
    options: [
      "Pokemon",
      "Yu-Gi-Oh!",
      "Magic: The Gathering",
      "One Piece",
      "Lorcana",
      "Diger",
    ],
  },
  {
    key: "setName",
    label: "Set / Seri",
    type: "text",
    required: false,
    placeholder: "Orn: Scarlet & Violet",
  },
  {
    key: "cardCondition",
    label: "Kart kondisyonu",
    type: "select",
    required: false,
    options: ["Mint", "Near Mint", "Excellent", "Good", "Played", "Poor"],
  },
  {
    key: "graded",
    label: "Graded mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "gradeCompany",
    label: "Grading firmasi",
    type: "select",
    required: false,
    options: ["PSA", "BGS", "CGC", "Diger"],
  },
  {
    key: "gradeScore",
    label: "Grade puani",
    type: "number",
    required: false,
    min: 1,
    max: 10,
  },
  {
    key: "accessoryType",
    label: "Aksesuar tipi",
    type: "select",
    required: false,
    options: ["Sleeve", "Binder", "Deck Box", "Playmat", "Token/Zar", "Diger"],
  },
  {
    key: "language",
    label: "Dil",
    type: "select",
    required: false,
    options: ["Turkce", "Ingilizce", "Japonca", "Karisik", "Diger"],
  },
];

const TEMPLATE_FIGURE: SchemaField[] = [
  {
    key: "figureType",
    label: "Figur tipi",
    type: "select",
    required: true,
    options: ["Action Figure", "Statue/Bust", "Funko", "Model Kit", "Diger"],
  },
  {
    key: "brand",
    label: "Marka",
    type: "text",
    required: false,
    placeholder: "Orn: Bandai / Hasbro / Good Smile",
  },
  {
    key: "series",
    label: "Seri / Evren",
    type: "text",
    required: false,
    placeholder: "Orn: Marvel / Star Wars / Anime",
  },
  {
    key: "scale",
    label: "Olcek",
    type: "select",
    required: false,
    options: ["1/12", "1/10", "1/8", "1/6", "N/A"],
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "accessoriesFull",
    label: "Tum parcalar var mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_MINIATURE_WARGAME: SchemaField[] = [
  {
    key: "system",
    label: "Sistem / Oyun",
    type: "text",
    required: false,
    placeholder: "Orn: Warhammer 40K / AoS",
  },
  {
    key: "faction",
    label: "Faction",
    type: "text",
    required: false,
    placeholder: "Orn: Space Marines",
  },
  {
    key: "scale",
    label: "Olcek",
    type: "select",
    required: false,
    options: ["15mm", "28mm", "32mm", "54mm", "Diger"],
  },
  {
    key: "painted",
    label: "Boyali mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "assembled",
    label: "Montajli mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "material",
    label: "Malzeme",
    type: "select",
    required: false,
    options: ["Plastik", "Recine", "Metal", "Diger"],
  },
];

const TEMPLATE_RPG: SchemaField[] = [
  {
    key: "system",
    label: "Sistem",
    type: "text",
    required: true,
    placeholder: "Orn: D&D 5e / Pathfinder",
  },
  {
    key: "productType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: [
      "Core Rulebook",
      "Adventure Module",
      "Supplement",
      "Starter Set",
      "Dice/Accessory",
      "Diger",
    ],
  },
  {
    key: "edition",
    label: "Edition / Versiyon",
    type: "text",
    required: false,
  },
  {
    key: "language",
    label: "Dil",
    type: "select",
    required: false,
    options: ["Turkce", "Ingilizce", "Diger"],
  },
  {
    key: "hardcover",
    label: "Ciltli mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "completeContent",
    label: "Icerik tam mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_BOOK_GUIDE: SchemaField[] = [
  {
    key: "bookType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: ["Strateji Rehberi", "Artbook", "Lore Kitabi", "Roman/Comic", "Diger"],
  },
  {
    key: "title",
    label: "Kitap adi",
    type: "text",
    required: false,
  },
  {
    key: "language",
    label: "Dil",
    type: "select",
    required: false,
    options: ["Turkce", "Ingilizce", "Diger"],
  },
  {
    key: "coverType",
    label: "Kapak tipi",
    type: "select",
    required: false,
    options: ["Ciltli", "Karton Kapak", "Bilinmiyor"],
  },
  {
    key: "pageCondition",
    label: "Sayfa durumu",
    type: "select",
    required: false,
    options: ["Temiz", "Notlu/Cizili", "Yipranmis", "Bilinmiyor"],
  },
];

const TEMPLATE_PUZZLE: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: ["Puzzle", "3D Puzzle", "Zeka Oyunu", "Rubik/Twist", "Diger"],
  },
  {
    key: "pieceCount",
    label: "Parca sayisi",
    type: "number",
    required: false,
    min: 10,
    max: 50000,
  },
  {
    key: "completeContent",
    label: "Eksiksiz mi?",
    type: "boolean",
    required: true,
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_ACCESSORY: SchemaField[] = [
  {
    key: "accessoryType",
    label: "Aksesuar tipi",
    type: "select",
    required: true,
    options: [
      "Controller/Gamepad",
      "Kablolar/Adaptor",
      "Dock/Sarj",
      "Headset/Mikrofon",
      "Depolama",
      "Diger",
    ],
  },
  {
    key: "compatibility",
    label: "Uyumluluk",
    type: "text",
    required: false,
    placeholder: "Orn: PS5 / Switch / PC",
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

const TEMPLATE_COLLECTIBLE: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: ["Figur", "Poster", "Steelbook", "Kart/Koleksiyon", "Dekor", "Diger"],
  },
  {
    key: "franchise",
    label: "Seri / Evren",
    type: "text",
    required: false,
    placeholder: "Orn: Zelda / Pokemon / Marvel",
  },
  {
    key: "brand",
    label: "Marka",
    type: "text",
    required: false,
  },
  {
    key: "material",
    label: "Malzeme",
    type: "select",
    required: false,
    options: ["Plastik", "Metal", "Kagit", "Kumas", "Diger"],
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "original",
    label: "Orijinal mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_LEGO_HOBBY: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: [
      "LEGO Set",
      "MiniFig / Parca",
      "Maket / Model Kit",
      "Puzzle",
      "Boyama / Hobi Ekipmani",
      "Diger",
    ],
  },
  {
    key: "themeSeries",
    label: "Tema / Seri",
    type: "text",
    required: false,
    placeholder: "Orn: Star Wars / City / Technic",
  },
  {
    key: "pieceCount",
    label: "Parca sayisi",
    type: "number",
    required: false,
    min: 1,
    max: 50000,
  },
  {
    key: "completeContent",
    label: "Icerik tam mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "original",
    label: "Orijinal mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_TECH: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: [
      "Retro Emulator Cihazi",
      "Mini PC",
      "Streaming Ekipmani",
      "Mod Ekipmani",
      "Depolama / Kart",
      "Diger",
    ],
  },
  {
    key: "platform",
    label: "Platform / Uyumluluk",
    type: "text",
    required: false,
    placeholder: "Orn: Windows / Linux / PS5 / Switch",
  },
  {
    key: "storage",
    label: "Depolama",
    type: "select",
    required: false,
    options: ["64GB", "128GB", "256GB", "512GB", "1TB", "2TB", "Yok / Belirsiz"],
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "warranty",
    label: "Garantili mi?",
    type: "boolean",
    required: false,
  },
  {
    key: "accessories",
    label: "Aksesuar / Ek parcalar",
    type: "text",
    required: false,
    placeholder: "Orn: Adaptör, kablo, stand, soğutucu",
  },
];

const TEMPLATE_VR: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: ["VR Baslik", "Controller", "Sensor/Base Station", "Aksesuar", "Diger"],
  },
  {
    key: "platform",
    label: "Platform",
    type: "select",
    required: false,
    options: ["PS5", "PS4", "PC", "Standalone", "Diger"],
  },
  {
    key: "storage",
    label: "Depolama",
    type: "select",
    required: false,
    options: ["64GB", "128GB", "256GB", "512GB", "Yok / Belirsiz"],
  },
  {
    key: "lensCondition",
    label: "Lens durumu",
    type: "select",
    required: false,
    options: ["Temiz", "Hafif cizik", "Belirgin cizik", "Bilinmiyor"],
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
];

const TEMPLATE_GENERIC: SchemaField[] = [
  {
    key: "itemType",
    label: "Urun tipi",
    type: "select",
    required: true,
    options: ["Genel Urun", "Aksesuar", "Koleksiyon", "Diger"],
  },
  {
    key: "brand",
    label: "Marka",
    type: "text",
    required: false,
  },
  {
    key: "compatibility",
    label: "Uyumluluk",
    type: "text",
    required: false,
    placeholder: "Orn: PS5 / Switch / PC / Masaustu",
  },
  {
    key: "material",
    label: "Malzeme",
    type: "text",
    required: false,
  },
  {
    key: "box",
    label: "Kutu var mi?",
    type: "boolean",
    required: false,
  },
];

/* =========================
   HELPERS
========================= */

function sanitizeKey(raw: string) {
  const n = safeString(raw, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0130I\u0131]/g, "i")
    .replace(/[\u015e\u015f]/g, "s")
    .replace(/[\u011e\u011f]/g, "g")
    .replace(/[\u00dc\u00fc]/g, "u")
    .replace(/[\u00d6\u00f6]/g, "o")
    .replace(/[\u00c7\u00e7]/g, "c");

  const key = n
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  if (!key) return "";
  return key[0].toLowerCase() + key.slice(1);
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
function foldTR(input: string) {
  return safeString(input, "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .trim();
}

function pickTemplateFields(categoryId: string, categoryLower: string): SchemaField[] {
  const id = foldTR(categoryId).replace(/_/g, "-");
  const c = foldTR(categoryLower);

  const hasInName = (...parts: string[]) =>
    parts.some((p) => c.includes(foldTR(p)));
  const hasInId = (...parts: string[]) =>
    parts.some((p) => id.includes(foldTR(p).replace(/\s+/g, "-")));

  // Öncelik: ID tabanlı eşleştirme (en güvenilir yol)
  if (hasInId("kutu-oyunlari")) return TEMPLATE_BOARDGAME;
  if (hasInId("konsol-oyunlari")) return TEMPLATE_CONSOLE_GAME;
  if (hasInId("konsollar", "el-konsollari")) return TEMPLATE_CONSOLE;
  if (hasInId("tcg", "koleksiyon-kart")) return TEMPLATE_TCG;
  if (hasInId("figur")) return TEMPLATE_FIGURE;
  if (hasInId("miniature", "wargame")) return TEMPLATE_MINIATURE_WARGAME;
  if (hasInId("masaustu-rpg", "rpg")) return TEMPLATE_RPG;
  if (hasInId("manga-cizgi-roman", "rehber", "kitap")) return TEMPLATE_BOOK_GUIDE;
  if (hasInId("lego-hobi")) return TEMPLATE_LEGO_HOBBY;
  if (hasInId("dekor-poster", "koleksiyon-urun", "koleksiyon")) return TEMPLATE_COLLECTIBLE;
  if (hasInId("teknoloji")) return TEMPLATE_TECH;
  if (hasInId("ekipman", "aksesuar")) return TEMPLATE_ACCESSORY;
  if (hasInId("puzzle", "zeka")) return TEMPLATE_PUZZLE;
  if (hasInId("vr", "sanal-gerceklik")) return TEMPLATE_VR;
  if (hasInId("diger")) return TEMPLATE_GENERIC;

  // Geriye uyumluluk: isim tabanlı eşleştirme
  if (hasInName("kutu oyun")) return TEMPLATE_BOARDGAME;
  if (hasInName("kart oyun")) return TEMPLATE_CARDGAME;

  if (hasInName("koleksiyon kart", "tcg")) return TEMPLATE_TCG;
  if (hasInName("retro oyun", "retro konsol")) return TEMPLATE_RETRO_MIXED;
  if (hasInName("konsol oyun")) return TEMPLATE_CONSOLE_GAME;

  if (hasInName("hobi ekipman", "ekipman", "oyun aksesuar", "aksesuar")) {
    return TEMPLATE_ACCESSORY;
  }
  if (hasInName("teknoloji", "retro emul", "mini pc", "stream")) {
    return TEMPLATE_TECH;
  }

  if (hasInName("el konsol", "konsollar", "konsol")) return TEMPLATE_CONSOLE;

  if (hasInName("vr", "sanal gerceklik")) return TEMPLATE_VR;

  if (hasInName("figur", "fig")) return TEMPLATE_FIGURE;
  if (hasInName("miniature", "wargame")) return TEMPLATE_MINIATURE_WARGAME;

  if (hasInName("masaustu rpg", "rpg")) return TEMPLATE_RPG;
  if (hasInName("rehber", "kitap", "manga", "cizgi roman", "light novel", "artbook")) {
    return TEMPLATE_BOOK_GUIDE;
  }

  if (hasInName("puzzle", "zeka")) return TEMPLATE_PUZZLE;
  if (hasInName("lego", "minifig", "gunpla")) return TEMPLATE_LEGO_HOBBY;

  if (hasInName("koleksiyon urun", "koleksiyon", "dekor", "poster")) {
    return TEMPLATE_COLLECTIBLE;
  }

  return TEMPLATE_GENERIC;
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
        const categoryLower = safeString(c.nameLower || c.name, "");
        const template = pickTemplateFields(c.id, categoryLower);
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
      devError("seedAllSchemasSingleButton error:", e);
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
