// app/new/page.tsx
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { getToken as getAppCheckToken } from "firebase/app-check";
import { appCheck, auth, db, storage } from "@/lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { getCategoriesCached } from "@/lib/catalogCache";
import { devError, devWarn, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath, slugifyTR } from "@/lib/listingUrl";

/* ================= TYPES ================= */

type Category = {
  id: string; // categories doc id
  name: string;
  nameLower?: string;
  slug?: string;
  enabled?: boolean;
  order?: number;
  parentId?: string | null;
};

type SubCategory = {
  id: string; // categories doc id
  name: string;
  nameLower?: string;
  slug?: string;
  parentId: string;
  enabled?: boolean;
  order?: number;
};

type PublicProfile = {
  onboardingCompleted?: boolean;
  name?: string;
  phone?: string;
  address?: string;
};

type PrivateProfile = {
  phone?: string;
  address?: string;
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
  options?: Array<string | { value: string; label: string }>;
};

/**
 * Schema:
 * Firestore:
 *   listingSchemas/{categoryId}
 */
type ListingSchemaDoc = {
  categoryId?: string;
  version: number;
  fields: SchemaField[];
};

export default function NewListingPage() {
    // ================= STATE =================
    const router = useRouter();
    // Kategoriler ve alt kategoriler
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
    const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
    const [categoryId, setCategoryId] = useState("");
    const [subCategoryId, setSubCategoryId] = useState("");
    // Schema
    const [schemaLoading, setSchemaLoading] = useState(false);
    const [schemaExists, setSchemaExists] = useState(false);
    const [schemaFields, setSchemaFields] = useState<SchemaField[]>([]);
    const [schemaVersion, setSchemaVersion] = useState(1);
    // Dinamik alanlar
    const [attributes, setAttributes] = useState<Record<string, any>>({});
    // Kullanıcı ve gate
    const [userId, setUserId] = useState<string | null>(null);
    const [profileSummary, setProfileSummary] = useState<PublicProfile | null>(null);
    const [gateAllowed, setGateAllowed] = useState(false);
    const [gateChecking, setGateChecking] = useState(true);
    const [gateMissingReasons, setGateMissingReasons] = useState<string[]>([]);
    // Form
    const [title, setTitle] = useState("");
    const [price, setPrice] = useState("");
    const [condition, setCondition] = useState("");
    const [description, setDescription] = useState("");
    const [isTradable, setIsTradable] = useState(false);
    const [isShippable, setIsShippable] = useState(false);
    // Dosyalar
    const [newFiles, setNewFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [preparingImages, setPreparingImages] = useState(false);
  const [prepareProgress, setPrepareProgress] = useState(0);
    // Diğer
    const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [debugInfo, setDebugInfo] = useState<{
    step: string;
    code: string;
    details?: Record<string, string>;
  } | null>(null);
    // Kategori türleri
    const selectedMainCategory = useMemo(
      () => allCategories.find((c) => c.id === categoryId && c.parentId == null) || null,
      [allCategories, categoryId]
    );
    const selectedMainCategorySlug = useMemo(
      () =>
        slugifyTR(
          selectedMainCategory?.slug ||
            selectedMainCategory?.nameLower ||
            selectedMainCategory?.name ||
            ""
        ),
      [selectedMainCategory]
    );

    const isBoardGameCategory = selectedMainCategorySlug === "kutu-oyunlari";
    const isConsoleCategory = selectedMainCategorySlug === "konsollar";
    const isHandheldCategory = selectedMainCategorySlug === "el-konsollari";
    const isConsoleGameCategory = selectedMainCategorySlug === "konsol-oyunlari";
    const isConsoleLike = isConsoleCategory || isHandheldCategory;

    // Sabit: schema zorunlu mu?
    const REQUIRE_SCHEMA = false; // Gerekirse true yap

    // Yardımcılar (örnek, eksik olanlar aşağıda tanımlanmalı)
    function safeString(val: any, fallback: string) {
      return typeof val === "string" ? val : fallback;
    }
    function isValidName(name: string) {
      return name.trim().length > 1;
    }
    function isValidPhone(phone: string) {
      return phone.trim().length > 8;
    }
    function isValidAddress(address: string) {
      return address.trim().length > 5;
    }
    function isEmptyValue(val: any, type: FieldType) {
      if (type === "boolean") return val !== true && val !== false;
      if (type === "multiselect") return !Array.isArray(val) || val.length === 0;
      return val == null || val === "";
    }
    function normalizeSpaces(str: string) {
      return str.replace(/\s+/g, " ").trim();
    }
    function cleanLocationToken(v: string) {
      return normalizeSpaces(v || "").replace(/^[-|/\\]+|[-|/\\]+$/g, "");
    }
    function isPostalCodeToken(v: string) {
      return /^\d{5}$/.test((v || "").trim());
    }
    function isCountryToken(v: string) {
      const n = cleanLocationToken(v).toLocaleLowerCase("tr-TR");
      return (
        n === "turkiye" ||
        n === "türkiye" ||
        n === "turkey" ||
        n === "turkiye cumhuriyeti" ||
        n === "türkiye cumhuriyeti"
      );
    }
    function isRegionToken(v: string) {
      const n = cleanLocationToken(v).toLocaleLowerCase("tr-TR");
      return n.includes("bölgesi") || n.includes("bolgesi") || n.includes("region");
    }
    function isUsefulLocationToken(v: string) {
      const token = cleanLocationToken(v);
      if (!token) return false;
      if (/^\d+$/.test(token)) return false;
      if (isCountryToken(token) || isRegionToken(token) || isPostalCodeToken(token)) {
        return false;
      }
      return true;
    }
    function clampString(val: any, max: number) {
      return normalizeSpaces(String(val || "")).slice(0, max);
    }
    function formatMaybeInt(val: string) {
      return val.replace(/[^0-9]/g, "");
    }
function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

type OptionLike = string | { value: string; label: string };

function normalizeOption(opt: OptionLike | any) {
  if (typeof opt === "string") return { value: opt, label: opt };
  if (opt && typeof opt === "object") {
    const value =
      "value" in opt
        ? String(opt.value ?? "")
        : String(opt.label ?? opt.name ?? "");
    const label =
      "label" in opt ? String(opt.label ?? value) : String(value);
    return { value, label };
  }
  const fallback = String(opt ?? "");
  return { value: fallback, label: fallback };
}

function normalizeOptions(list: OptionLike[] | undefined) {
  const raw = Array.isArray(list) ? list : [];
  return raw
    .map((opt) => normalizeOption(opt))
    .filter((opt) => opt.value !== "" || opt.label !== "");
}
    async function geocodeAddress(address: string) {
      const q = normalizeSpaces(address || "");
      if (!q) return null;
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.ok) return null;
        const lat = Number(data.lat);
        const lng = Number(data.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng, label: String(data.label || q) };
      } catch {
        return null;
      }
    }
    function extractCityDistrict(address: string) {
      const cleaned = normalizeSpaces(address || "");
      if (!cleaned) return { city: "", district: "" };

      const parts = cleaned
        .split(",")
        .map((p) => cleanLocationToken(p))
        .filter(Boolean);

      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const part = parts[i];
        if (!part.includes("/")) continue;
        const slashParts = part
          .split("/")
          .map((p) => cleanLocationToken(p))
          .filter(isUsefulLocationToken);
        const slashAlphaParts = slashParts.filter((p) =>
          /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(p)
        );
        if (slashAlphaParts.length >= 2) {
          const district = slashAlphaParts[slashAlphaParts.length - 2];
          const city = slashAlphaParts[slashAlphaParts.length - 1];
          return { city, district };
        }
      }

      const meaningful = parts.filter(isUsefulLocationToken);

      if (meaningful.length >= 2) {
        const district = meaningful[meaningful.length - 2];
        const city = meaningful[meaningful.length - 1];
        return { city, district };
      }

      return { city: meaningful[0] || "", district: "" };
    }
  // ...tüm state, fonksiyonlar ve JSX buraya taşındı...
  // ...dosyanın geri kalanı sadece bu fonksiyonun içinde olacak...
// ...component fonksiyonu içindeki kodlar burada devam ediyor...
  // Ürün durumu seçenekleri
  const conditionOptions = [
    { value: "", label: "Seç" },
    { value: "new", label: "Yeni / Açılmamış" },
    { value: "likeNew", label: "Çok İyi (Sıfır Ayarında)" },
    { value: "good", label: "İyi" },
    { value: "used", label: "Kullanılmış" },
    { value: "forParts", label: "Parça / Arızalı" },
  ];

  const conditionLabel = (
    v: "" | "new" | "likeNew" | "good" | "used" | "forParts"
  ) => {
    const x = conditionOptions.find((o) => o.value === v);
    return x ? x.label : "";
  };

  const sectionCardClass =
    "border border-[#ead8c5] rounded-2xl p-5 sm:p-6 bg-white/75 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]";
  const sectionTitleClass = "text-lg font-semibold text-[#3f2a1a]";
  const labelClass = "text-sm font-semibold text-[#5a4330]";
  const inputClass =
    "w-full border border-[#ead8c5] rounded-full px-4 py-2.5 text-sm text-[#3f2a1a] bg-white/80 placeholder:text-[#9b7b5a] focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#e7c49b]";
  const selectClass =
    "w-full border border-[#ead8c5] rounded-full px-4 py-2.5 text-sm text-[#3f2a1a] bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#e7c49b]";
  const selectMultiClass =
    "w-full border border-[#ead8c5] rounded-2xl px-4 py-2.5 text-sm text-[#3f2a1a] bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#e7c49b] min-h-[120px]";
  const textareaClass =
    "w-full border border-[#ead8c5] rounded-2xl px-4 py-3 text-sm text-[#3f2a1a] bg-white/80 placeholder:text-[#9b7b5a] focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#e7c49b] min-h-[140px]";
  const helperTextClass = "text-xs text-[#8a6a4f]";
  const mutedTextClass = "text-sm text-[#6b4b33]";

  const ToggleRow = ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
  }) => (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3">
      <div className="text-sm font-semibold text-[#5a4330]">{label}</div>
      <button
        type="button"
        onClick={() => !disabled && onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          value ? "bg-[#1f2a24]" : "bg-slate-300"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        aria-pressed={value}
        aria-label={label}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
            value ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );

  type ConsoleFieldVisibility = {
    consoleModel: boolean;
    storage: boolean;
    modded: boolean;
    box: boolean;
    controllerCount: boolean;
    accessories: boolean;
    purchaseYear: boolean;
    warrantyStatus: boolean;
    usageLevel: boolean;
    batteryHealth: boolean;
    screenCondition: boolean;
    stickDrift: boolean;
  };

  const consoleModelOptionsBySubCategoryId: Record<string, string[]> = {
    "konsollar__playstation": [
      "PS1",
      "PS2",
      "PS3",
      "PS3 Slim",
      "PS3 Super Slim",
      "PS4",
      "PS4 Slim",
      "PS4 Pro",
      "PS5",
      "PS5 Digital",
      "PS5 Slim",
      "Diğer",
    ],
    "konsollar__xbox": [
      "Xbox (2001)",
      "Xbox 360",
      "Xbox 360 Slim",
      "Xbox 360 E",
      "Xbox One",
      "Xbox One S",
      "Xbox One X",
      "Xbox Series S",
      "Xbox Series X",
      "Diğer",
    ],
    "konsollar__nintendo": [
      "NES",
      "SNES",
      "Nintendo 64",
      "GameCube",
      "Wii",
      "Wii U",
      "Switch",
      "Switch Lite",
      "Switch OLED",
      "Diğer",
    ],
    // Eski yapı (geriye uyumluluk)
    "konsollar__handheld": [
      "Switch",
      "Switch Lite",
      "Switch OLED",
      "Steam Deck",
      "ROG Ally",
      "Legion Go",
      "Nintendo DS",
      "Nintendo 3DS",
      "PSP",
      "PS Vita",
      "Game Boy",
      "Game Boy Advance",
      "Diğer",
    ],
    "konsollar__retro": [
      "Atari 2600",
      "Sega Master System",
      "Sega Mega Drive",
      "Sega Saturn",
      "Sega Dreamcast",
      "Neo Geo",
      "Diğer",
    ],
    "konsollar__vr": [
      "PS VR",
      "PS VR2",
      "Meta Quest 2",
      "Meta Quest 3",
      "Valve Index",
      "HTC Vive",
      "Diğer",
    ],
    "konsollar__parca-servis": [
      "PlayStation",
      "Xbox",
      "Nintendo",
      "Genel / Çoklu",
      "Diğer",
    ],
    "el-konsollari__nintendo": [
      "Switch",
      "Switch Lite",
      "Switch OLED",
      "Nintendo DS",
      "Nintendo 3DS",
      "Game Boy",
      "Game Boy Color",
      "Game Boy Advance",
      "Diğer",
    ],
    "el-konsollari__playstation": ["PSP", "PS Vita", "Diğer"],
    "el-konsollari__pc": [
      "Steam Deck",
      "ROG Ally",
      "Legion Go",
      "Ayaneo",
      "GPD Win",
      "Diğer",
    ],
    "el-konsollari__retro": [
      "Game Gear",
      "Atari Lynx",
      "Neo Geo Pocket",
      "WonderSwan",
      "Diğer",
    ],
    "el-konsollari__parca-servis": [
      "Nintendo",
      "PlayStation",
      "PC / Windows",
      "Genel / Çoklu",
      "Diğer",
    ],
  };

  const getConsoleSubGroup = (subId: string) => {
    if (!subId) return "";
    if (subId.startsWith("konsollar__")) {
      return subId.replace("konsollar__", "");
    }
    if (subId.startsWith("el-konsollari__")) {
      return subId.replace("el-konsollari__", "");
    }
    const subName = subCategories.find((s) => s.id === subId)?.name || "";
    const n = subName.toLocaleLowerCase("tr-TR");
    if (n.includes("playstation")) return "playstation";
    if (n.includes("xbox")) return "xbox";
    if (n.includes("nintendo")) return "nintendo";
    if (n.includes("pc") || n.includes("windows")) return "pc";
    if (n.includes("taşınabilir") || n.includes("handheld") || n.includes("el konsol"))
      return "handheld";
    if (n.includes("retro")) return "retro";
    if (n.includes("vr")) return "vr";
    if (n.includes("parça") || n.includes("servis") || n.includes("tamir"))
      return "parca-servis";
    return "";
  };

  const consoleModelOptions = (() => {
    if (!isConsoleLike || !subCategoryId) return [];
    const byId = consoleModelOptionsBySubCategoryId[subCategoryId];
    if (byId && byId.length > 0) return byId;

    const group = getConsoleSubGroup(subCategoryId);
    if (
      group === "handheld" &&
      consoleModelOptionsBySubCategoryId["konsollar__handheld"]
    ) {
      return consoleModelOptionsBySubCategoryId["konsollar__handheld"];
    }
    const prefix = subCategoryId.startsWith("el-konsollari__")
      ? "el-konsollari"
      : subCategoryId.startsWith("konsollar__")
        ? "konsollar"
        : isHandheldCategory
          ? "el-konsollari"
          : "konsollar";
    const groupId = group ? `${prefix}__${group}` : "";
    if (groupId && consoleModelOptionsBySubCategoryId[groupId]) {
      return consoleModelOptionsBySubCategoryId[groupId];
    }

    return ["Diğer"];
  })();

  const getConsoleFieldVisibilityForSub = (
    subId: string
  ): ConsoleFieldVisibility => {
    const base: ConsoleFieldVisibility = {
      consoleModel: true,
      storage: true,
      modded: true,
      box: true,
      controllerCount: true,
      accessories: true,
      purchaseYear: true,
      warrantyStatus: true,
      usageLevel: true,
      batteryHealth: false,
      screenCondition: false,
      stickDrift: false,
    };

    const group = getConsoleSubGroup(subId);
    if (group === "parca-servis") {
      return {
        consoleModel: true,
        storage: false,
        modded: false,
        box: false,
        controllerCount: false,
        accessories: true,
        purchaseYear: false,
        warrantyStatus: false,
        usageLevel: false,
        batteryHealth: false,
        screenCondition: false,
        stickDrift: false,
      };
    }

    const handheld = isHandheldCategory || group === "handheld";
    let next = base;

    if (handheld) {
      next = {
        ...next,
        controllerCount: false,
        batteryHealth: true,
        screenCondition: true,
        stickDrift: true,
      };
    }

    if (group === "vr") {
      next = {
        ...next,
        modded: false,
      };
    }

    if (group === "retro") {
      next = {
        ...next,
        storage: false,
        warrantyStatus: false,
      };
    }

    return next;
  };

  const consoleAttrKeys = [
    "consoleModel",
    "storage",
    "modded",
    "box",
    "controllerCount",
    "accessories",
    "purchaseYear",
    "warrantyStatus",
    "usageLevel",
    "batteryHealth",
    "screenCondition",
    "stickDrift",
    "consoleBrand",
    "region",
    "firmwareVersion",
    "onlineStatus",
  ];

  const consoleExtraAttrKeys = consoleAttrKeys.filter(
    (key) =>
      key !== "consoleBrand" &&
      key !== "region" &&
      key !== "firmwareVersion" &&
      key !== "onlineStatus"
  );

  const boardgameAttrKeys = [
    "gameName",
    "minPlayers",
    "maxPlayers",
    "minPlaytime",
    "maxPlaytime",
    "suggestedAge",
    "language",
    "completeContent",
    "sleeved",
  ];

  const boardgameSchemaAliases: Record<string, string> = {
    playersMin: "minPlayers",
    playersMax: "maxPlayers",
    playTimeMin: "minPlaytime",
    playTimeMax: "maxPlaytime",
    age: "suggestedAge",
    componentsFull: "completeContent",
  };

  const boardgameLegacyKeys = Object.keys(boardgameSchemaAliases);

  const handheldConsoleModels = new Set<string>([
    "Switch",
    "Switch Lite",
    "Switch OLED",
    "Steam Deck",
    "ROG Ally",
    "Legion Go",
    "Nintendo DS",
    "Nintendo 3DS",
    "PSP",
    "PS Vita",
    "Game Boy",
    "Game Boy Color",
    "Game Boy Advance",
  ]);

  const isHandheldModel =
    isConsoleLike &&
    handheldConsoleModels.has(String(attributes.consoleModel || ""));

  const consoleFieldVisibility = (() => {
    if (!isConsoleLike) return null;
    const base = getConsoleFieldVisibilityForSub(subCategoryId);
    if (!base) return null;
    if (!isHandheldModel) return base;
    return {
      ...base,
      batteryHealth: true,
      screenCondition: true,
      stickDrift: true,
    };
  })();

  const schemaFieldsToRender = useMemo(() => {
    if (!schemaExists || schemaFields.length === 0) return [];

    const formatNorm = String(attributes.format || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    const hidePhysicalOnlyConsoleGameFields =
      isConsoleGameCategory &&
      (formatNorm.includes("dijital") ||
        formatNorm.includes("digital") ||
        formatNorm.includes("dlc"));

    const skip = new Set<string>();

    if (isBoardGameCategory) {
      for (const key of boardgameAttrKeys) skip.add(key);
      for (const key of boardgameLegacyKeys) skip.add(key);
    }

    if (isConsoleLike) {
      for (const key of consoleAttrKeys) skip.add(key);
      skip.add("consoleBrand");
      skip.add("region");
      skip.add("firmwareVersion");
      skip.add("onlineStatus");
    }

    return schemaFields.filter((f) => {
      if (skip.has(f.key)) return false;
      if (
        hidePhysicalOnlyConsoleGameFields &&
        (f.key === "discCondition" || f.key === "box")
      ) {
        return false;
      }
      return true;
    });
  }, [
    schemaExists,
    schemaFields,
    isBoardGameCategory,
    isConsoleLike,
    isConsoleGameCategory,
    attributes.format,
    boardgameAttrKeys,
    boardgameLegacyKeys,
    consoleAttrKeys,
  ]);

  const isCategorySelectionComplete = Boolean(categoryId && subCategoryId);

  /* ================= AUTH + GATE CHECK ================= */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.uid);

      try {
        setGateChecking(true);

        const publicRef = doc(db, "publicProfiles", user.uid);
        const privateRef = doc(db, "privateProfiles", user.uid);
        const [publicSnap, privateSnap] = await Promise.all([
          getDoc(publicRef),
          getDoc(privateRef),
        ]);

        if (!publicSnap.exists()) {
          setProfileSummary({
            onboardingCompleted: false,
            name: "",
            phone: "",
            address: "",
          });

          setGateAllowed(false);
          router.replace("/my?onboarding=1");
          return;
        }

        const d = publicSnap.data() as any;
        const p = privateSnap.exists()
          ? (privateSnap.data() as PrivateProfile)
          : {};
        const mergedPhone = p.phone || d.phone || "";
        const mergedAddress = p.address || d.address || "";

        const summary: PublicProfile = {
          onboardingCompleted: !!d.onboardingCompleted,
          name: d.name || "",
          phone: mergedPhone,
          address: mergedAddress,
        };

        setProfileSummary(summary);

        const completed = summary.onboardingCompleted === true;

        const requiredOk =
          isValidName(summary.name || "") &&
          isValidPhone(summary.phone || "") &&
          isValidAddress(summary.address || "");

        if (!completed || !requiredOk) {
          setGateAllowed(false);
          router.replace("/my?onboarding=1");
          return;
        }

        setGateAllowed(true);
      } catch (err) {
        devError("Profile gate check error", err);
        setGateAllowed(false);
        setError(
          "Profil kontrolü sırasında hata oluştu. Lütfen /my sayfasına gidip profilini kontrol et."
        );
      } finally {
        setGateChecking(false);
      }
    });

    return () => unsub();
  }, [router]);

  /* ================= LOAD CATEGORIES (categories) ================= */

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const cached = await getCategoriesCached();
        const all = (cached || [])
          .map((d: any) => ({
            id: d.id,
            name: safeString(d.name, ""),
            nameLower: safeString(d.nameLower, ""),
            slug: safeString(d.slug, ""),
            enabled: d.enabled,
            order: d.order ?? 0,
            parentId: d.parentId ?? null,
          }))
          .filter((c) => c.enabled !== false);
        const list = all.filter((c) => c.parentId == null);
        if (!cancelled) {
          const safeInt = (v: any) =>
            Number.isFinite(Number(v)) ? Number(v) : 0;
          list.sort((a: any, b: any) => {
            const oa = safeInt(a.order);
            const ob = safeInt(b.order);
            if (oa !== ob) return oa - ob;
            return (a.name || "").localeCompare(b.name || "");
          });
          setAllCategories(all);
          setCategories(list);
        }
      } catch {
        if (!cancelled) {
          setAllCategories([]);
          setCategories([]);
        }
      }
    }

    loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ================= LOAD SUBCATEGORIES (categories) ================= */

  useEffect(() => {
    // kategori değişince reset
    setSubCategoryId("");
    setSubCategories([]);

    // schema reset
    setSchemaExists(false);
    setSchemaFields([]);
    setSchemaVersion(1);
    setAttributes({});

    if (!categoryId) return;

    const list = allCategories
      .filter((c) => c.parentId === categoryId && c.enabled !== false)
      .map((d) => ({
        id: d.id,
        name: safeString(d.name, ""),
        parentId: safeString(d.parentId, ""),
        nameLower: safeString((d as any).nameLower, ""),
        order: (d as any).order ?? 0,
        enabled: (d as any).enabled,
      }))
      .filter((s) => s.enabled !== false);

    const safeInt = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    list.sort((a: any, b: any) => {
      const oa = safeInt(a.order);
      const ob = safeInt(b.order);
      if (oa !== ob) return oa - ob;
      return (a.nameLower || a.name || "").localeCompare(
        b.nameLower || b.name || ""
      );
    });
    setSubCategories(list as any);
  }, [categoryId, allCategories]);

  /* ================= LOAD LISTING SCHEMA (CATEGORY BASED) ================= */

  useEffect(() => {
    if (!categoryId) {
      setSchemaExists(false);
      setSchemaFields([]);
      setSchemaVersion(1);
      setAttributes({});
      return;
    }

    let alive = true;

    const run = async () => {
      setSchemaLoading(true);

      try {
        const refSchema = doc(db, "listingSchemas", categoryId);
        const snap = await getDoc(refSchema);

        if (!alive) return;

        if (!snap.exists()) {
          setSchemaExists(false);
          setSchemaFields([]);
          setSchemaVersion(1);
          setAttributes({});
          return;
        }

        const d = snap.data() as ListingSchemaDoc;
        const fields = Array.isArray(d.fields) ? d.fields : [];

        setSchemaExists(true);
        setSchemaVersion(Number(d.version || 1) || 1);
        setSchemaFields(fields);

        // ✅ subcategory değişince attributes reset (en temiz)
        setAttributes({});
      } catch (err) {
        devError("Schema load error:", err);
        setSchemaExists(false);
        setSchemaFields([]);
        setSchemaVersion(1);
        setAttributes({});
      } finally {
        if (alive) setSchemaLoading(false);
      }
    };

    run();

    return () => {
      alive = false;
    };
  }, [categoryId]);

  useEffect(() => {
    if (!isConsoleLike) return;
    const isHandheldSub = subCategoryId.startsWith("konsollar__handheld");
    if (isHandheldCategory || isHandheldSub || isHandheldModel) return;

    setAttributes((prev) => {
      if (
        prev.batteryHealth == null &&
        prev.screenCondition == null &&
        prev.stickDrift == null
      ) {
        return prev;
      }
      const next = { ...prev };
      delete (next as any).batteryHealth;
      delete (next as any).screenCondition;
      delete (next as any).stickDrift;
      return next;
    });
  }, [isConsoleLike, isHandheldCategory, isHandheldModel, subCategoryId]);

  useEffect(() => {
    if (!isConsoleGameCategory) return;

    const formatNorm = String(attributes.format || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    const isDigital =
      formatNorm.includes("dijital") ||
      formatNorm.includes("digital") ||
      formatNorm.includes("dlc");

    if (!isDigital) return;

    setAttributes((prev) => {
      if (prev.discCondition == null && prev.box == null) {
        return prev;
      }
      const next = { ...prev };
      delete (next as any).discCondition;
      delete (next as any).box;
      return next;
    });
  }, [isConsoleGameCategory, attributes.format]);

  /* ================= ATTR HELPERS ================= */

  const setAttr = (key: string, value: any) => {
    setAttributes((prev) => ({ ...prev, [key]: value }));
  };

  const getAttrValueForSchemaKey = (key: string) => {
    if (isBoardGameCategory) {
      const alias = boardgameSchemaAliases[key];
      if (alias) return (attributes as any)[alias];
    }
    return (attributes as any)[key];
  };

  const validateDynamicFields = (): string => {
    if (!categoryId) return "";

    if (REQUIRE_SCHEMA && !schemaExists) {
      return "Bu kategori icin schema tanimlanmamis. Admin panelden schema olusturmalisin.";
    }

    if (!schemaExists) return "";

    const skipKeys = new Set<string>();
    if (isConsoleLike) {
      skipKeys.add("consoleBrand");
      skipKeys.add("region");
      skipKeys.add("firmwareVersion");
      skipKeys.add("onlineStatus");
    }

    for (const f of schemaFields) {
      if (skipKeys.has(f.key)) continue;
      const v = getAttrValueForSchemaKey(f.key);

      if (f.required && isEmptyValue(v, f.type)) {
        return `"${f.label}" alanı zorunlu.`;
      }

      if (isEmptyValue(v, f.type)) continue;

      if (f.type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) return `"${f.label}" sayı olmalı.`;
        if (f.min != null && n < f.min) return `"${f.label}" minimum ${f.min} olmalı.`;
        if (f.max != null && n > f.max) return `"${f.label}" maksimum ${f.max} olmalı.`;
      }

      if (f.type === "select") {
        const opts = normalizeOptions(f.options).map((o) => o.value);
        if (opts.length > 0 && !opts.includes(String(v))) {
          return `"${f.label}" geçersiz seçim.`;
        }
      }

      if (f.type === "multiselect") {
        const opts = normalizeOptions(f.options).map((o) => o.value);
        if (!Array.isArray(v)) return `"${f.label}" liste olmalı.`;
        if (opts.length > 0) {
          for (const item of v) {
            if (!opts.includes(String(item))) return `"${f.label}" içinde geçersiz seçim var.`;
          }
        }
      }

      if (f.type === "boolean") {
        if (v !== true && v !== false) return `"${f.label}" evet/hayır olmalı.`;
      }
    }

    return "";
  };

  const buildAttributesForSave = (): Record<string, any> => {
    const out: Record<string, any> = {};

    if (schemaExists) {
      for (const f of schemaFields) {
        const raw = getAttrValueForSchemaKey(f.key);

        if (isEmptyValue(raw, f.type)) continue;

        if (f.type === "number") {
          const n = Number(raw);
          if (Number.isFinite(n)) out[f.key] = n;
          continue;
        }

        if (f.type === "boolean") {
          if (raw === true || raw === false) out[f.key] = raw;
          continue;
        }

        if (f.type === "multiselect") {
          if (Array.isArray(raw)) out[f.key] = raw.map((x) => String(x));
          continue;
        }

        out[f.key] = String(raw);
      }
    }

    const mergeExtra = (keys: string[], types: Record<string, FieldType>) => {
      for (const key of keys) {
        if (key in out) continue;
        const raw = (attributes as any)[key];
        const t = types[key] || "text";
        if (isEmptyValue(raw, t)) continue;

        if (t === "number") {
          const n = Number(raw);
          if (Number.isFinite(n)) out[key] = n;
          continue;
        }

        if (t === "boolean") {
          if (raw === true || raw === false) out[key] = raw;
          continue;
        }

        if (t === "multiselect") {
          if (Array.isArray(raw)) out[key] = raw.map((x) => String(x));
          continue;
        }

        out[key] = String(raw);
      }
    };

    if (isBoardGameCategory) {
      mergeExtra(boardgameAttrKeys, {
        gameName: "text",
        minPlayers: "number",
        maxPlayers: "number",
        minPlaytime: "number",
        maxPlaytime: "number",
        suggestedAge: "select",
        language: "select",
        completeContent: "boolean",
        sleeved: "boolean",
      });
    }

    if (isConsoleLike) {
      mergeExtra(consoleExtraAttrKeys, {
        consoleModel: "text",
        storage: "select",
        modded: "boolean",
        box: "boolean",
        controllerCount: "number",
        accessories: "text",
        purchaseYear: "number",
        warrantyStatus: "select",
        usageLevel: "select",
        batteryHealth: "select",
        screenCondition: "select",
        stickDrift: "select",
      });
    }

    return out;
  };

  /* ================= FILE HELPERS ================= */

  const validateFiles = (files: File[]) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const maxSize = 3 * 1024 * 1024;

    for (const f of files) {
      if (!allowed.includes(f.type)) {
        return `Sadece JPG/PNG/WEBP yükleyebilirsin. Hatalı dosya: ${f.name}`;
      }
      if (f.size > maxSize) {
        return `Dosya çok büyük (max 3MB). Hatalı dosya: ${f.name}`;
      }
    }
    return "";
  };

  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
  const MAX_IMAGE_DIM = 2000;

  const readImageBitmap = (file: File) =>
    new Promise<ImageBitmap>((resolve, reject) => {
      createImageBitmap(file).then(resolve).catch(reject);
    });

  const canvasToBlob = (
    canvas: HTMLCanvasElement,
    type: string,
    quality?: number
  ) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("Blob oluşturulamadı."));
          else resolve(blob);
        },
        type,
        quality
      );
    });

  const buildFileName = (name: string, type: string) => {
    const base = name.replace(/\.[^/.]+$/, "");
    const ext =
      type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
    return `${base}.${ext}`;
  };

  const resizeToTarget = async (file: File) => {
    const bitmap = await readImageBitmap(file);
    const { width, height } = bitmap;

    const maxDim = Math.max(width, height);
    let scale = maxDim > MAX_IMAGE_DIM ? MAX_IMAGE_DIM / maxDim : 1;

    const targetType = file.type === "image/png" ? "image/webp" : "image/jpeg";
    const qualities = [0.9, 0.82, 0.74, 0.66];

    for (let attempt = 0; attempt < 4; attempt++) {
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context alınamadı.");
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      for (const q of qualities) {
        const blob = await canvasToBlob(canvas, targetType, q);
        if (blob.size <= MAX_IMAGE_BYTES) {
          return new File([blob], buildFileName(file.name, targetType), {
            type: targetType,
            lastModified: Date.now(),
          });
        }
      }

      scale *= 0.85;
    }

    throw new Error(
      `Görsel 3MB altına indirilemedi: ${file.name}. Daha küçük bir görsel deneyin.`
    );
  };

  const prepareImageFile = async (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      throw new Error(`Sadece JPG/PNG/WEBP yükleyebilirsin. Hatalı dosya: ${file.name}`);
    }

    if (file.size <= MAX_IMAGE_BYTES) {
      return file;
    }

    return resizeToTarget(file);
  };

  const onPickNewFiles = async (files: FileList | null) => {
    if (!files) return;

    const picked = Array.from(files);
    const allowedLeft = 5 - newFiles.length;
    const slice = picked.slice(0, Math.max(0, allowedLeft));
    if (slice.length === 0) return;

    try {
      setError("");
      setPreparingImages(true);
      setPrepareProgress(0);

      const prepared: File[] = [];
      for (let i = 0; i < slice.length; i++) {
        const file = slice[i];
        const ready = await prepareImageFile(file);
        prepared.push(ready);
        setPrepareProgress(Math.round(((i + 1) / slice.length) * 100));
      }

      setNewFiles((prev) => [...prev, ...prepared]);
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err, "Görsel hazırlanırken hata oluştu."));
    } finally {
      setPreparingImages(false);
      setPrepareProgress(0);
    }
  };

  const removeNewFileAt = (idx: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadFilesWithProgress = async (listingId: string, files: File[]) => {
    if (files.length === 0) return [];

    setUploading(true);
    setUploadProgress(0);

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const perFileTransferred: number[] = files.map(() => 0);
    const urls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const safeName = sanitizeFileName(file.name);
      const storagePath = `listings/${listingId}/${i}-${safeName}`;

      const storageRef = ref(storage, storagePath);
      const task = uploadBytesResumable(storageRef, file);

      const url: string = await new Promise((resolve, reject) => {
        task.on(
          "state_changed",
          (snap) => {
            perFileTransferred[i] = snap.bytesTransferred;
            const transferredTotal = perFileTransferred.reduce((s, v) => s + v, 0);
            const pct = totalBytes > 0 ? (transferredTotal / totalBytes) * 100 : 0;
            setUploadProgress(Math.min(100, Math.round(pct)));
          },
          (err) => reject(err),
          async () => {
            const downloadUrl = await getDownloadURL(task.snapshot.ref);
            resolve(downloadUrl);
          }
        );
      });

      urls.push(url);
    }

    setUploadProgress(100);
    setUploading(false);
    return urls;
  };

  /* ================= SUBMIT ================= */

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setDebugInfo(null);

    if (!userId) {
      setError("Giriş yapılmamış görünüyor.");
      return;
    }

    if (gateChecking) {
      setError("Profil kontrolü devam ediyor, lütfen birkaç saniye sonra dene.");
      return;
    }

    if (!gateAllowed) {
      setError("İlan verebilmek için önce profilini tamamlamalısın.");
      router.replace("/my?onboarding=1");
      return;
    }

    const cleanTitle = normalizeSpaces(title);
    const cleanPrice = price.trim();
    const cleanDescription = normalizeSpaces(description);

    if (!categoryId) {
      setError("Kategori seçmelisin.");
      return;
    }
    if (!subCategoryId) {
      setError("Alt kategori seçmelisin.");
      return;
    }

    // ✅ Schema validasyon
    const dynErr = validateDynamicFields();
    if (dynErr) {
      setError(dynErr);
      return;
    }

    if (!cleanTitle) {
      setError("İlan başlığı zorunlu.");
      return;
    }
    if (!cleanPrice) {
      setError("Fiyat zorunlu.");
      return;
    }
    if (!condition) {
      setError("Ürün durumu zorunlu.");
      return;
    }
    if (!cleanDescription) {
      setError("Açıklama zorunlu.");
      return;
    }

    if (newFiles.length === 0) {
      setError("En az 1 fotoğraf yüklemelisin.");
      return;
    }
    if (newFiles.length > 5) {
      setError("En fazla 5 fotoğraf yükleyebilirsin.");
      return;
    }

    const priceNumber = Number(cleanPrice);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      setError("Fiyat geçersiz görünüyor.");
      return;
    }

    const fileError = validateFiles(newFiles);
    if (fileError) {
      setError(fileError);
      return;
    }

    const category = categories.find((c) => c.id === categoryId);
    const subCategory = subCategories.find((s) => s.id === subCategoryId);

    if (!category || !subCategory) {
      setError("Kategori veya alt kategori hatalı.");
      return;
    }

    const safeTitle = clampString(cleanTitle, 120);
    const safeDescription = normalizeSpaces(cleanDescription);
    const safeCategoryId = String(categoryId || "").trim().slice(0, 128);
    const safeSubCategoryId = String(subCategoryId || "").trim().slice(0, 128);
    const safeCategoryName = clampString(category.name || "", 120);
    const safeSubCategoryName = clampString(subCategory.name || "", 120);

    if (!safeTitle) {
      setError("İlan başlığı zorunlu.");
      return;
    }
    if (!safeCategoryId) {
      setError("Kategori seçmelisin.");
      return;
    }
    if (!safeSubCategoryId) {
      setError("Alt kategori seçmelisin.");
      return;
    }
    if (!safeCategoryName || !safeSubCategoryName) {
      setError("Kategori adı okunamadı, lütfen tekrar seç.");
      return;
    }

    let failStep = "addDoc";
    let attributesForSave: Record<string, any> = {};
    let tokenResult: any = null;
    let appCheckStatus = "not-initialized";
    let appCheckExpire = "";
    let appCheckError = "";
    let appCheckTokenLen = "";
    let appCheckTokenPreview = "";
    let basePayload: Record<string, any> | null = null;
    try {
      setDebugInfo(null);
      setLoading(true);

      if (auth.currentUser) {
        try {
          await auth.currentUser.getIdToken(true);
        } catch (e) {
        devWarn("Token refresh failed:", e);
        }
      }

      attributesForSave = buildAttributesForSave();

      tokenResult = auth.currentUser
        ? await auth.currentUser.getIdTokenResult(true)
        : null;
      const tokenClaims: any = tokenResult?.claims || {};
      const tokenAud = String(tokenClaims.aud || "");
      const tokenIss = String(tokenClaims.iss || "");

      if (appCheck) {
        try {
          const appCheckToken = await getAppCheckToken(appCheck, false);
          const appCheckTokenAny = appCheckToken as any;
          if (appCheckToken?.token) {
            appCheckStatus = "present";
            appCheckTokenLen = String(appCheckToken.token.length);
            appCheckTokenPreview = `${appCheckToken.token.slice(
              0,
              8
            )}...${appCheckToken.token.slice(-6)}`;
            if (typeof appCheckTokenAny?.expireTimeMillis === "number") {
              appCheckExpire = new Date(appCheckTokenAny.expireTimeMillis).toISOString();
            }
          } else {
            appCheckStatus = "missing";
          }
        } catch (e: any) {
          appCheckStatus = "error";
          appCheckError = String(e?.code || e?.message || e);
        }
      } else {
        appCheckStatus = "not-enabled";
      }

      failStep = "precheckReads";
      const [profileSnap, userSnap, privateSnap] = await Promise.all([
        getDocFromServer(doc(db, "publicProfiles", userId)),
        getDocFromServer(doc(db, "users", userId)),
        getDocFromServer(doc(db, "privateProfiles", userId)),
      ]);

      if (profileSnap.metadata.fromCache || userSnap.metadata.fromCache) {
        setDebugInfo({
          step: "precheck",
          code: "server-read-from-cache",
          details: {
            profileFromCache: String(profileSnap.metadata.fromCache),
            userFromCache: String(userSnap.metadata.fromCache),
          },
        });
        setError(
          "Sunucudan profil verisi alınamadı. Lütfen sayfayı yenileyip tekrar dene."
        );
        setLoading(false);
        return;
      }

      const profileData = profileSnap.exists() ? (profileSnap.data() as any) : null;
      const profileOk =
        profileSnap.exists() && profileData?.onboardingCompleted === true;
      const userData = userSnap.exists() ? (userSnap.data() as any) : null;
      const privateData = privateSnap.exists() ? (privateSnap.data() as any) : null;
      const banUntilDate = userData?.banUntil?.toDate?.()
        ? userData.banUntil.toDate()
        : userData?.banUntil instanceof Date
        ? userData.banUntil
        : null;
      const isPermBanned = userData?.banStatus === "permanent";
      const isTempBanned =
        userData?.banStatus === "temporary" &&
        banUntilDate instanceof Date &&
        banUntilDate > new Date();
      const isBanned = isPermBanned || isTempBanned;
      const isBlockedListings = userData?.blockListings === true;

      const ruleChecks: Record<string, boolean> = {
        signedIn: !!auth.currentUser,
        onboardingCompleted: profileOk,
        notBanned: !isBanned,
        notBlockedListings: !isBlockedListings,
        ownerIdMatch: auth.currentUser?.uid === userId,
        tokenProjectMatch:
          !tokenAud ||
          tokenAud === String(db.app?.options?.projectId || "") ||
          tokenIss.includes(String(db.app?.options?.projectId || "")),
        titleOk: safeTitle.length > 0 && safeTitle.length <= 120,
        priceOk: Number.isFinite(priceNumber) && priceNumber >= 0,
        categoryIdOk: safeCategoryId.length > 0 && safeCategoryId.length <= 128,
        subCategoryIdOk:
          safeSubCategoryId.length > 0 && safeSubCategoryId.length <= 128,
        categoryNameOk:
          safeCategoryName.length > 0 && safeCategoryName.length <= 120,
        subCategoryNameOk:
          safeSubCategoryName.length > 0 && safeSubCategoryName.length <= 120,
        imageUrlsOk: true,
      };

      const failedChecks = Object.entries(ruleChecks)
        .filter(([, ok]) => !ok)
        .map(([key]) => key);

      if (failedChecks.length > 0) {
        setDebugInfo({
          step: "precheck",
          code: "rule-precheck-failed",
          details: {
            ...Object.fromEntries(
              Object.entries(ruleChecks).map(([k, v]) => [k, String(v)])
            ),
            banStatus: String(userData?.banStatus || ""),
            banUntil: banUntilDate ? banUntilDate.toISOString() : "",
            blockListings: String(!!isBlockedListings),
            tokenIssuer: String(tokenResult?.issuer || ""),
            appId: String(db.app?.options?.appId || ""),
            tokenAud,
            tokenIss,
            signInProvider: String(
              tokenResult?.signInProvider ||
                auth.currentUser?.providerData?.[0]?.providerId ||
                ""
            ),
            appCheckStatus,
            appCheckExpire,
            appCheckError,
            appCheckTokenLen,
            appCheckTokenPreview,
          },
        });
        setError(
          `İlan kuralları karşılanmıyor: ${failedChecks.join(", ")}`
        );
        setLoading(false);
        return;
      }

      failStep = "addDoc";
      const ownerId = auth.currentUser?.uid || userId;
      if (!ownerId) {
        setError("Oturum bilgisi alınamadı. Lütfen tekrar giriş yap.");
        setLoading(false);
        return;
      }

      const rawOwnerName =
        profileData?.displayName ||
        profileData?.name ||
        userData?.name ||
        auth.currentUser?.displayName ||
        (auth.currentUser?.email ? auth.currentUser.email.split("@")[0] : "");
      const safeOwnerName = String(rawOwnerName || "").trim().slice(0, 120);

      const rawAddress =
        privateData?.address ||
        profileData?.address ||
        userData?.address ||
        profileSummary?.address ||
        "";
      const locationAddress = normalizeSpaces(String(rawAddress || ""));
      const locationFromProfile = privateData?.location;
      let location = null as
        | { address: string; lat: number; lng: number }
        | null;

      if (
        locationFromProfile &&
        Number.isFinite(Number(locationFromProfile.lat)) &&
        Number.isFinite(Number(locationFromProfile.lng))
      ) {
        location = {
          lat: Number(locationFromProfile.lat),
          lng: Number(locationFromProfile.lng),
          address: String(
            locationFromProfile.address || locationAddress || ""
          ),
        };
      } else {
        const geo = locationAddress ? await geocodeAddress(locationAddress) : null;
        location =
          geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)
            ? { address: geo.label || locationAddress, lat: geo.lat, lng: geo.lng }
            : null;
      }

      const locationLabel = normalizeSpaces(
        String(location?.address || locationAddress || "")
      );
      const cityDistrict = extractCityDistrict(locationLabel);

      basePayload = {
        title: safeTitle,
        price: priceNumber,
        categoryId: safeCategoryId,
        categoryName: safeCategoryName,
        subCategoryId: safeSubCategoryId,
        subCategoryName: safeSubCategoryName,
        ownerId,
        ownerName: safeOwnerName,
        location: location,
        locationAddress: locationAddress || null,
        locationCity: cityDistrict.city || null,
        locationDistrict: cityDistrict.district || null,
      };

      failStep = "uploadImages";
      const listingRef = doc(collection(db, "listings"));
      const imageUrls = await uploadFilesWithProgress(listingRef.id, newFiles);

      failStep = "setDoc";
      await setDoc(listingRef, {
        ...basePayload,
        description: safeDescription,
        conditionKey: condition,
        conditionLabel: conditionLabel(
          condition as "" | "new" | "likeNew" | "good" | "used" | "forParts"
        ),
        isTradable,
        shippingAvailable: isShippable,

        // ✅ dynamic attributes (kategori bazli schema)
        schemaVersion: schemaExists ? schemaVersion : null,
        attributes: attributesForSave,

        status: "active",
        imageUrls,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      router.push(buildListingPath(listingRef.id, cleanTitle));
    } catch (err: any) {
      devError("Create listing error", err);

      const code = err?.code || "";
      const errMessage =
        typeof err?.message === "string" ? err.message : String(err || "");
      const errName = typeof err?.name === "string" ? err.name : "";
      const errCustom = err?.customData
        ? JSON.stringify(err.customData)
        : "";
      const debugDetails: Record<string, string> = {
        projectId: String(db.app?.options?.projectId || ""),
        appId: String(db.app?.options?.appId || ""),
        authDomain: String(db.app?.options?.authDomain || ""),
        authUid: auth.currentUser?.uid || "null",
        userId: userId || "null",
        tokenIssuer: String(tokenResult?.issuer || ""),
        tokenAud: String(tokenResult?.claims?.aud || ""),
        tokenIss: String(tokenResult?.claims?.iss || ""),
        errorName: errName,
        errorMessage: errMessage,
        errorCustomData: errCustom,
        signInProvider: String(
          tokenResult?.signInProvider ||
            auth.currentUser?.providerData?.[0]?.providerId ||
            ""
        ),
        gateAllowed: String(!!gateAllowed),
        profileSummaryCompleted: String(!!profileSummary?.onboardingCompleted),
        profileSummaryNameOk: String(isValidName(profileSummary?.name || "")),
        profileSummaryPhoneOk: String(isValidPhone(profileSummary?.phone || "")),
        profileSummaryAddressOk: String(isValidAddress(profileSummary?.address || "")),
        ownerIdMatch: String(auth.currentUser?.uid === userId),
        titleLen: String((safeTitle || "").length),
        priceNumber: String(priceNumber),
        categoryId: String(safeCategoryId || ""),
        categoryIdLen: String((safeCategoryId || "").length),
        categoryName: String(safeCategoryName || ""),
        categoryNameLen: String((safeCategoryName || "").length),
        subCategoryId: String(safeSubCategoryId || ""),
        subCategoryIdLen: String((safeSubCategoryId || "").length),
        subCategoryName: String(safeSubCategoryName || ""),
        subCategoryNameLen: String((safeSubCategoryName || "").length),
        conditionKey: String(condition || ""),
        conditionLabel: String(conditionLabel(condition as any) || ""),
        schemaVersion: String(schemaExists ? schemaVersion : "null"),
        attributesKeys: String(Object.keys(attributesForSave || {}).length),
        newFiles: String(newFiles.length),
        appCheckStatus,
        appCheckExpire,
        appCheckError,
        appCheckTokenLen,
        appCheckTokenPreview,
      };

      if (basePayload) {
        debugDetails.payloadOwnerId = String(basePayload.ownerId || "");
        debugDetails.payloadOwnerIdMatch = String(
          basePayload.ownerId === auth.currentUser?.uid
        );
        debugDetails.payloadPriceType = typeof basePayload.price;
        debugDetails.payloadHasLocation = String(!!basePayload.location);
        debugDetails.payloadCategoryNameType = typeof basePayload.categoryName;
        debugDetails.payloadSubCategoryNameType =
          typeof basePayload.subCategoryName;
      }

      if (code === "permission-denied" && userId) {
        try {
          const pSnap = await getDoc(doc(db, "publicProfiles", userId));
          debugDetails.profileDoc = pSnap.exists() ? "exists" : "missing";
          debugDetails.profileDocCompleted = String(
            pSnap.exists() ? pSnap.data()?.onboardingCompleted === true : false
          );
        } catch (e: any) {
          debugDetails.profileDoc = "read-failed";
        }

        try {
          const uSnap = await getDoc(doc(db, "users", userId));
          if (uSnap.exists()) {
            const u = uSnap.data() as any;
            debugDetails.userDoc = "exists";
            debugDetails.blockListings = String(!!u.blockListings);
            debugDetails.banStatus = String(u.banStatus || "");
            debugDetails.banUntil = u.banUntil?.toDate?.()
              ? u.banUntil.toDate().toISOString()
              : u.banUntil
              ? String(u.banUntil)
              : "";
          } else {
            debugDetails.userDoc = "missing";
          }
        } catch (e: any) {
          debugDetails.userDoc = "read-failed";
        }
      }

      setDebugInfo({
        step: typeof failStep === "string" ? failStep : "unknown",
        code: code || "unknown",
        details: debugDetails,
      });
      if (code === "permission-denied") {
        setError("Yetki hatası. Rules kontrol et veya profilini tamamla.");
      } else {
        setError("İlan eklenirken / resimler yüklenirken hata oluştu.");
      }

      setUploading(false);
    } finally {
      setLoading(false);
    }
  };

  /* ================= UI ================= */

  if (gateChecking) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] bg-[radial-gradient(circle_at_top,_#fff7ed,_#f7f4ef_55%)] px-4 py-10 flex items-center justify-center">
        <div className="w-full max-w-md bg-white/80 border border-[#ead8c5] rounded-2xl shadow-[0_20px_50px_-40px_rgba(15,23,42,0.45)] p-6 text-center">
          <div className="text-lg font-semibold text-[#3f2a1a]">
            Kontrol ediliyor...
          </div>
          <div className="text-sm text-[#6b4b33] mt-2">
            Profil bilgilerin doğrulanıyor.
          </div>
        </div>
      </div>
    );
  }

  if (!gateAllowed) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] bg-[radial-gradient(circle_at_top,_#fff7ed,_#f7f4ef_55%)] px-4 py-10 flex items-center justify-center">
        <div className="w-full max-w-md bg-white/80 border border-[#ead8c5] rounded-2xl shadow-[0_20px_50px_-40px_rgba(15,23,42,0.45)] p-6 text-center">
          <div className="text-lg font-semibold text-[#3f2a1a]">
            Profilini tamamlaman gerekiyor
          </div>
          <div className="text-sm text-[#6b4b33] mt-2">
            İlan verebilmek için önce profilinde zorunlu alanları doldurmalısın.
          </div>

          {profileSummary && (
            <div className="mt-4 text-sm bg-[#fff7ed] border border-[#ead8c5] rounded-xl p-4 text-left text-[#5a4330]">
              <div className="font-semibold mb-2 text-[#3f2a1a]">Eksikler</div>
              <ul className="list-disc pl-5 space-y-1">
                {gateMissingReasons.length === 0 ? (
                  <li>Onboarding tamamlanmamış görünüyor.</li>
                ) : (
                  gateMissingReasons.map((x, i) => <li key={i}>{x}</li>)
                )}
              </ul>
            </div>
          )}

          <button
            onClick={() => router.replace("/my?onboarding=1")}
            className="mt-5 w-full bg-[#1f2a24] hover:bg-[#2b3b32] text-white font-semibold py-3 rounded-full"
          >
            /my Sayfasına Git
          </button>
        </div>
      </div>
    );
  }

  return (

    <div className="min-h-screen bg-[#f7f4ef] bg-[radial-gradient(circle_at_top,_#fff7ed,_#f7f4ef_55%)] px-4 sm:px-6 py-8 sm:py-10">
      <div className="w-full max-w-5xl mx-auto bg-white/85 border border-[#ead8c5] rounded-3xl shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)] p-5 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#3f2a1a]">
              Yeni İlan Ekle
            </h1>
            <div className="text-xs sm:text-sm text-[#6b4b33] mt-1">
              Zorunlu alanlar dolmadan ilan yayınlanmaz.
            </div>
          </div>

          <button
            onClick={() => router.push("/")}
            className="text-xs sm:text-sm rounded-full border border-[#ead8c5] px-4 py-2 text-[#3f2a1a] hover:bg-[#f7ede2]"
            disabled={loading || uploading}
          >
            Vazgeç
          </button>
        </div>

        {error && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-2xl">
            {error}
            {debugInfo && (
              <div className="mt-2 text-xs text-rose-800">
                Debug: adım = <b>{debugInfo.step}</b>, kod ={" "}
                <b>{debugInfo.code}</b>
                {debugInfo.details && (
                  <div className="mt-1 text-[11px] text-rose-700 space-y-1">
                    {Object.entries(debugInfo.details).map(([k, v]) => (
                      <div key={k}>
                        {k}: <b>{v}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ================= CATEGORY ================= */}
          <div className={`${sectionCardClass} space-y-4`}>
            <div className={sectionTitleClass}>Kategori</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className={labelClass}>
                  Kategori <span className="text-red-600">*</span>
                </div>
                <select
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                  }}
                  className={selectClass}
                  disabled={loading || uploading}
                >
                  <option value="">Kategori seç</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className={labelClass}>
                  Alt kategori <span className="text-red-600">*</span>
                </div>
                <select
                  value={subCategoryId}
                  onChange={(e) => {
                    const nextSub = e.target.value;
                    setSubCategoryId(nextSub);
                    if (isConsoleLike) {
                      const visibility = getConsoleFieldVisibilityForSub(nextSub);
                      setAttributes((prev) => {
                        const next = { ...prev };
                        if (!nextSub) {
                          for (const key of consoleAttrKeys) {
                            delete (next as any)[key];
                          }
                          return next;
                        }

                        (next as any).consoleModel = "";
                        for (const key of consoleAttrKeys) {
                          if (key === "consoleModel") continue;
                          if (
                            key in visibility &&
                            !(visibility as any)[key]
                          ) {
                            delete (next as any)[key];
                            continue;
                          }
                          if (!(key in visibility)) {
                            delete (next as any)[key];
                          }
                        }
                        return next;
                      });
                    }
                  }}
                  className={selectClass}
                  disabled={!categoryId || loading || uploading}
                >
                  <option value="">
                    {categoryId ? "Alt kategori seç" : "Önce kategori seç"}
                  </option>
                  {subCategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Schema status intentionally hidden */}
          </div>

          {!isCategorySelectionComplete && (
            <div className={`${sectionCardClass} space-y-2`}>
              <div className={sectionTitleClass}>Kategori seçimi gerekli</div>
              <p className={mutedTextClass}>
                Devam etmek için önce kategori ve alt kategori seç.
              </p>
            </div>
          )}

          {isCategorySelectionComplete && (
            <>
          {/* Kutu Oyunları özel alanları: kategori seçilince göster */}
          {isBoardGameCategory && (
            <div className={`${sectionCardClass} space-y-4`}>
              <div className={sectionTitleClass}>Kutu Oyunu Bilgileri</div>
              <div className="mt-4">
                {/* Kategoriye özel alanlar: her zaman göster */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Oyunun Resmi Adı</label>
                    <input
                      value={attributes.gameName || ""}
                      onChange={e => setAttr("gameName", e.target.value)}
                      className={inputClass}
                      disabled={loading || uploading}
                    />
                  </div>
                  <div>
                    <div className={labelClass}>
                      Oyuncu Sayısı <span className="text-red-600">*</span>
                    </div>
                    <select
                      value={
                        attributes.minPlayers && attributes.maxPlayers
                          ? `${attributes.minPlayers}-${attributes.maxPlayers}`
                          : ""
                      }
                      onChange={(e) => {
                        const [min, max] = e.target.value.split("-");
                        setAttr("minPlayers", min || "");
                        setAttr("maxPlayers", max || "");
                      }}
                      className={selectClass}
                      required
                      disabled={loading || uploading}
                    >
                      <option value="">Seç</option>
                      <option value="1-2">1-2</option>
                      <option value="1-4">1-4</option>
                      <option value="2-4">2-4</option>
                      <option value="2-5">2-5</option>
                      <option value="2-6">2-6</option>
                      <option value="3-5">3-5</option>
                      <option value="3-6">3-6</option>
                      <option value="4-8">4-8</option>
                      <option value="5-10">5-10</option>
                      <option value="6-12">6-12</option>
                    </select>
                  </div>
                  <div>
                    <div className={labelClass}>Süre (dk)</div>
                    <select
                      value={
                        attributes.minPlaytime && attributes.maxPlaytime
                          ? `${attributes.minPlaytime}-${attributes.maxPlaytime}`
                          : ""
                      }
                      onChange={(e) => {
                        const [min, max] = e.target.value.split("-");
                        setAttr("minPlaytime", min || "");
                        setAttr("maxPlaytime", max || "");
                      }}
                      className={selectClass}
                      disabled={loading || uploading}
                    >
                      <option value="">Seç</option>
                      <option value="5-15">5-15</option>
                      <option value="10-30">15-30</option>
                      <option value="20-40">30-45</option>
                      <option value="45-60">45-60</option>
                      <option value="60-90">60-90</option>
                      <option value="90-120">90+</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Yaş Önerisi</label>
                    <select
                      value={
                        attributes.suggestedAge != null && attributes.suggestedAge !== ""
                          ? String(attributes.suggestedAge)
                          : ""
                      }
                      onChange={e => setAttr("suggestedAge", e.target.value)}
                      className={selectClass}
                      disabled={loading || uploading}
                    >
                      <option value="">Seç</option>
                      <option value="3">3+</option>
                      <option value="7">7+</option>
                      <option value="13">13+</option>
                      <option value="18">18+</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= BASIC + CONDITION ================= */}
          <div className={`${sectionCardClass} space-y-4`}>
            <div className={sectionTitleClass}>İlan Detayları</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className={labelClass}>
                  İlan başlığı <span className="text-red-600">*</span>
                </div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                  disabled={loading || uploading}
                  placeholder="Örn: Catan + Ek Paket / PS5 Kol / Pokémon kart"
                  maxLength={120}
                />
                <div className={helperTextClass}>
                  {normalizeSpaces(title).length}/120
                </div>
              </div>

              <div className="space-y-2">
                <div className={labelClass}>
                  Fiyat (TL) <span className="text-red-600">*</span>
                </div>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(formatMaybeInt(e.target.value))}
                  className={inputClass}
                  disabled={loading || uploading}
                  placeholder="Satış fiyatı"
                  min={0}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className={labelClass}>
                  Durum <span className="text-red-600">*</span>
                </div>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as any)}
                  className={selectClass}
                  disabled={loading || uploading}
                >
                  <option value="">Seç</option>
                  {conditionOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ToggleRow
                label="Takas edilebilir mi?"
                value={isTradable}
                onChange={setIsTradable}
                disabled={loading || uploading}
              />
              <ToggleRow
                label="Kargo için uygun mu?"
                value={isShippable}
                onChange={setIsShippable}
                disabled={loading || uploading}
              />
            </div>

            {isBoardGameCategory && (
              <div className="space-y-3">
                <div className={labelClass}>
                  Kutu Oyunu İlan Bilgileri
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className={labelClass}>Dil</div>
                    <select
                      value={attributes.language || ""}
                      onChange={(e) => setAttr("language", e.target.value)}
                      className={selectClass}
                      disabled={loading || uploading}
                    >
                      <option value="">Seç</option>
                      <option value="Türkçe">Türkçe</option>
                      <option value="İngilizce">İngilizce</option>
                      <option value="Almanca">Almanca</option>
                      <option value="Fransızca">Fransızca</option>
                      <option value="İtalyanca">İtalyanca</option>
                      <option value="İspanyolca">İspanyolca</option>
                      <option value="Diğer">Diğer</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className={labelClass}>
                      İçerik tam mı? <span className="text-red-600">*</span>
                    </div>
                    <select
                      value={
                        attributes.completeContent === true
                          ? "true"
                          : attributes.completeContent === false
                            ? "false"
                            : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setAttr("completeContent", v === "" ? "" : v === "true");
                      }}
                      className={selectClass}
                      required
                      disabled={loading || uploading}
                    >
                      <option value="">Seç</option>
                      <option value="true">Evet</option>
                      <option value="false">Hayır</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className={labelClass}>Sleeve kullanıldı mı?</div>
                    <select
                      value={
                        attributes.sleeved === true
                          ? "true"
                          : attributes.sleeved === false
                            ? "false"
                            : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setAttr("sleeved", v === "" ? "" : v === "true");
                      }}
                      className={selectClass}
                      disabled={loading || uploading}
                    >
                      <option value="">Seç</option>
                      <option value="true">Evet</option>
                      <option value="false">Hayır</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {isConsoleLike && (
              <div className="space-y-4">
                <div className={labelClass}>
                  {isHandheldCategory
                    ? "El Konsolu İlan Bilgileri"
                    : "Konsol İlan Bilgileri"}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {consoleFieldVisibility?.consoleModel && (
                    <div>
                      <div className={labelClass}>
                        Model / Sürüm <span className="text-red-600">*</span>
                      </div>
                      <select
                        value={attributes.consoleModel || ""}
                        onChange={(e) => setAttr("consoleModel", e.target.value)}
                        className={selectClass}
                        required
                        disabled={!subCategoryId || loading || uploading}
                      >
                        <option value="">
                          {subCategoryId ? "Seç" : "Önce alt kategori seç"}
                        </option>
                        {consoleModelOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {consoleFieldVisibility?.storage && (
                    <div>
                      <div className={labelClass}>Depolama</div>
                      <select
                        value={attributes.storage || ""}
                        onChange={(e) => setAttr("storage", e.target.value)}
                        className={selectClass}
                        disabled={loading || uploading}
                      >
                        <option value="">Seç</option>
                        <option value="32GB">32GB</option>
                        <option value="64GB">64GB</option>
                        <option value="128GB">128GB</option>
                        <option value="256GB">256GB</option>
                        <option value="512GB">512GB</option>
                        <option value="1TB">1TB</option>
                        <option value="2TB">2TB</option>
                        <option value="4TB">4TB</option>
                        <option value="Yok / Belirsiz">Yok / Belirsiz</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {consoleFieldVisibility?.modded && (
                    <div>
                      <div className={labelClass}>Modlu mu?</div>
                      <select
                        value={
                          attributes.modded === true
                            ? "true"
                            : attributes.modded === false
                              ? "false"
                              : ""
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setAttr("modded", v === "" ? "" : v === "true");
                        }}
                        className={selectClass}
                        disabled={loading || uploading}
                      >
                        <option value="">Seç</option>
                        <option value="true">Evet</option>
                        <option value="false">Hayır</option>
                      </select>
                    </div>
                  )}

                  {consoleFieldVisibility?.box && (
                    <div>
                      <div className={labelClass}>Kutu var mı?</div>
                      <select
                        value={
                          attributes.box === true
                            ? "true"
                            : attributes.box === false
                              ? "false"
                              : ""
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setAttr("box", v === "" ? "" : v === "true");
                        }}
                        className={selectClass}
                        disabled={loading || uploading}
                      >
                        <option value="">Seç</option>
                        <option value="true">Evet</option>
                        <option value="false">Hayır</option>
                      </select>
                    </div>
                  )}

                  {consoleFieldVisibility?.controllerCount && (
                    <div>
                      <div className={labelClass}>Kumanda sayısı</div>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={attributes.controllerCount || ""}
                        onChange={(e) =>
                          setAttr("controllerCount", formatMaybeInt(e.target.value))
                        }
                        className={inputClass}
                        disabled={loading || uploading}
                        placeholder="Örn: 1"
                      />
                    </div>
                  )}

                  {consoleFieldVisibility?.accessories && (
                    <div>
                      <div className={labelClass}>
                        Aksesuarlar / Ek parçalar
                      </div>
                      <input
                        value={attributes.accessories || ""}
                        onChange={(e) => setAttr("accessories", e.target.value)}
                        className={inputClass}
                        disabled={loading || uploading}
                        placeholder="Örn: 2. kontrolcü, dock, HDMI, şarj kablosu"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {consoleFieldVisibility?.purchaseYear && (
                    <div>
                      <div className={labelClass}>Satın alma yılı</div>
                      <input
                        type="number"
                        min={1980}
                        max={2100}
                        value={attributes.purchaseYear || ""}
                        onChange={(e) =>
                          setAttr("purchaseYear", formatMaybeInt(e.target.value))
                        }
                        className={inputClass}
                        disabled={loading || uploading}
                        placeholder="Örn: 2021"
                      />
                    </div>
                  )}

                  {consoleFieldVisibility?.warrantyStatus && (
                    <div>
                      <div className={labelClass}>Garanti durumu</div>
                      <select
                        value={attributes.warrantyStatus || ""}
                        onChange={(e) => setAttr("warrantyStatus", e.target.value)}
                        className={selectClass}
                        disabled={loading || uploading}
                      >
                        <option value="">Seç</option>
                        <option value="Devam ediyor">Devam ediyor</option>
                        <option value="Bitmiş">Bitmiş</option>
                        <option value="Bilinmiyor">Bilinmiyor</option>
                      </select>
                    </div>
                  )}

                  {consoleFieldVisibility?.usageLevel && (
                    <div>
                      <div className={labelClass}>Kullanım yoğunluğu</div>
                      <select
                        value={attributes.usageLevel || ""}
                        onChange={(e) => setAttr("usageLevel", e.target.value)}
                        className={selectClass}
                        disabled={loading || uploading}
                      >
                        <option value="">Seç</option>
                        <option value="Az">Az</option>
                        <option value="Orta">Orta</option>
                        <option value="Yoğun">Yoğun</option>
                      </select>
                    </div>
                  )}
                </div>

                {(consoleFieldVisibility?.batteryHealth ||
                  consoleFieldVisibility?.screenCondition ||
                  consoleFieldVisibility?.stickDrift) && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {consoleFieldVisibility?.batteryHealth && (
                        <div>
                          <div className={labelClass}>Pil sağlığı</div>
                          <select
                            value={attributes.batteryHealth || ""}
                            onChange={(e) =>
                              setAttr("batteryHealth", e.target.value)
                            }
                            className={selectClass}
                            disabled={loading || uploading}
                          >
                            <option value="">Seç</option>
                            <option value="Çok iyi">Çok iyi</option>
                            <option value="İyi">İyi</option>
                            <option value="Orta">Orta</option>
                            <option value="Zayıf">Zayıf</option>
                            <option value="Bilinmiyor">Bilinmiyor</option>
                          </select>
                        </div>
                      )}

                      {consoleFieldVisibility?.screenCondition && (
                        <div>
                          <div className={labelClass}>Ekran durumu</div>
                          <select
                            value={attributes.screenCondition || ""}
                            onChange={(e) =>
                              setAttr("screenCondition", e.target.value)
                            }
                            className={selectClass}
                            disabled={loading || uploading}
                          >
                            <option value="">Seç</option>
                            <option value="Çiziksiz">Çiziksiz</option>
                            <option value="Hafif çizik">Hafif çizik</option>
                            <option value="Belirgin çizik">Belirgin çizik</option>
                            <option value="Kırık">Kırık</option>
                            <option value="Bilinmiyor">Bilinmiyor</option>
                          </select>
                        </div>
                      )}

                      {consoleFieldVisibility?.stickDrift && (
                        <div>
                          <div className={labelClass}>
                            Stick drift var mı?
                          </div>
                          <select
                            value={attributes.stickDrift || ""}
                            onChange={(e) => setAttr("stickDrift", e.target.value)}
                            className={selectClass}
                            disabled={loading || uploading}
                          >
                            <option value="">Seç</option>
                            <option value="Yok">Yok</option>
                            <option value="Var">Var</option>
                            <option value="Bilinmiyor">Bilinmiyor</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className={helperTextClass}>
                      Not: El/taşınabilir konsollar için pil/ekran/stick alanlarını doldurabilirsin.
                    </div>
                  </>
                )}
              </div>
            )}

            {schemaExists && schemaFieldsToRender.length > 0 && (
              <div className="space-y-3">
                <div className={labelClass}>
                  Kategoriye Özel Alanlar
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {schemaFieldsToRender.map((f) => {
                    const raw = (attributes as any)[f.key];
                    const boolValue =
                      raw === true ? "true" : raw === false ? "false" : "";
                    const listValue = Array.isArray(raw) ? raw : [];
                    return (
                      <div key={f.key} className="space-y-2">
                        <div className={labelClass}>
                          {f.label}
                          {f.required && (
                            <span className="text-red-600"> *</span>
                          )}
                        </div>

                        {f.type === "text" && (
                          <input
                            value={raw || ""}
                            onChange={(e) => setAttr(f.key, e.target.value)}
                            className={inputClass}
                            disabled={loading || uploading}
                            placeholder={f.placeholder || ""}
                            required={f.required}
                          />
                        )}

                        {f.type === "number" && (
                          <input
                            type="number"
                            value={raw ?? ""}
                            onChange={(e) =>
                              setAttr(f.key, formatMaybeInt(e.target.value))
                            }
                            className={inputClass}
                            disabled={loading || uploading}
                            placeholder={f.placeholder || ""}
                            min={f.min ?? undefined}
                            max={f.max ?? undefined}
                            required={f.required}
                          />
                        )}

                        {f.type === "select" && (
                          <select
                            value={raw != null && raw !== "" ? String(raw) : ""}
                            onChange={(e) => setAttr(f.key, e.target.value)}
                            className={selectClass}
                            disabled={loading || uploading}
                            required={f.required}
                          >
                            <option value="">Seç</option>
                            {normalizeOptions(f.options).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        )}

                        {f.type === "boolean" && (
                          <select
                            value={boolValue}
                            onChange={(e) => {
                              const v = e.target.value;
                              setAttr(
                                f.key,
                                v === "" ? "" : v === "true"
                              );
                            }}
                            className={selectClass}
                            disabled={loading || uploading}
                            required={f.required}
                          >
                            <option value="">Seç</option>
                            <option value="true">Evet</option>
                            <option value="false">Hayır</option>
                          </select>
                        )}

                        {f.type === "multiselect" && (
                          <select
                            multiple
                            value={listValue}
                            onChange={(e) => {
                              const values = Array.from(
                                e.target.selectedOptions
                              ).map((o) => o.value);
                              setAttr(f.key, values);
                            }}
                            className={selectMultiClass}
                            disabled={loading || uploading}
                            required={f.required}
                          >
                            {normalizeOptions(f.options).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className={labelClass}>
                Açıklama <span className="text-red-600">*</span>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={textareaClass}
                disabled={loading || uploading}
                placeholder="Açıklama (zorunlu)"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className={labelClass}>
                    Fotoğraflar <span className="text-red-600">*</span>
                  </div>
                  <div className={mutedTextClass}>
                    En az 1, en fazla 5 fotoğraf. (Şu an: {newFiles.length})
                  </div>
                </div>

                <div className={helperTextClass}>
                  {newFiles.length >= 5
                    ? "Limit doldu."
                    : `Kalan: ${5 - newFiles.length}`}
                </div>
              </div>

              <label
                className={`block rounded-2xl border-2 border-dashed border-[#ead8c5] bg-white/70 p-6 text-center cursor-pointer transition ${
                  loading || uploading || preparingImages || newFiles.length >= 5
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-[#fff7ed]"
                }`}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={(e) => onPickNewFiles(e.target.files)}
                    disabled={loading || uploading || preparingImages || newFiles.length >= 5}
                />

                <div className="text-base font-semibold text-[#3f2a1a]">
                  📸 Fotoğraf Seç
                </div>
                <div className="text-xs text-[#8a6a4f] mt-1">
                  JPG / PNG / WEBP — max 3MB — İlan yayınlanırken yüklenecek
                </div>
              </label>

              {newFiles.length > 0 && (
                <div className="space-y-2">
                  <div className={helperTextClass}>Seçilen fotoğraflar:</div>

                  <div className="space-y-2">
                    {newFiles.map((f, i) => (
                      <div
                        key={`${f.name}-${i}`}
                        className="flex items-center justify-between gap-3 border border-[#ead8c5] rounded-xl px-3 py-2 bg-white/70"
                      >
                        <div className="text-sm truncate text-[#3f2a1a]">
                          {f.name}{" "}
                          <span className="text-xs text-[#8a6a4f]">
                            ({Math.round(f.size / 1024)} KB)
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeNewFileAt(i)}
                          className="text-xs text-rose-700 underline"
                          disabled={loading || uploading || preparingImages}
                        >
                          Kaldır
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uploading && (
                <div className="space-y-2">
                  <div className="text-sm text-[#5a4330]">
                    Resimler yükleniyor: %{uploadProgress}
                  </div>
                  <div className="w-full h-3 bg-[#f1e5d6] rounded-full">
                    <div
                      className="h-3 bg-[#1f2a24] rounded-full"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {preparingImages && (
                <div className="space-y-2">
                  <div className="text-sm text-[#5a4330]">
                    Resimler hazırlanıyor: %{prepareProgress}
                  </div>
                  <div className="w-full h-3 bg-[#f1e5d6] rounded-full">
                    <div
                      className="h-3 bg-[#8a6a4f] rounded-full"
                      style={{ width: `${prepareProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ================= ACTIONS ================= */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={
                !isCategorySelectionComplete ||
                loading ||
                uploading ||
                preparingImages
              }
              className="flex-1 bg-[#1f2a24] hover:bg-[#2b3b32] text-white font-semibold py-3 rounded-full disabled:opacity-50"
            >
              {uploading
                ? `Yükleniyor... %${uploadProgress}`
                : loading
                ? "Ekleniyor..."
                : "İlanı Yayınla"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/")}
              disabled={loading || uploading || preparingImages}
              className="flex-1 border border-[#ead8c5] text-[#3f2a1a] rounded-full py-3 font-semibold hover:bg-[#f7ede2] disabled:opacity-50"
            >
              Vazgeç
            </button>
          </div>

          <div className={helperTextClass}>
            Not: Bu sayfada şema{" "}
            <b>{REQUIRE_SCHEMA ? "zorunlu" : "opsiyonel"}</b>. Şema yoksa{" "}
            {REQUIRE_SCHEMA ? "ilan yayınlayamazsın." : "dinamik alanlar gelmez."}
          </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
