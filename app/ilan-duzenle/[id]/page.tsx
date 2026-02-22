
"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { getCategoriesCached } from "@/lib/catalogCache";
import { devError, devWarn, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath, slugifyTR } from "@/lib/listingUrl";
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

/* ================= TYPES ================= */

type Listing = {
  title?: string;
  price?: number;
  description?: string;

  categoryId?: string;
  categoryName?: string;
  subCategoryId?: string;
  subCategoryName?: string;

  brandId?: string;
  brandName?: string;
  modelId?: string;
  modelName?: string;

  conditionKey?: string;
  conditionLabel?: string;
  isTradable?: boolean;
  shippingAvailable?: boolean;

  attributes?: Record<string, any>;
  imageUrls?: string[];

  ownerId?: string;
  ownerName?: string;
  createdAt?: any;
  updatedAt?: any;
  schemaVersion?: number | null;
};

type Category = {
  id: string;
  name: string;
  nameLower?: string;
  parentId?: string | null;
  order?: number;
  enabled?: boolean;
};

type PublicProfileGate = {
  onboardingCompleted?: boolean;
  name?: string;
  phone?: string;
  address?: string;
};

/* ================= HELPERS ================= */

const normalizeSpaces = (v: string) => (v || "").replace(/\s+/g, " ").trim();

const formatMaybeInt = (v: string) => {
  const t = v.trim();
  if (!t) return "";
  return t.replace(/[^\d]/g, "");
};

const isValidName = (name: string) => name.trim().length > 1;
const isValidPhone = (phone: string) => phone.trim().length > 8;
const isValidAddress = (address: string) => address.trim().length > 5;

const sanitizeFileName = (name: string) =>
  name.replace(/[^a-zA-Z0-9_.-]/g, "_");

const storagePathFromUrl = (url: string) => {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/\/o\/(.*?)\?/);
    if (!match || !match[1]) return null;
    return match[1];
  } catch {
    return null;
  }
};

const validateFiles = (files: File[]) => {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  const maxSize = 8 * 1024 * 1024; // 8MB

  for (const f of files) {
    if (!allowed.includes(f.type)) {
      return `Sadece JPG/PNG/WEBP yükleyebilirsin. Hatalı dosya: ${f.name}`;
    }
    if (f.size > maxSize) {
      return `Dosya çok büyük (max 8MB). Hatalı dosya: ${f.name}`;
    }
  }
  return "";
};

/* ================= PAGE ================= */

export default function EditListingPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const listingId = params?.id;

  const [authUid, setAuthUid] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [error, setError] = useState<string>("");

  const [listing, setListing] = useState<Listing | null>(null);

  /* ================= ONBOARDING GATE ================= */

  const [gateChecking, setGateChecking] = useState(true);
  const [gateAllowed, setGateAllowed] = useState(false);
  const [profileSummary, setProfileSummary] = useState<PublicProfileGate | null>(
    null
  );

  const gateMissingReasons = useMemo(() => {
    const p = profileSummary;
    if (!p) return [];
    const reasons: string[] = [];

    if (!isValidName(p.name || "")) reasons.push("İsim");
    if (!isValidPhone(p.phone || "")) reasons.push("Telefon");
    if (!isValidAddress(p.address || "")) reasons.push("Adres");

    return reasons;
  }, [profileSummary]);

  /* ================= UI CLASSES ================= */

  const sectionCardClass =
    "border border-[#ead8c5] rounded-2xl p-5 sm:p-6 bg-white/75 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]";
  const sectionTitleClass = "text-lg font-semibold text-[#3f2a1a]";
  const labelClass = "text-sm font-semibold text-[#5a4330]";
  const inputClass =
    "w-full border border-[#ead8c5] rounded-full px-4 py-2.5 text-sm text-[#3f2a1a] bg-white/80 placeholder:text-[#9b7b5a] focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#e7c49b]";
  const selectClass =
    "w-full border border-[#ead8c5] rounded-full px-4 py-2.5 text-sm text-[#3f2a1a] bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#e7c49b]";
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

  /* ================= CONDITION ================= */

  const conditionOptions = [
    { value: "", label: "Seç" },
    { value: "new", label: "Yeni / Açılmamış" },
    { value: "likeNew", label: "Çok İyi (Sıfır Ayarında)" },
    { value: "good", label: "İyi" },
    { value: "used", label: "Kullanılmış" },
    { value: "forParts", label: "Parça / Arızalı" },
    { value: "pnp", label: "PNP" },
  ];

  const conditionLabel = (
    v: "" | "new" | "likeNew" | "good" | "used" | "forParts" | "pnp"
  ) => {
    const x = conditionOptions.find((o) => o.value === v);
    return x ? x.label : "";
  };

  /* ================= CATEGORY ================= */

  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [subCategoryId, setSubCategoryId] = useState("");

  const subCategories = useMemo(() => {
    if (!categoryId) return [];
    const list = allCategories
      .filter((c) => c.parentId === categoryId && c.enabled !== false)
      .map((d) => ({
        id: d.id,
        name: d.name,
        parentId: d.parentId ?? null,
        nameLower: d.nameLower || "",
        order: d.order ?? 0,
        enabled: d.enabled,
      }))
      .filter((s) => s.enabled !== false);

    const safeInt = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    list.sort((a: any, b: any) => {
      const oa = safeInt(a.order);
      const ob = safeInt(b.order);
      if (oa !== ob) return oa - ob;
      return (a.name || "").localeCompare(b.name || "");
    });

    return list;
  }, [allCategories, categoryId]);

  const selectedMainCategory = useMemo(
    () => allCategories.find((c) => c.id === categoryId && c.parentId == null) || null,
    [allCategories, categoryId]
  );
  const selectedMainCategorySlug = useMemo(
    () =>
      slugifyTR(
        selectedMainCategory?.nameLower || selectedMainCategory?.name || ""
      ),
    [selectedMainCategory]
  );

  const isBoardGameCategory = selectedMainCategorySlug === "kutu-oyunlari";
  const isConsoleCategory = selectedMainCategorySlug === "konsollar";
  const isHandheldCategory = selectedMainCategorySlug === "el-konsollari";
  const isConsoleLike = isConsoleCategory || isHandheldCategory;

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const cached = await getCategoriesCached();
        const all = (cached || [])
          .map((d: any) => ({
            id: d.id,
            name: d.name,
            enabled: d.enabled,
            order: d.order ?? 0,
            parentId: d.parentId ?? null,
            nameLower: d.nameLower || "",
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

  /* ================= ATTRIBUTES ================= */

  const [attributes, setAttributes] = useState<Record<string, any>>({});

  const setAttr = (key: string, value: any) => {
    setAttributes((prev) => ({ ...prev, [key]: value }));
  };

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
    if (subId.startsWith("konsollar__"))
      return subId.replace("konsollar__", "");
    if (subId.startsWith("el-konsollari__"))
      return subId.replace("el-konsollari__", "");
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

  /* ================= FORM STATES ================= */

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState("");
  const [description, setDescription] = useState("");
  const [isTradable, setIsTradable] = useState(false);
  const [isShippable, setIsShippable] = useState(false);

  /* ================= IMAGES ================= */

  const [existingUrls, setExistingUrls] = useState<string[]>([]);
  const [removedUrls, setRemovedUrls] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const remainingExistingUrls = useMemo(() => {
    return existingUrls.filter((u) => !removedUrls.has(u));
  }, [existingUrls, removedUrls]);

  const totalAfter = useMemo(() => {
    return remainingExistingUrls.length + newFiles.length;
  }, [remainingExistingUrls.length, newFiles.length]);

  const maxNewFilesAllowed = useMemo(() => {
    return Math.max(0, 5 - remainingExistingUrls.length);
  }, [remainingExistingUrls.length]);

  /* ================= DIRTY STATE ================= */

  const initialSnapshotRef = useRef<string>("");

  const computeSnapshot = () =>
    JSON.stringify({
      title,
      price,
      condition,
      description,
      isTradable,
      isShippable,
      categoryId,
      subCategoryId,
      attributes,
      remainingExistingUrls,
      newFilesCount: newFiles.length,
      removedCount: removedUrls.size,
    });

  const isDirty = useMemo(() => {
    if (!initialSnapshotRef.current) return false;
    return initialSnapshotRef.current !== computeSnapshot();
  }, [
    title,
    price,
    condition,
    description,
    isTradable,
    isShippable,
    categoryId,
    subCategoryId,
    attributes,
    remainingExistingUrls,
    newFiles.length,
    removedUrls.size,
  ]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saving || uploading) return;
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, saving, uploading]);

  /* ================= AUTH + GATE CHECK ================= */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setAuthUid(user.uid);

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
        const p = privateSnap.exists() ? (privateSnap.data() as any) : {};
        const mergedPhone = p.phone || d.phone || "";
        const mergedAddress = p.address || d.address || "";

        const summary: PublicProfileGate = {
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

  /* ================= LOAD LISTING ================= */

  useEffect(() => {
    if (!listingId) return;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const snap = await getDoc(doc(db, "listings", listingId));
        if (!snap.exists()) {
          setListing(null);
          setError("İlan bulunamadı.");
          setLoading(false);
          return;
        }

        const data = snap.data() as Listing;
        const resolvedCategoryId = data.categoryId || data.brandId || "";
        const resolvedSubCategoryId = data.subCategoryId || data.modelId || "";
        const resolvedCategoryName =
          data.categoryName || data.brandName || "";
        const resolvedSubCategoryName =
          data.subCategoryName || data.modelName || "";

        setListing({
          ...data,
          categoryId: resolvedCategoryId,
          subCategoryId: resolvedSubCategoryId,
          categoryName: resolvedCategoryName,
          subCategoryName: resolvedSubCategoryName,
        });

        setTitle(data.title || "");
        setPrice(String(data.price ?? ""));
        setCondition((data.conditionKey as any) || "");
        setDescription(data.description || "");
        setIsTradable(!!(data as any).isTradable);
        setIsShippable(!!(data as any).shippingAvailable);

        setCategoryId(resolvedCategoryId);
        setSubCategoryId(resolvedSubCategoryId);

        const rawAttrs = { ...(data.attributes || {}) } as Record<string, any>;
        for (const [legacy, modern] of Object.entries(boardgameSchemaAliases)) {
          if (rawAttrs[modern] == null && rawAttrs[legacy] != null) {
            rawAttrs[modern] = rawAttrs[legacy];
          }
        }
        setAttributes(rawAttrs);

        setExistingUrls(Array.isArray(data.imageUrls) ? data.imageUrls : []);
        setRemovedUrls(new Set());
        setNewFiles([]);

        setTimeout(() => {
          initialSnapshotRef.current = JSON.stringify({
            title: data.title || "",
            price: String(data.price ?? ""),
            condition: data.conditionKey || "",
            description: data.description || "",
            isTradable: !!(data as any).isTradable,
            isShippable: !!(data as any).shippingAvailable,
            categoryId: resolvedCategoryId,
            subCategoryId: resolvedSubCategoryId,
            attributes: rawAttrs,
            remainingExistingUrls: Array.isArray(data.imageUrls)
              ? data.imageUrls
              : [],
            newFilesCount: 0,
            removedCount: 0,
          });
        }, 0);
      } catch (e: any) {
        devError("Listing load error", e);
        setError(getFriendlyErrorMessage(e, "Bir hata oluştu."));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [listingId]);

  /* ================= PERMISSION CHECK ================= */

  const canEdit = useMemo(() => {
    if (!listing || !authUid) return false;
    return listing.ownerId === authUid;
  }, [listing, authUid]);

  /* ================= IMAGE ACTIONS ================= */

  const removeExistingImage = (url: string) => {
    setRemovedUrls((prev) => {
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };

  const undoRemoveExistingImage = (url: string) => {
    setRemovedUrls((prev) => {
      const next = new Set(prev);
      next.delete(url);
      return next;
    });
  };

  const removeNewFileAt = (idx: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const onPickNewFiles = (files: FileList | null) => {
    if (!files) return;

    const picked = Array.from(files);
    const allowedLeft = maxNewFilesAllowed - newFiles.length;
    const slice = picked.slice(0, Math.max(0, allowedLeft));
    setNewFiles((prev) => [...prev, ...slice]);
  };

  /* ================= STORAGE OPS ================= */

  const deleteRemovedFromStorage = async (urls: string[]) => {
    if (urls.length === 0) return;

    await Promise.all(
      urls.map(async (u) => {
        try {
          const path = storagePathFromUrl(u);
          if (!path) return;

          const r = ref(storage, path);
          await deleteObject(r);
        } catch (err) {
          devWarn("Storage delete failed:", u, err);
        }
      })
    );
  };

  const uploadNewFilesWithProgress = async (
    listingIdToUse: string,
    files: File[]
  ): Promise<string[]> => {
    if (files.length === 0) return [];

    setUploading(true);
    setUploadProgress(0);

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const perFileTransferred: number[] = files.map(() => 0);

    const urls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const safeName = sanitizeFileName(file.name);
      const storagePath = `listings/${listingIdToUse}/${Date.now()}-${i}-${safeName}`;

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
  /* ================= ATTRIBUTES SAVE ================= */

  const buildAttributesForSave = () => {
    const out: Record<string, any> = {};

    const mergeExtra = (
      keys: string[],
      types: Record<string, "text" | "number" | "boolean" | "select">
    ) => {
      for (const key of keys) {
        if (key in out) continue;
        const raw = (attributes as any)[key];
        if (raw == null || raw === "") continue;

        const t = types[key] || "text";
        if (t === "number") {
          const n = Number(raw);
          if (Number.isFinite(n)) out[key] = n;
          continue;
        }
        if (t === "boolean") {
          if (raw === true || raw === false) out[key] = raw;
          continue;
        }
        out[key] = String(raw);
      }
    };

    for (const [k, v] of Object.entries(attributes || {})) {
      if (v == null || v === "") continue;
      out[k] = v;
    }

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

    for (const legacy of boardgameLegacyKeys) {
      delete out[legacy];
    }

    return out;
  };

  /* ================= SUBMIT ================= */

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!listingId) {
      setError("İlan bulunamadı.");
      return;
    }

    if (!gateAllowed) {
      setError("İlanı düzenlemek için önce profilini tamamlamalısın.");
      router.replace("/my?onboarding=1");
      return;
    }

    if (!canEdit) {
      setError("Bu ilanı düzenleme yetkin yok.");
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

    if (totalAfter === 0) {
      setError("En az 1 fotoğraf kalmalı.");
      return;
    }
    if (totalAfter > 5) {
      setError("En fazla 5 fotoğraf olabilir.");
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

    if (isBoardGameCategory) {
      if (!attributes.minPlayers || !attributes.maxPlayers) {
        setError("Kutu oyunu için oyuncu sayısı zorunlu.");
        return;
      }
      if (attributes.completeContent === "" || attributes.completeContent == null) {
        setError("Kutu oyunu için içerik durumu zorunlu.");
        return;
      }
    }

    if (isConsoleLike && consoleFieldVisibility?.consoleModel) {
      if (!attributes.consoleModel) {
        setError("Konsol modelini seçmelisin.");
        return;
      }
    }

    try {
      setSaving(true);

      const attributesForSave = buildAttributesForSave();

      await updateDoc(doc(db, "listings", listingId), {
        title: cleanTitle,
        description: cleanDescription,
        price: priceNumber,
        conditionKey: condition,
        conditionLabel: conditionLabel(condition as any),
        isTradable,
        shippingAvailable: isShippable,
        attributes: attributesForSave,
        updatedAt: serverTimestamp(),
      });

      const newUrls = await uploadNewFilesWithProgress(listingId, newFiles);
      const finalUrls = [...remainingExistingUrls, ...newUrls];

      await updateDoc(doc(db, "listings", listingId), {
        imageUrls: finalUrls,
        updatedAt: serverTimestamp(),
      });

      const removedList = Array.from(removedUrls);
      await deleteRemovedFromStorage(removedList);

      router.push(buildListingPath(listingId, cleanTitle));
    } catch (err: any) {
      devError("Listing update error:", err);
      setError(getFriendlyErrorMessage(err, "İlan güncellenirken hata oluştu."));
      setUploading(false);
    } finally {
      setSaving(false);
    }
  };

  /* ================= UI ================= */
  if (gateChecking) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center">
          <div className="text-lg font-semibold">Kontrol ediliyor...</div>
          <div className="text-sm text-gray-600 mt-2">
            Profil bilgilerin doğrulanıyor.
          </div>
        </div>
      </div>
    );
  }

  if (!gateAllowed) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center">
          <div className="text-lg font-semibold">
            Profilini tamamlaman gerekiyor
          </div>
          <div className="text-sm text-gray-600 mt-2">
            İlan düzenleyebilmek için önce profilinde zorunlu alanları doldurmalısın.
          </div>

          {profileSummary && (
            <div className="mt-4 text-sm bg-gray-50 border rounded-xl p-4 text-left">
              <div className="font-semibold mb-2">Eksikler</div>
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
            className="mt-5 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl"
          >
            /my Sayfasına Git
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10 flex items-center justify-center">
        <div className="text-sm text-[#5a4330]">Yükleniyor...</div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center">
          <div className="text-lg font-semibold">İlan bulunamadı</div>
          <button
            onClick={() => router.push("/")}
            className="mt-3 text-blue-600 underline"
          >
            Ana sayfaya dön
          </button>
        </div>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 text-center">
          <div className="text-lg font-semibold">Yetkisiz</div>
          <div className="text-sm text-gray-600 mt-2">
            Bu ilanı düzenleme yetkin yok.
          </div>
          <button
            onClick={() =>
              router.push(buildListingPath(listingId, listing.title || ""))
            }
            className="mt-4 text-blue-600 underline"
          >
            İlana geri dön
          </button>
        </div>
      </div>
    );
  }

  const headerCategory = listing.categoryName || listing.brandName || "";
  const headerSubCategory = listing.subCategoryName || listing.modelName || "";

  return (
    <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#3f2a1a]">İlanı Düzenle</h1>
            <div className="text-sm text-[#6b4b33] mt-1">
              {headerCategory}
              {headerSubCategory ? ` / ${headerSubCategory}` : ""}
            </div>
            <div className="text-xs text-[#8a6a4f] mt-1">
              Zorunlu alanlar dolmadan ilan güncellenmez.
            </div>
          </div>

          <button
            onClick={() => {
              if (!isDirty || saving || uploading) {
                router.push(buildListingPath(listingId, title));
                return;
              }
              const ok = confirm("Değişiklikleri kaydetmeden çıkmak istiyor musun?");
              if (ok) router.push(buildListingPath(listingId, title));
            }}
            className="text-sm underline text-[#6b4b33]"
            disabled={saving || uploading}
          >
            İlana geri dön →
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-100 p-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
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
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={selectClass}
                  disabled
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
                  onChange={(e) => setSubCategoryId(e.target.value)}
                  className={selectClass}
                  disabled
                >
                  <option value="">Alt kategori seç</option>
                  {subCategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-xs text-[#8b6b4e]">
              İlan yayınlandıktan sonra kategori ve alt kategori değiştirilemez.
            </div>
          </div>

          {/* ================= BOARD GAME ================= */}
          {isBoardGameCategory && (
            <div className={`${sectionCardClass} space-y-4`}>
              <div className={sectionTitleClass}>Kutu Oyunu Bilgileri</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Oyunun Resmi Adı</label>
                  <input
                    value={attributes.gameName || ""}
                    onChange={(e) => setAttr("gameName", e.target.value)}
                    className={inputClass}
                    disabled={saving || uploading}
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
                    disabled={saving || uploading}
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
                    disabled={saving || uploading}
                  >
                    <option value="">Seç</option>
                    <option value="5-15">5-15</option>
                    <option value="15-30">15-30</option>
                    <option value="30-45">30-45</option>
                    <option value="45-60">45-60</option>
                    <option value="60-90">60-90</option>
                    <option value="90-120">90+</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Yaş Önerisi</label>
                  <select
                    value={
                      attributes.suggestedAge != null &&
                      attributes.suggestedAge !== ""
                        ? String(attributes.suggestedAge)
                        : ""
                    }
                    onChange={(e) => setAttr("suggestedAge", e.target.value)}
                    className={selectClass}
                    disabled={saving || uploading}
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
          )}
          {/* ================= LISTING DETAILS ================= */}
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
                  disabled={saving || uploading}
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
                  disabled={saving || uploading}
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
                  disabled={saving || uploading}
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
                disabled={saving || uploading}
              />
              <ToggleRow
                label="Kargo için uygun mu?"
                value={isShippable}
                onChange={setIsShippable}
                disabled={saving || uploading}
              />
            </div>

            {isBoardGameCategory && (
              <div className="space-y-3">
                <div className={labelClass}>Kutu Oyunu İlan Bilgileri</div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className={labelClass}>Dil</div>
                    <select
                      value={attributes.language || ""}
                      onChange={(e) => setAttr("language", e.target.value)}
                      className={selectClass}
                      disabled={saving || uploading}
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
                      disabled={saving || uploading}
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
                      disabled={saving || uploading}
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
                        disabled={saving || uploading}
                      >
                        <option value="">Seç</option>
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
                        disabled={saving || uploading}
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
                        disabled={saving || uploading}
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
                        disabled={saving || uploading}
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
                        value={attributes.controllerCount || ""}
                        onChange={(e) =>
                          setAttr("controllerCount", formatMaybeInt(e.target.value))
                        }
                        className={inputClass}
                        disabled={saving || uploading}
                        placeholder="Örn: 2"
                      />
                    </div>
                  )}

                  {consoleFieldVisibility?.accessories && (
                    <div>
                      <div className={labelClass}>Aksesuarlar</div>
                      <input
                        value={attributes.accessories || ""}
                        onChange={(e) => setAttr("accessories", e.target.value)}
                        className={inputClass}
                        disabled={saving || uploading}
                        placeholder="Örn: Dock, 2 oyun"
                      />
                    </div>
                  )}

                  {consoleFieldVisibility?.purchaseYear && (
                    <div>
                      <div className={labelClass}>Satın alma yılı</div>
                      <input
                        value={attributes.purchaseYear || ""}
                        onChange={(e) =>
                          setAttr("purchaseYear", formatMaybeInt(e.target.value))
                        }
                        className={inputClass}
                        disabled={saving || uploading}
                        placeholder="Örn: 2022"
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
                        disabled={saving || uploading}
                      >
                        <option value="">Seç</option>
                        <option value="Devam ediyor">Devam ediyor</option>
                        <option value="Bitti">Bitti</option>
                        <option value="Belirsiz">Belirsiz</option>
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
                        disabled={saving || uploading}
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {consoleFieldVisibility?.batteryHealth && (
                      <div>
                        <div className={labelClass}>Pil sağlığı</div>
                        <select
                          value={attributes.batteryHealth || ""}
                          onChange={(e) => setAttr("batteryHealth", e.target.value)}
                          className={selectClass}
                          disabled={saving || uploading}
                        >
                          <option value="">Seç</option>
                          <option value="Çok iyi">Çok iyi</option>
                          <option value="İyi">İyi</option>
                          <option value="Orta">Orta</option>
                          <option value="Kötü">Kötü</option>
                        </select>
                      </div>
                    )}

                    {consoleFieldVisibility?.screenCondition && (
                      <div>
                        <div className={labelClass}>Ekran durumu</div>
                        <select
                          value={attributes.screenCondition || ""}
                          onChange={(e) => setAttr("screenCondition", e.target.value)}
                          className={selectClass}
                          disabled={saving || uploading}
                        >
                          <option value="">Seç</option>
                          <option value="Çok iyi">Çok iyi</option>
                          <option value="İyi">İyi</option>
                          <option value="Orta">Orta</option>
                          <option value="Kötü">Kötü</option>
                        </select>
                      </div>
                    )}

                    {consoleFieldVisibility?.stickDrift && (
                      <div>
                        <div className={labelClass}>Stick drift var mı?</div>
                        <select
                          value={attributes.stickDrift || ""}
                          onChange={(e) => setAttr("stickDrift", e.target.value)}
                          className={selectClass}
                          disabled={saving || uploading}
                        >
                          <option value="">Seç</option>
                          <option value="Yok">Yok</option>
                          <option value="Var">Var</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}
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
                disabled={saving || uploading}
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
                    En az 1, en fazla 5 fotoğraf. (Şu an: {totalAfter})
                  </div>
                </div>

                <div className={helperTextClass}>
                  {totalAfter >= 5 ? "Limit doldu." : `Kalan: ${5 - totalAfter}`}
                </div>
              </div>

              {existingUrls.length > 0 && (
                <div className="space-y-2">
                  <div className={helperTextClass}>Mevcut fotoğraflar:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {existingUrls.map((url, idx) => {
                      const isRemoved = removedUrls.has(url);
                      return (
                        <div
                          key={`${url}-${idx}`}
                          className={`border border-[#ead8c5] rounded-2xl overflow-hidden bg-white/70 ${
                            isRemoved ? "opacity-40" : ""
                          }`}
                        >
                          <Image
                            src={url}
                            alt={`existing-${idx}`}
                            width={400}
                            height={160}
                            sizes="(min-width: 768px) 33vw, 100vw"
                            className="w-full h-40 object-cover"
                          />
                          <div className="p-2 flex items-center justify-between gap-2">
                            <div className="text-xs text-[#8a6a4f] truncate">
                              Foto {idx + 1}
                            </div>
                            {!isRemoved ? (
                              <button
                                type="button"
                                onClick={() => removeExistingImage(url)}
                                className="text-xs text-rose-700 underline"
                                disabled={saving || uploading}
                              >
                                Sil
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => undoRemoveExistingImage(url)}
                                className="text-xs text-blue-700 underline"
                                disabled={saving || uploading}
                              >
                                Geri al
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <label
                className={`block rounded-2xl border-2 border-dashed border-[#ead8c5] bg-white/70 p-6 text-center cursor-pointer transition ${
                  saving || uploading || maxNewFilesAllowed - newFiles.length <= 0
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
                  disabled={
                    saving || uploading || maxNewFilesAllowed - newFiles.length <= 0
                  }
                />

                <div className="text-base font-semibold text-[#3f2a1a]">
                  📸 Yeni Fotoğraf Seç
                </div>
                <div className="text-xs text-[#8a6a4f] mt-1">
                  JPG / PNG / WEBP — max 8MB — Kaydet’e basınca yüklenecek
                </div>
              </label>

              {newFiles.length > 0 && (
                <div className="space-y-2">
                  <div className={helperTextClass}>Seçilen yeni fotoğraflar:</div>

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
                          disabled={saving || uploading}
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
            </div>
          </div>

          {/* ================= ACTIONS ================= */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={saving || uploading}
              className="flex-1 bg-[#1f2a24] hover:bg-[#2b3b32] text-white font-semibold py-3 rounded-full disabled:opacity-50"
            >
              {uploading
                ? `Yükleniyor... %${uploadProgress}`
                : saving
                ? "Kaydediliyor..."
                : "Kaydet"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isDirty || saving || uploading) {
                  router.push(buildListingPath(listingId, title));
                  return;
                }
                const ok = confirm("Değişiklikleri kaydetmeden çıkmak istiyor musun?");
                if (ok) router.push(buildListingPath(listingId, title));
              }}
              disabled={saving || uploading}
              className="flex-1 border rounded-full py-3 font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              Vazgeç
            </button>
          </div>

          <div className={helperTextClass}>
            Not: Fotoğraf silme işlemi kaydettiğinde Storage’dan da silinir. Yeni fotoğraflar
            kaydettiğinde yüklenir.
          </div>
        </form>
      </div>
    </div>
  );
}
