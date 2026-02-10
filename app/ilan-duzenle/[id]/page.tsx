// app/ilan/[id]/edit/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { getCategoriesCached, getSubCategoriesCached } from "@/lib/catalogCache";
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

/* ================= TYPES ================= */

type Listing = {
  title: string;
  price: number;

  categoryId: string;
  categoryName: string;
  subCategoryId: string;
  subCategoryName: string;

  productionYear?: string | null;
  gender?: string;
  serialNumber?: string;
  movementType?: string;

  caseType?: string;
  diameterMm?: number | null;
  dialColor?: string;

  braceletMaterial?: string;
  braceletColor?: string;

  // ✅ yeni sistem: wearLevel + wearExists
  wearExists?: boolean;
  wearLevel?: string; // örn: "Aşınma yok" / "Hafif aşınma" ...

  accessories?: string;

  description?: string;

  imageUrls?: string[];

  ownerId: string;
  createdAt?: any;
  updatedAt?: any;
};

type Category = {
  id: string;
  name: string;
  nameLower?: string;
};

type SubCategory = {
  id: string;
  name: string;
  nameLower?: string;
  categoryId: string;
};

type PublicProfileGate = {
  onboardingCompleted?: boolean;
  name?: string;
  phone?: string;
  address?: string;
};

/* ================= HELPERS ================= */

const normalizeSpaces = (v: string) => (v || "").replace(/\s+/g, " ").trim();

const digitsOnly = (v: string) => (v || "").replace(/[^\d]/g, "");

const isValidName = (name: string) => {
  const n = normalizeSpaces(name);
  return n.length >= 2 && n.length <= 80;
};

const isValidAddress = (address: string) => {
  const a = normalizeSpaces(address);
  return a.length >= 10 && a.length <= 200;
};

const isValidPhone = (phone: string) => {
  const d = digitsOnly(phone);

  if (d.startsWith("90") && d.length >= 12) {
    const rest = d.slice(2);
    return rest.length >= 10 && rest.length <= 12;
  }

  if (d.startsWith("0") && d.length >= 11) {
    const rest = d.slice(1);
    return rest.length >= 10 && rest.length <= 12;
  }

  return d.length >= 10 && d.length <= 12;
};

const formatMaybeInt = (v: string) => {
  const t = v.trim();
  if (!t) return "";
  return t.replace(/[^\d]/g, "");
};

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

const accessoriesLabel = (v: string) => {
  if (v === "both") return "Orijinal kutu ve orijinal belgeler";
  if (v === "box") return "Orijinal kutu";
  if (v === "papers") return "Orijinal belgeler";
  if (v === "none") return "Başka aksesuar yok";
  return v;
};

const accessoriesValueFromLabel = (label: string) => {
  if (label === "Orijinal kutu ve orijinal belgeler") return "both";
  if (label === "Orijinal kutu") return "box";
  if (label === "Orijinal belgeler") return "papers";
  if (label === "Başka aksesuar yok") return "none";
  return "";
};

// ✅ wear level label helpers
const wearLevelLabel = (v: "" | "none" | "light" | "medium" | "heavy") => {
  if (v === "none") return "Aşınma yok";
  if (v === "light") return "Hafif aşınma";
  if (v === "medium") return "Orta aşınma";
  if (v === "heavy") return "Belirgin aşınma";
  return "";
};

const wearLevelValueFromLabel = (label: string) => {
  if (label === "Aşınma yok") return "none";
  if (label === "Hafif aşınma") return "light";
  if (label === "Orta aşınma") return "medium";
  if (label === "Belirgin aşınma") return "heavy";
  return "";
};

const sanitizeFileName = (name: string) => {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.\-_]/g, "");
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

    const nameOk = isValidName(p.name || "");
    const phoneOk = isValidPhone(p.phone || "");
    const addressOk = isValidAddress(p.address || "");

    if (!nameOk) reasons.push("İsim");
    if (!phoneOk) reasons.push("Telefon");
    if (!addressOk) reasons.push("Adres");

    return reasons;
  }, [profileSummary]);

  /* ✅ DROPDOWN OPTIONS (HOOK ORDER SAFE) */

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    const years: string[] = [];
    for (let y = now; y >= 1950; y--) years.push(String(y));
    return years;
  }, []);

  const diameterOptions = useMemo(() => {
    const arr: string[] = [];
    for (let d = 28; d <= 50; d++) arr.push(String(d));
    return arr;
  }, []);

  const baseCaseTypeOptions = useMemo(() => {
    return [
      "Çelik",
      "Titanyum",
      "Altın",
      "Gümüş",
      "Bronz",
      "Seramik",
      "Karbon",
      "Plastik",
      "Diğer",
    ];
  }, []);

  const wearLevelOptions = useMemo(() => {
    return [
      { value: "none" as const, label: "Aşınma yok" },
      { value: "light" as const, label: "Hafif aşınma" },
      { value: "medium" as const, label: "Orta aşınma" },
      { value: "heavy" as const, label: "Belirgin aşınma" },
    ];
  }, []);

  /* ================= CATEGORY/SUBCATEGORY DATA ================= */

  const [categories, setCategories] = useState<Category[]>([]);
  const [allSubCategories, setAllSubCategories] = useState<SubCategory[]>([]);

  /* ================= FORM STATES ================= */

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  // category/subCategory edit kapalı ama state duruyor
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [subCategoryId, setSubCategoryId] = useState("");
  const [subCategoryName, setSubCategoryName] = useState("");

  const [productionYear, setProductionYear] = useState("");
  const [gender, setGender] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [movementType, setMovementType] = useState("");

  const [caseType, setCaseType] = useState("");
  const [diameterMm, setDiameterMm] = useState("");
  const [dialColor, setDialColor] = useState("");

  const [braceletMaterial, setBraceletMaterial] = useState("");
  const [braceletColor, setBraceletColor] = useState("");

  // ✅ yeni: aşınma seviyesi zorunlu
  const [wearLevel, setWearLevel] = useState<"" | "none" | "light" | "medium" | "heavy">(
    ""
  );

  const [accessories, setAccessories] = useState("");
  const [description, setDescription] = useState("");

  // ✅ caseType dropdown’da mevcut değerin “listede yoksa” da görünebilmesi için:
  const caseTypeOptions = useMemo(() => {
    const val = normalizeSpaces(caseType);
    if (!val) return baseCaseTypeOptions;
    if (baseCaseTypeOptions.includes(val)) return baseCaseTypeOptions;
    // eski ilanlarda farklı yazılmış olabilir (örn "Paslanmaz Çelik")
    return [val, ...baseCaseTypeOptions];
  }, [caseType, baseCaseTypeOptions]);

  /* ================= IMAGES STATES ================= */

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

  const filteredSubCategories = useMemo(() => {
    if (!categoryId) return [];
    return allSubCategories
      .filter((m) => m.categoryId === categoryId)
      .sort((a, b) =>
        (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr")
      );
  }, [allSubCategories, categoryId]);

  /* ================= DIRTY STATE (UX) ================= */

  const initialSnapshotRef = useRef<string>("");

  const computeSnapshot = () => {
    return JSON.stringify({
      title,
      price,
      categoryId,
      subCategoryId,
      productionYear,
      gender,
      serialNumber,
      movementType,
      caseType,
      diameterMm,
      dialColor,
      braceletMaterial,
      braceletColor,
      wearLevel,
      accessories,
      description,
      remainingExistingUrls,
      newFilesCount: newFiles.length,
      removedCount: removedUrls.size,
    });
  };

  const isDirty = useMemo(() => {
    if (!initialSnapshotRef.current) return false;
    return initialSnapshotRef.current !== computeSnapshot();
  }, [
    title,
    price,
    categoryId,
    subCategoryId,
    productionYear,
    gender,
    serialNumber,
    movementType,
    caseType,
    diameterMm,
    dialColor,
    braceletMaterial,
    braceletColor,
    wearLevel,
    accessories,
    description,
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
        const snap = await getDoc(publicRef);

        if (!snap.exists()) {
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

        const d = snap.data() as any;

        const summary: PublicProfileGate = {
          onboardingCompleted: !!d.onboardingCompleted,
          name: d.name || "",
          phone: d.phone || "",
          address: d.address || "",
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
        console.error(err);
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

  /* ================= LOAD BRANDS + MODELS ================= */

  useEffect(() => {
    let cancelled = false;

    async function loadCategorySubCategoryData() {
      try {
        const [bSnap, mSnap] = await Promise.all([
          getCategoriesCached(),
          getSubCategoriesCached(),
        ]);

        if (cancelled) return;

        const b = (bSnap || []).map((d: any) => ({
          id: d.id,
          ...(d as any),
        })) as Category[];

        const m = (mSnap || []).map((d: any) => ({
          id: d.id,
          ...(d as any),
        })) as SubCategory[];

        b.sort((a, b) =>
          (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr")
        );

        setCategories(b);
        setAllSubCategories(m);
      } catch (e) {
        console.warn("Kategori/Alt kategori load failed:", e);
      }
    }

    loadCategorySubCategoryData();

    return () => {
      cancelled = true;
    };
  }, []);

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
        setListing(data);

        // Form states
        setTitle(data.title || "");
        setPrice(String(data.price ?? ""));

        setCategoryId(data.categoryId || "");
        setCategoryName(data.categoryName || "");
        setSubCategoryId(data.subCategoryId || "");
        setSubCategoryName(data.subCategoryName || "");

        setProductionYear((data.productionYear as any) || "");
        setGender(data.gender || "");
        setSerialNumber(data.serialNumber || "");
        setMovementType(data.movementType || "");

        setCaseType(data.caseType || "");
        setDiameterMm(
          data.diameterMm === null || data.diameterMm === undefined
            ? ""
            : String(data.diameterMm)
        );
        setDialColor(data.dialColor || "");

        setBraceletMaterial(data.braceletMaterial || "");
        setBraceletColor(data.braceletColor || "");

        // ✅ wearLevel init (öncelik: wearLevel label -> value; yoksa wearExists -> tahmin)
        const wearValueFromLabel = wearLevelValueFromLabel(data.wearLevel || "");
        if (wearValueFromLabel) {
          setWearLevel(wearValueFromLabel as any);
        } else {
          // eski ilanlar için fallback
          setWearLevel(data.wearExists ? "medium" : "none");
        }

        setAccessories(accessoriesValueFromLabel(data.accessories || ""));
        setDescription(data.description || "");

        // Images
        setExistingUrls(Array.isArray(data.imageUrls) ? data.imageUrls : []);
        setRemovedUrls(new Set());
        setNewFiles([]);

        // Dirty baseline
        setTimeout(() => {
          initialSnapshotRef.current = JSON.stringify({
            title: data.title || "",
            price: String(data.price ?? ""),
            categoryId: data.categoryId || "",
            subCategoryId: data.subCategoryId || "",
            productionYear: (data.productionYear as any) || "",
            gender: data.gender || "",
            serialNumber: data.serialNumber || "",
            movementType: data.movementType || "",
            caseType: data.caseType || "",
            diameterMm:
              data.diameterMm === null || data.diameterMm === undefined
                ? ""
                : String(data.diameterMm),
            dialColor: data.dialColor || "",
            braceletMaterial: data.braceletMaterial || "",
            braceletColor: data.braceletColor || "",
            wearLevel: wearValueFromLabel
              ? wearValueFromLabel
              : data.wearExists
              ? "medium"
              : "none",
            accessories: accessoriesValueFromLabel(data.accessories || ""),
            description: data.description || "",
            remainingExistingUrls: Array.isArray(data.imageUrls)
              ? data.imageUrls
              : [],
            newFilesCount: 0,
            removedCount: 0,
          });
        }, 0);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Bir hata oluştu.");
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

    // Max 5 total kuralı
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
          console.warn("Storage delete failed:", u, err);
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
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`;
      const storagePath = `listings/${listingIdToUse}/${unique}-${safeName}`;

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!listingId || !listing) {
      setError("İlan bulunamadı.");
      return;
    }

    if (!authUid) {
      setError("Giriş yapılmamış görünüyor.");
      return;
    }

    if (!gateAllowed) {
      setError("İlanı güncellemek için önce profilini tamamlamalısın.");
      router.replace("/my?onboarding=1");
      return;
    }

    if (!canEdit) {
      setError("Bu ilanı düzenleme yetkin yok.");
      return;
    }

    // ✅ HER ŞEY ZORUNLU (EDIT)
    const cleanTitle = normalizeSpaces(title);
    const cleanPrice = price.trim();

    const cleanProductionYear = productionYear.trim();
    const cleanGender = normalizeSpaces(gender);
    const cleanSerialNumber = normalizeSpaces(serialNumber);
    const cleanMovementType = normalizeSpaces(movementType);

    const cleanCaseType = normalizeSpaces(caseType);
    const cleanDiameter = diameterMm.trim();
    const cleanDialColor = normalizeSpaces(dialColor);

    const cleanBraceletMaterial = normalizeSpaces(braceletMaterial);
    const cleanBraceletColor = normalizeSpaces(braceletColor);

    const cleanAccessories = accessories.trim();
    const cleanDescription = normalizeSpaces(description);

    if (!cleanTitle) return setError("İlan başlığı zorunlu.");
    if (cleanTitle.length > 120) return setError("Başlık en fazla 120 karakter olmalı.");

    if (!cleanPrice) return setError("Fiyat zorunlu.");
    const priceNumber = Number(cleanPrice);
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      return setError("Fiyat geçersiz görünüyor.");
    }

    if (!cleanProductionYear) return setError("Üretim yılı zorunlu.");
    if (!cleanGender) return setError("Cinsiyet zorunlu.");
    if (!cleanSerialNumber) return setError("Seri numarası zorunlu.");

    if (!wearLevel) return setError("Aşınma seviyesi zorunlu.");
    if (!cleanAccessories) return setError("Aksesuar durumu zorunlu.");
    if (!cleanDescription) return setError("Açıklama zorunlu.");

    const diameterNumber = cleanDiameter
      ? Number(cleanDiameter)
      : null;
    if (cleanDiameter && !Number.isFinite(diameterNumber)) {
      return setError("Çap değeri geçersiz görünüyor.");
    }

    // ✅ Fotoğraf zorunlu: toplam 1..5 olmalı
    if (totalAfter === 0) {
      return setError("En az 1 fotoğraf kalmalı. Hepsini sildiysen yeni foto ekle.");
    }
    if (totalAfter > 5) {
      return setError("En fazla 5 fotoğraf olabilir.");
    }

    const fileError = validateFiles(newFiles);
    if (fileError) return setError(fileError);

    // Rules uyumu: categoryId/subCategoryId kilitli
    const finalCategoryId = listing.categoryId;
    const finalCategoryName = listing.categoryName;
    const finalSubCategoryId = listing.subCategoryId;
    const finalSubCategoryName = listing.subCategoryName;

    try {
      setSaving(true);

      // 1) Storage: silinecekler
      const removed = existingUrls.filter((u) => removedUrls.has(u));
      await deleteRemovedFromStorage(removed);

      // 2) Storage: yenileri upload
      const uploadedUrls = await uploadNewFilesWithProgress(listingId, newFiles);

      // 3) Firestore: imageUrls final
      const finalUrls = [...remainingExistingUrls, ...uploadedUrls];

      // emniyet
      const safeFinalUrls = finalUrls.slice(0, 5);

      // 4) Firestore update
      await updateDoc(doc(db, "listings", listingId), {
        title: cleanTitle,
        description: cleanDescription,
        price: priceNumber,

        categoryId: finalCategoryId,
        categoryName: finalCategoryName,
        subCategoryId: finalSubCategoryId,
        subCategoryName: finalSubCategoryName,

        productionYear: cleanProductionYear,
        gender: cleanGender,
        serialNumber: cleanSerialNumber,
        movementType: cleanMovementType,

        caseType: cleanCaseType,
        diameterMm: diameterNumber,
        dialColor: cleanDialColor,

        braceletMaterial: cleanBraceletMaterial,
        braceletColor: cleanBraceletColor,

        // ✅ wear level (label) + wearExists
        wearLevel: wearLevelLabel(wearLevel),
        wearExists: wearLevel !== "none",

        accessories: accessoriesLabel(cleanAccessories),

        imageUrls: safeFinalUrls,

        updatedAt: serverTimestamp(),
      });

      router.push(`/ilan/${listingId}`);
    } catch (err: any) {
      console.error(err);

      const code = err?.code || "";
      if (code === "permission-denied") {
        setError(
          "Yetki hatası: Profil tamamlanmamış olabilir veya bu ilan senin olmayabilir. /my sayfasına yönlendiriliyorsun."
        );
        router.replace("/my?onboarding=1");
      } else {
        setError(err?.message || "Kaydederken hata oluştu.");
      }

      setUploading(false);
    } finally {
      setSaving(false);
    }
  };

  /* ================= UI STATES ================= */

  if (gateChecking) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10 flex items-center justify-center">
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
      <div className="min-h-screen bg-gray-100 px-4 py-10 flex items-center justify-center">
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
    return <div className="p-8 text-center text-gray-500">Yükleniyor...</div>;
  }

  if (!listing) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-600 font-medium mb-3">
          {error || "İlan bulunamadı."}
        </div>
        <button
          onClick={() => router.push("/")}
          className="text-blue-600 underline"
        >
          Ana sayfaya dön
        </button>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-600 font-medium mb-3">
          Bu ilanı düzenleme yetkin yok.
        </div>
        <button
          onClick={() => router.push("/")}
          className="text-blue-600 underline"
        >
          Ana sayfaya dön
        </button>
      </div>
    );
  }

  /* ================= UI ================= */

  const disableCategorySubCategoryEdit = true;

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="w-full max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">İlanı Düzenle</h1>
            <div className="text-sm text-gray-600 mt-1">
              {listing.categoryName} / {listing.subCategoryName}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Bu sayfada tüm alanlar zorunludur. Eksik alan varsa kaydedilmez.
            </div>
          </div>

          <button
            onClick={() => {
              if (!isDirty || saving || uploading) {
                router.push(`/ilan/${listingId}`);
                return;
              }
              const ok = confirm("Değişiklikleri kaydetmeden çıkmak istiyor musun?");
              if (ok) router.push(`/ilan/${listingId}`);
            }}
            className="text-sm underline text-gray-600"
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

        {disableCategorySubCategoryEdit && (
          <div className="text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded-lg">
            Kategori / alt kategori değişimi şu an kapalı. (Güvenlik kuralları categoryId/subCategoryId
            değişikliğine izin vermiyor.)
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-8">
          {/* ================= BRAND & MODEL ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="font-semibold text-lg">Kategori & Alt Kategori</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Kategori <span className="text-red-600">*</span>
                </div>
                <select
                  value={categoryId}
                  onChange={(e) => {
                    const bid = e.target.value;
                    const b = categories.find((x) => x.id === bid);

                    setCategoryId(bid);
                    setCategoryName(b?.name || "");

                    setSubCategoryId("");
                    setSubCategoryName("");
                  }}
                  className="w-full border rounded-lg px-4 py-2 disabled:bg-gray-100"
                  disabled={disableCategorySubCategoryEdit || saving || uploading}
                >
                  <option value="">Kategori seç</option>
                  {categories.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>

                <div className="text-xs text-gray-500">
                  Mevcut: <span className="font-semibold">{listing.categoryName}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Alt kategori <span className="text-red-600">*</span>
                </div>
                <select
                  value={subCategoryId}
                  onChange={(e) => {
                    const mid = e.target.value;
                    const m = filteredSubCategories.find((x) => x.id === mid);
                    setSubCategoryId(mid);
                    setSubCategoryName(m?.name || "");
                  }}
                  className="w-full border rounded-lg px-4 py-2 disabled:bg-gray-100"
                  disabled={
                    disableCategorySubCategoryEdit || !categoryId || saving || uploading
                  }
                >
                  <option value="">Alt kategori seç</option>
                  {filteredSubCategories.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>

                <div className="text-xs text-gray-500">
                  Mevcut: <span className="font-semibold">{listing.subCategoryName}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ================= BASIC ================= */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-semibold">
                İlan başlığı <span className="text-red-600">*</span>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border rounded-lg px-4 py-2"
                disabled={saving || uploading}
                placeholder="İlan başlığı"
                maxLength={120}
                required
              />
              <div className="text-xs text-gray-500">
                {normalizeSpaces(title).length}/120
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">
                Satış fiyatı (TL) <span className="text-red-600">*</span>
              </div>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(formatMaybeInt(e.target.value))}
                className="w-full border rounded-lg px-4 py-2"
                disabled={saving || uploading}
                placeholder="Satış fiyatı"
                min={0}
                required
              />
            </div>
          </div>

          {/* ================= WATCH INFO ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="font-semibold text-lg">Saat Bilgileri</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Üretim yılı <span className="text-red-600">*</span>
                </div>
                <select
                  value={productionYear}
                  onChange={(e) => setProductionYear(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={saving || uploading}
                  required
                >
                  <option value="">Seç</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Cinsiyet <span className="text-red-600">*</span>
                </div>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={saving || uploading}
                  required
                >
                  <option value="">Seç</option>
                  <option value="Erkek">Erkek</option>
                  <option value="Kadın">Kadın</option>
                  <option value="Unisex">Unisex</option>
                  <option value="Diğer">Diğer</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Seri numarası <span className="text-red-600">*</span>
                </div>
                <input
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={saving || uploading}
                  placeholder="Seri numarası"
                  required
                />
              </div>

            </div>
          </div>

          {/* ================= CONDITION ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="font-semibold text-lg">Durum</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ✅ AŞINMA SEVİYESİ DROPDOWN */}
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Aşınma seviyesi <span className="text-red-600">*</span>
                </div>
                <select
                  value={wearLevel}
                  onChange={(e) => setWearLevel(e.target.value as any)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={saving || uploading}
                  required
                >
                  <option value="">Seç</option>
                  {wearLevelOptions.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Aksesuar durumu <span className="text-red-600">*</span>
                </div>
                <select
                  value={accessories}
                  onChange={(e) => setAccessories(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={saving || uploading}
                  required
                >
                  <option value="">Seç</option>
                  <option value="both">Orijinal kutu ve orijinal belgeler</option>
                  <option value="box">Orijinal kutu</option>
                  <option value="papers">Orijinal belgeler</option>
                  <option value="none">Başka aksesuar yok</option>
                </select>
              </div>
            </div>
          </div>

          {/* ================= DESCRIPTION ================= */}
          <div className="border rounded-2xl p-5 space-y-3">
            <div className="font-semibold text-lg">
              Açıklama <span className="text-red-600">*</span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded-lg px-4 py-2 min-h-[140px]"
              disabled={saving || uploading}
              placeholder="Açıklama (zorunlu)"
              required
            />
          </div>

          {/* ================= IMAGES ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold text-lg">
                  Fotoğraflar <span className="text-red-600">*</span>
                </div>
                <div className="text-sm text-gray-600">
                  En az 1, en fazla 5 fotoğraf olmalı.
                  <br />
                  Şu an: {remainingExistingUrls.length} mevcut + {newFiles.length} yeni ={" "}
                  <span className="font-semibold">{totalAfter}</span>
                </div>
              </div>

              <div className="text-sm text-gray-500">
                {maxNewFilesAllowed - newFiles.length <= 0
                  ? "Yeni fotoğraf limiti doldu."
                  : `Yeni ekleyebilirsin: ${maxNewFilesAllowed - newFiles.length}`}
              </div>
            </div>

            {/* Existing images */}
            {existingUrls.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Mevcut Fotoğraflar</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {existingUrls.map((url, idx) => {
                    const isRemoved = removedUrls.has(url);

                    return (
                      <div
                        key={`${url}-${idx}`}
                        className={`border rounded-xl overflow-hidden relative bg-white ${
                          isRemoved ? "opacity-40" : ""
                        }`}
                      >
                        <img
                          src={url}
                          alt={`existing-${idx}`}
                          className="w-full h-40 object-cover"
                          loading="lazy"
                        />

                        <div className="p-2 flex items-center justify-between gap-2">
                          <div className="text-xs text-gray-500 truncate">
                            Foto {idx + 1}
                          </div>

                          {!isRemoved ? (
                            <button
                              type="button"
                              onClick={() => removeExistingImage(url)}
                              className="text-xs text-red-600 underline"
                              disabled={saving || uploading}
                            >
                              Sil
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => undoRemoveExistingImage(url)}
                              className="text-xs text-blue-600 underline"
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

                {removedUrls.size > 0 && (
                  <div className="text-xs text-gray-500">
                    Silinenler kaydettiğinde Storage’dan da kaldırılacak.
                  </div>
                )}
              </div>
            )}

            {/* New files */}
            <div className="space-y-2">
              <div className="text-sm font-semibold">Yeni Fotoğraf Ekle</div>

              <label
                className={`block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
                  saving || uploading || maxNewFilesAllowed - newFiles.length <= 0
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-gray-50"
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

                <div className="text-base font-semibold text-gray-800">
                  📸 Fotoğraf Seç (Yeni)
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  JPG / PNG / WEBP — max 8MB — Kaydet’e basınca yüklenecek
                </div>
                <div className="text-xs text-gray-500 mt-1">Toplam limit: 5 fotoğraf</div>
              </label>

              {newFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-500">
                    Seçilen yeni dosyalar (Kaydet deyince yüklenecek):
                  </div>

                  <div className="space-y-2">
                    {newFiles.map((f, i) => (
                      <div
                        key={`${f.name}-${i}`}
                        className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2"
                      >
                        <div className="text-sm truncate">
                          {f.name}{" "}
                          <span className="text-xs text-gray-500">
                            ({Math.round(f.size / 1024)} KB)
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeNewFileAt(i)}
                          className="text-xs text-red-600 underline"
                          disabled={saving || uploading}
                        >
                          Kaldır
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Progress */}
            {uploading && (
              <div className="space-y-2">
                <div className="text-sm text-gray-700">
                  Resimler yükleniyor: %{uploadProgress}
                </div>
                <div className="w-full h-3 bg-gray-200 rounded">
                  <div
                    className="h-3 bg-green-600 rounded"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="text-xs text-gray-500">
              Not: Bu sayfada fotoğraf da zorunlu. Minimum 1 fotoğraf kalmak zorunda.
            </div>
          </div>

          {/* ================= ACTIONS ================= */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={saving || uploading}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
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
                  router.push(`/ilan/${listingId}`);
                  return;
                }
                const ok = confirm("Değişiklikleri kaydetmeden çıkmak istiyor musun?");
                if (ok) router.push(`/ilan/${listingId}`);
              }}
              disabled={saving || uploading}
              className="flex-1 border rounded-xl py-3 font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              Vazgeç
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Not: Foto silme işlemi kaydettiğinde Storage’dan da silinir. Yeni fotoğraflar
            kaydettiğinde yüklenir.
          </div>
        </form>
      </div>
    </div>
  );
}
