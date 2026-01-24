// app/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

/* ================= TYPES ================= */

type Brand = {
  id: string;
  name: string;
};

type Model = {
  id: string;
  name: string;
  brandId: string;
};

type PublicProfile = {
  onboardingCompleted?: boolean;
  name?: string;
  phone?: string;
  address?: string;
};

/* ================= HELPERS ================= */

function normalizeSpaces(v: string) {
  return (v || "").replace(/\s+/g, " ").trim();
}

function digitsOnly(v: string) {
  return (v || "").replace(/[^\d]/g, "");
}

function isValidName(name: string) {
  const n = normalizeSpaces(name);
  return n.length >= 2 && n.length <= 80;
}

function isValidAddress(address: string) {
  const a = normalizeSpaces(address);
  return a.length >= 10 && a.length <= 200;
}

function isValidPhone(phone: string) {
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
}

function formatMaybeInt(v: string) {
  const t = v.trim();
  if (!t) return "";
  return t.replace(/[^\d]/g, "");
}

/* ================= PAGE ================= */

export default function NewListingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  /* ================= FORM STATES ================= */

  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  const [productionYear, setProductionYear] = useState("");
  const [gender, setGender] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [movementType, setMovementType] = useState("");

  const [caseType, setCaseType] = useState("");
  const [diameterMm, setDiameterMm] = useState("");
  const [dialColor, setDialColor] = useState("");

  const [braceletMaterial, setBraceletMaterial] = useState("");
  const [braceletColor, setBraceletColor] = useState("");

  // ✅ Aşınma seviyesi ZORUNLU (dropdown)
  // none/light/medium/heavy (seçilmezse "" kalır ve submit olmaz)
  const [wearLevel, setWearLevel] = useState<
    "" | "none" | "light" | "medium" | "heavy"
  >("");

  const [accessories, setAccessories] = useState("");
  const [description, setDescription] = useState("");

  /* ======== MAX 5 IMAGE SYSTEM ======== */
  const [newFiles, setNewFiles] = useState<File[]>([]);

  /* ================= DATA ================= */

  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

  /* ================= ONBOARDING GATE ================= */

  const [gateChecking, setGateChecking] = useState(true);
  const [gateAllowed, setGateAllowed] = useState(false);
  const [profileSummary, setProfileSummary] = useState<PublicProfile | null>(
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

  /* ================= OPTIONS (HOOK ORDER SAFE) ================= */

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

  const caseTypeOptions = useMemo(() => {
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

  /* ================= AUTH + GATE CHECK ================= */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.uid);

      // 🔒 /new sayfasına girebilmek için onboardingCompleted şart
      try {
        setGateChecking(true);

        const publicRef = doc(db, "publicProfiles", user.uid);
        const snap = await getDoc(publicRef);

        if (!snap.exists()) {
          // Profil yoksa kesinlikle onboarding'e gönder
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

        const summary: PublicProfile = {
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

  /* ================= LOAD BRANDS ================= */

  useEffect(() => {
    const q = query(collection(db, "brands"), orderBy("nameLower", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setBrands(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
        }))
      );
    });
    return () => unsub();
  }, []);

  /* ================= LOAD MODELS ================= */

  useEffect(() => {
    if (!brandId) {
      setModels([]);
      setModelId("");
      return;
    }

    const q = query(
      collection(db, "models"),
      where("brandId", "==", brandId),
      orderBy("nameLower", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      setModels(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          brandId: d.data().brandId,
        }))
      );
    });

    return () => unsub();
  }, [brandId]);

  /* ================= HELPERS ================= */

  const accessoriesLabel = (v: string) => {
    if (v === "both") return "Orijinal kutu ve orijinal belgeler";
    if (v === "box") return "Orijinal kutu";
    if (v === "papers") return "Orijinal belgeler";
    if (v === "none") return "Başka aksesuar yok";
    return v;
  };

  const wearLevelLabel = (v: "" | "none" | "light" | "medium" | "heavy") => {
    if (v === "none") return "Aşınma yok";
    if (v === "light") return "Hafif aşınma";
    if (v === "medium") return "Orta aşınma";
    if (v === "heavy") return "Belirgin aşınma";
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
    const maxSize = 8 * 1024 * 1024;

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

  const onPickNewFiles = (files: FileList | null) => {
    if (!files) return;

    const picked = Array.from(files);
    const allowedLeft = 5 - newFiles.length;
    const slice = picked.slice(0, Math.max(0, allowedLeft));
    setNewFiles((prev) => [...prev, ...slice]);
  };

  const removeNewFileAt = (idx: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const uploadFilesWithProgress = async (
    listingId: string,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!userId) {
      setError("Giriş yapılmamış görünüyor.");
      return;
    }

    // Gate: UX emniyeti
    if (!gateAllowed) {
      setError("İlan verebilmek için önce profilini tamamlamalısın.");
      router.replace("/my?onboarding=1");
      return;
    }

    // ✅ HER ŞEY ZORUNLU
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

    if (!brandId) {
      setError("Marka seçmelisin.");
      return;
    }
    if (!modelId) {
      setError("Model seçmelisin.");
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

    if (!cleanProductionYear) {
      setError("Üretim yılı zorunlu.");
      return;
    }
    if (!cleanGender) {
      setError("Cinsiyet zorunlu.");
      return;
    }
    if (!cleanSerialNumber) {
      setError("Seri numarası zorunlu.");
      return;
    }
    if (!cleanMovementType) {
      setError("Çalışma şekli zorunlu.");
      return;
    }

    if (!cleanCaseType) {
      setError("Kasa tipi zorunlu.");
      return;
    }
    if (!cleanDiameter) {
      setError("Çap (mm) zorunlu.");
      return;
    }
    if (!cleanDialColor) {
      setError("Kadran rengi zorunlu.");
      return;
    }

    if (!cleanBraceletMaterial) {
      setError("Kordon malzemesi zorunlu.");
      return;
    }
    if (!cleanBraceletColor) {
      setError("Kordon rengi zorunlu.");
      return;
    }

    if (!wearLevel) {
      setError("Aşınma seviyesi zorunlu.");
      return;
    }

    if (!cleanAccessories) {
      setError("Aksesuar durumu zorunlu.");
      return;
    }

    if (!cleanDescription) {
      setError("Açıklama zorunlu.");
      return;
    }

    // ✅ Fotoğraf zorunlu
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

    const diameterNumber = Number(cleanDiameter);
    if (!Number.isFinite(diameterNumber) || diameterNumber <= 0) {
      setError("Çap (mm) geçersiz görünüyor.");
      return;
    }

    const brand = brands.find((b) => b.id === brandId);
    const model = models.find((m) => m.id === modelId);

    if (!brand || !model) {
      setError("Marka veya model hatalı.");
      return;
    }

    const fileError = validateFiles(newFiles);
    if (fileError) {
      setError(fileError);
      return;
    }

    try {
      setLoading(true);

      const listingRef = await addDoc(collection(db, "listings"), {
        title: cleanTitle,
        description: cleanDescription,
        price: priceNumber,

        productionYear: cleanProductionYear,
        gender: cleanGender,
        serialNumber: cleanSerialNumber,
        movementType: cleanMovementType,

        caseType: cleanCaseType,
        diameterMm: diameterNumber,
        dialColor: cleanDialColor,

        braceletMaterial: cleanBraceletMaterial,
        braceletColor: cleanBraceletColor,

        // ✅ Aşınma durumu (2 alan)
        wearExists: wearLevel !== "none",
        wearLevel: wearLevelLabel(wearLevel),

        accessories: accessoriesLabel(cleanAccessories),

        brandId,
        brandName: brand.name,
        modelId,
        modelName: model.name,

        ownerId: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        imageUrls: [],
      });

      const imageUrls = await uploadFilesWithProgress(listingRef.id, newFiles);

      // (Buraya gelmesi için en az 1 foto şartını zaten koyduk.)
      await updateDoc(listingRef, {
        imageUrls,
        updatedAt: serverTimestamp(),
      });

      router.push(`/ilan/${listingRef.id}`);
    } catch (err: any) {
      console.error(err);

      const code = err?.code || "";
      if (code === "permission-denied") {
        setError(
          "İlan yayınlamak için profilini tamamlamalısın. /my sayfasına yönlendiriliyorsun."
        );
        router.replace("/my?onboarding=1");
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
          <div className="text-lg font-semibold">Profilini tamamlaman gerekiyor</div>
          <div className="text-sm text-gray-600 mt-2">
            İlan verebilmek için önce profilinde zorunlu alanları doldurmalısın.
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

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="w-full max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Yeni İlan Ekle</h1>
            <div className="text-sm text-gray-600 mt-1">
              Tüm alanlar zorunludur. Eksik bırakılan yerde ilan yayınlanmaz.
            </div>
          </div>

          <button
            onClick={() => router.push("/")}
            className="text-sm underline text-gray-600"
            disabled={loading || uploading}
          >
            Vazgeç
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-100 p-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ================= BRAND & MODEL ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="font-semibold text-lg">Marka & Model</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Marka <span className="text-red-600">*</span>
                </div>
                <select
                  value={brandId}
                  onChange={(e) => {
                    setBrandId(e.target.value);
                    setModelId("");
                  }}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
                >
                  <option value="">Marka seç</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Model <span className="text-red-600">*</span>
                </div>
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={!brandId || loading || uploading}
                >
                  <option value="">
                    {brandId ? "Model seç" : "Önce marka seç"}
                  </option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
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
                disabled={loading || uploading}
                placeholder="İlan başlığı"
                maxLength={120}
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
                disabled={loading || uploading}
                placeholder="Satış fiyatı"
                min={0}
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
                  disabled={loading || uploading}
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
                  disabled={loading || uploading}
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
                  disabled={loading || uploading}
                  placeholder="Seri numarası"
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Çalışma şekli <span className="text-red-600">*</span>
                </div>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
                >
                  <option value="">Seç</option>
                  <option value="Otomatik">Otomatik</option>
                  <option value="Quartz">Quartz</option>
                  <option value="Manual">Manual</option>
                  <option value="Diğer">Diğer</option>
                </select>
              </div>
            </div>
          </div>

          {/* ================= CASE & DIAL ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="font-semibold text-lg">Kasa & Kadran</div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Kasa tipi <span className="text-red-600">*</span>
                </div>
                <select
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
                >
                  <option value="">Seç</option>
                  {caseTypeOptions.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Çap (mm) <span className="text-red-600">*</span>
                </div>
                <select
                  value={diameterMm}
                  onChange={(e) => setDiameterMm(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
                >
                  <option value="">Seç</option>
                  {diameterOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Kadran rengi <span className="text-red-600">*</span>
                </div>
                <input
                  value={dialColor}
                  onChange={(e) => setDialColor(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
                  placeholder="Örn: Siyah"
                />
              </div>
            </div>
          </div>

          {/* ================= BRACELET ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="font-semibold text-lg">Kordon</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Kordon malzemesi <span className="text-red-600">*</span>
                </div>
                <select
                  value={braceletMaterial}
                  onChange={(e) => setBraceletMaterial(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
                >
                  <option value="">Seç</option>
                  <option value="Çelik">Çelik</option>
                  <option value="Deri">Deri</option>
                  <option value="Kauçuk">Kauçuk</option>
                  <option value="NATO">NATO</option>
                  <option value="Titanyum">Titanyum</option>
                  <option value="Seramik">Seramik</option>
                  <option value="Kumaş">Kumaş</option>
                  <option value="Diğer">Diğer</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Kordon rengi <span className="text-red-600">*</span>
                </div>
                <input
                  value={braceletColor}
                  onChange={(e) => setBraceletColor(e.target.value)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
                  placeholder="Örn: Kahverengi"
                />
              </div>
            </div>
          </div>

          {/* ================= CONDITION ================= */}
          <div className="border rounded-2xl p-5 space-y-4">
            <div className="font-semibold text-lg">Durum</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">
                  Aşınma seviyesi <span className="text-red-600">*</span>
                </div>
                <select
                  value={wearLevel}
                  onChange={(e) => setWearLevel(e.target.value as any)}
                  className="w-full border rounded-lg px-4 py-2"
                  disabled={loading || uploading}
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
                  disabled={loading || uploading}
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
              disabled={loading || uploading}
              placeholder="Açıklama (zorunlu)"
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
                  En az 1, en fazla 5 fotoğraf yüklemelisin. (Şu an: {newFiles.length})
                </div>
              </div>

              <div className="text-sm text-gray-500">
                {newFiles.length >= 5 ? "Limit doldu." : `Kalan: ${5 - newFiles.length}`}
              </div>
            </div>

            <label
              className={`block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
                loading || uploading || newFiles.length >= 5
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
                disabled={loading || uploading || newFiles.length >= 5}
              />

              <div className="text-base font-semibold text-gray-800">📸 Fotoğraf Seç</div>
              <div className="text-xs text-gray-500 mt-1">
                JPG / PNG / WEBP — max 8MB — İlan yayınlanırken yüklenecek
              </div>
            </label>

            {newFiles.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-gray-500">Seçilen fotoğraflar:</div>

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
                        disabled={loading || uploading}
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
          </div>

          {/* ================= ACTIONS ================= */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={loading || uploading}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
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
              disabled={loading || uploading}
              className="flex-1 border rounded-xl py-3 font-semibold hover:bg-gray-50 disabled:opacity-50"
            >
              Vazgeç
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Not: Bu sayfada tüm alanlar zorunlu. Eksik veri veya fotoğraf olmadan ilan yayınlanmaz.
          </div>
        </form>
      </div>
    </div>
  );
}
