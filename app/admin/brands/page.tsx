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
  toNumOrNull,
  copyToClipboard,
} from "@/app/components/admin/ui";

/* =========================
   TYPES
========================= */

type Brand = {
  id: string;
  name: string;
  nameLower: string;
  createdAt?: any;
  updatedAt?: any;
};

type DateWindowPosition = "3" | "4.5" | "6";

type ModelDoc = {
  id: string;
  name: string;
  nameLower: string;
  brandId: string;

  movementNumber?: string;
  gender?: string;

  movementType?: string;
  caliber?: string;
  baseCaliber?: string;
  powerReserveH?: number | null;

  complications?: string[];
  hasDate?: boolean;
  dateWindowPosition?: DateWindowPosition | null;
  autoTags?: string[];

  caseMaterial?: string;
  caseShape?: string;
  diameterMm?: number | null;
  waterResistanceM?: number | null;
  bezelMaterial?: string;
  crystal?: string;

  dialNumerals?: string;
  description?: string;

  createdAt?: any;
  updatedAt?: any;
};

/* =========================
   PRESETS
========================= */

const COMPLICATION_PRESETS = [
  "GMT",
  "Date",
  "Chronograph",
  "Power Reserve",
  "Moonphase",
  "Day-Date",
  "Alarm",
  "Tourbillon",
];

/* =========================
   LIMITS
========================= */

const MAX_BRAND_NAME = 80;
const MAX_MODEL_NAME = 120;

/* =========================
   PAGE
========================= */

export default function AdminBrandsPage() {
  const { toast, showToast } = useToast();

  // Brands
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);

  const [brandName, setBrandName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Brands UX
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(40);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const trimmedInfo = useMemo(() => normalizeTextTR(brandName), [brandName]);
  const trimmedName = trimmedInfo.trimmed;
  const nameLower = trimmedInfo.lower;

  const normalizedSearch = useMemo(
    () => normalizeTextTR(search).lower,
    [search]
  );

  // Models Panel
  const modelsPanelRef = useRef<HTMLDivElement | null>(null);
  const modelFormRef = useRef<HTMLDivElement | null>(null);

  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelsBrandId, setModelsBrandId] = useState<string>("");

  const [models, setModels] = useState<ModelDoc[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSearch, setModelsSearch] = useState("");

  const [savingModel, setSavingModel] = useState(false);
  const [modelError, setModelError] = useState("");

  // Model edit state
  const [editingModelId, setEditingModelId] = useState<string | null>(null);

  // Model form
  const [modelName, setModelName] = useState("");
  const modelTrimmed = useMemo(
    () => normalizeTextTR(modelName).trimmed,
    [modelName]
  );
  const modelLower = useMemo(
    () => normalizeTextTR(modelName).lower,
    [modelName]
  );

  const [movementNumber, setMovementNumber] = useState("");
  const [gender, setGender] = useState("");

  const [movementType, setMovementType] = useState("");
  const [caliber, setCaliber] = useState("");
  const [baseCaliber, setBaseCaliber] = useState("");
  const [powerReserveH, setPowerReserveH] = useState("");

  const [caseMaterial, setCaseMaterial] = useState("");
  const [caseShape, setCaseShape] = useState("");
  const [diameterMm, setDiameterMm] = useState("");
  const [waterResistanceM, setWaterResistanceM] = useState("");
  const [bezelMaterial, setBezelMaterial] = useState("");
  const [crystal, setCrystal] = useState("");

  const [dialNumerals, setDialNumerals] = useState("");
  const [selectedComplications, setSelectedComplications] = useState<string[]>(
    []
  );
  const [dateWindowPosition, setDateWindowPosition] = useState<
    DateWindowPosition | ""
  >("");
  const [description, setDescription] = useState("");

  const selectedBrandForModels = useMemo(() => {
    if (!modelsBrandId) return null;
    return brands.find((b) => b.id === modelsBrandId) || null;
  }, [brands, modelsBrandId]);

  const hasDateSelected = selectedComplications.includes("Date");

  /* ================= LOAD BRANDS (LIVE) ================= */

  useEffect(() => {
    setBrandsLoading(true);

    const q = query(collection(db, "brands"), orderBy("nameLower", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Brand, "id">),
        })) as Brand[];

        setBrands(data);
        setBrandsLoading(false);

        // modelsBrandId boşsa ilk markaya bağla
        setModelsBrandId((prev) => {
          if (prev) return prev;
          return data[0]?.id || "";
        });
      },
      () => setBrandsLoading(false)
    );

    return () => unsub();
  }, []);

  /* ================= ADD BRAND ================= */

  const handleAddBrand = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!trimmedName) {
      setError("Marka adı boş olamaz.");
      return;
    }

    if (trimmedName.length > MAX_BRAND_NAME) {
      setError(`Marka adı çok uzun. (max ${MAX_BRAND_NAME} karakter)`);
      return;
    }

    const exists = brands.some((b) => safeString(b.nameLower, "") === nameLower);
    if (exists) {
      setError("Bu marka zaten var.");
      return;
    }

    try {
      setSaving(true);

      await addDoc(collection(db, "brands"), {
        name: trimmedName,
        nameLower,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setBrandName("");
      showToast({
        type: "success",
        title: "Marka eklendi",
        text: `"${trimmedName}" başarıyla eklendi.`,
      });
    } catch {
      setError("Marka eklenirken hata oluştu.");
      showToast({
        type: "error",
        title: "Kayıt başarısız",
        text: "Marka eklenemedi. Tekrar dene.",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ================= EDIT BRAND ================= */

  const beginEdit = (b: Brand) => {
    setError("");
    setEditingId(b.id);
    setEditingValue(safeString(b.name, ""));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue("");
  };

  const saveEdit = async (b: Brand) => {
    setError("");

    const { trimmed, lower } = normalizeTextTR(editingValue);

    if (!trimmed) {
      setError("Marka adı boş olamaz.");
      return;
    }

    if (trimmed.length > MAX_BRAND_NAME) {
      setError(`Marka adı çok uzun. (max ${MAX_BRAND_NAME} karakter)`);
      return;
    }

    const already = brands.some(
      (x) => x.id !== b.id && safeString(x.nameLower, "") === lower
    );
    if (already) {
      setError("Bu marka adı zaten var.");
      return;
    }

    try {
      setSaving(true);

      await updateDoc(doc(db, "brands", b.id), {
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

  /* ================= DELETE BRAND ================= */

  const handleDeleteBrand = async (brand: Brand) => {
    setError("");

    const ok = confirm(
      `"${brand.name}" markasını silmek istiyor musun?\n\n⚠️ Bu markaya bağlı modeller varsa sorun çıkarabilir.`
    );
    if (!ok) return;

    try {
      setSaving(true);

      // Soft safety check: models var mı
      try {
        const modelsSnap = await getDocs(
          query(
            collection(db, "models"),
            where("brandId", "==", brand.id),
            limit(1)
          )
        );
        if (!modelsSnap.empty) {
          const sure = confirm(
            `"${brand.name}" markasına bağlı en az 1 model var.\n\nYine de silmek istiyor musun?`
          );
          if (!sure) {
            setSaving(false);
            return;
          }
        }
      } catch {
        // ignore
      }

      await deleteDoc(doc(db, "brands", brand.id));
      showToast({
        type: "success",
        title: "Silindi",
        text: `"${brand.name}" kaldırıldı.`,
      });

      if (editingId === brand.id) cancelEdit();

      // eğer model paneli bu markadaysa kapat
      if (modelsBrandId === brand.id) {
        setModelsOpen(false);
        setModelsBrandId("");
        setModels([]);
        setEditingModelId(null);
      }
    } catch {
      showToast({
        type: "error",
        title: "Silinemedi",
        text: "Marka silinirken hata oluştu.",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ================= COMPUTED BRANDS ================= */

  const filteredBrands = useMemo(() => {
    const s = normalizedSearch;
    const list = [...brands];

    if (!s) return list;

    return list.filter((b) => {
      const n = safeString(b.nameLower, "").toLocaleLowerCase("tr-TR");
      const id = safeString(b.id, "").toLowerCase();
      return n.includes(s) || id.includes(s);
    });
  }, [brands, normalizedSearch]);

  const pagedBrands = useMemo(() => {
    const p = clampInt(pageSize, 10, 200);
    return filteredBrands.slice(0, p);
  }, [filteredBrands, pageSize]);

  const canLoadMore = filteredBrands.length > pagedBrands.length;

  /* ================= MODELS: OPEN PANEL ================= */

  const openModelsForBrand = (b: Brand) => {
    setModelsOpen(true);
    setModelsBrandId(b.id);
    setModelsSearch("");

    showToast({
      type: "info",
      title: "Model Yönetimi",
      text: `"${b.name}" markasının modelleri açıldı.`,
    });

    setTimeout(() => {
      modelsPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  };

  /* ================= LOAD MODELS (LIVE) ================= */

  useEffect(() => {
    if (!modelsOpen || !modelsBrandId) {
      setModels([]);
      return;
    }

    setModelsLoading(true);

    const q = query(
      collection(db, "models"),
      where("brandId", "==", modelsBrandId),
      orderBy("nameLower", "asc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ModelDoc[];

        setModels(data);
        setModelsLoading(false);
      },
      () => {
        setModels([]);
        setModelsLoading(false);
      }
    );

    return () => unsub();
  }, [modelsOpen, modelsBrandId]);

  const filteredModels = useMemo(() => {
    const q = normalizeTextTR(modelsSearch).lower;
    if (!q) return models;
    return models.filter((m) =>
      safeString(m.nameLower, m.name.toLowerCase()).includes(q)
    );
  }, [models, modelsSearch]);

  /* ================= MODELS HELPERS ================= */

  const toggleComplication = (c: string) => {
    setSelectedComplications((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const buildAutoTags = (hasDate: boolean, hasGMT: boolean) => {
    const tags: string[] = [];
    if (hasGMT && hasDate) tags.push("GMT-Date");
    else if (hasGMT) tags.push("GMT");
    else if (hasDate) tags.push("Date");
    return tags;
  };

  useEffect(() => {
    if (!selectedComplications.includes("Date")) setDateWindowPosition("");
  }, [selectedComplications]);

  /* ================= MODEL FORM UTILS ================= */

  const resetModelForm = () => {
    setEditingModelId(null);
    setModelName("");
    setMovementNumber("");
    setGender("");
    setMovementType("");
    setCaliber("");
    setBaseCaliber("");
    setPowerReserveH("");
    setCaseMaterial("");
    setCaseShape("");
    setDiameterMm("");
    setWaterResistanceM("");
    setBezelMaterial("");
    setCrystal("");
    setDialNumerals("");
    setSelectedComplications([]);
    setDateWindowPosition("");
    setDescription("");
    setModelError("");
  };

  const beginModelEdit = (m: ModelDoc) => {
    setModelError("");

    // Panel açık + doğru marka
    if (!modelsOpen) setModelsOpen(true);
    if (m.brandId && m.brandId !== modelsBrandId) setModelsBrandId(m.brandId);

    setEditingModelId(m.id);

    // Formu doldur
    setModelName(safeString(m.name, ""));
    setMovementNumber(safeString(m.movementNumber, ""));
    setGender(safeString(m.gender, ""));
    setMovementType(safeString(m.movementType, ""));
    setCaliber(safeString(m.caliber, ""));
    setBaseCaliber(safeString(m.baseCaliber, ""));
    setPowerReserveH(
      m.powerReserveH == null ? "" : String(m.powerReserveH)
    );

    setCaseMaterial(safeString(m.caseMaterial, ""));
    setCaseShape(safeString(m.caseShape, ""));
    setDiameterMm(m.diameterMm == null ? "" : String(m.diameterMm));
    setWaterResistanceM(
      m.waterResistanceM == null ? "" : String(m.waterResistanceM)
    );
    setBezelMaterial(safeString(m.bezelMaterial, ""));
    setCrystal(safeString(m.crystal, ""));
    setDialNumerals(safeString(m.dialNumerals, ""));

    const comps = Array.isArray(m.complications) ? m.complications : [];
    setSelectedComplications(comps);

    const dwp =
      m.dateWindowPosition === "3" ||
      m.dateWindowPosition === "4.5" ||
      m.dateWindowPosition === "6"
        ? m.dateWindowPosition
        : "";
    setDateWindowPosition(dwp);

    setDescription(safeString(m.description, ""));

    showToast({
      type: "info",
      title: "Model Düzenle",
      text: `"${safeString(m.name, "Model")}" düzenleniyor.`,
    });

    setTimeout(() => {
      modelFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  };

  /* ================= ADD / UPDATE MODEL ================= */

  const handleSaveModel = async (e: FormEvent) => {
    e.preventDefault();
    setModelError("");

    if (!modelsBrandId) {
      setModelError("Önce marka seç.");
      return;
    }

    if (!modelTrimmed) {
      setModelError("Model adı boş olamaz.");
      return;
    }

    if (modelTrimmed.length > MAX_MODEL_NAME) {
      setModelError(`Model adı çok uzun. (max ${MAX_MODEL_NAME} karakter)`);
      return;
    }

    const duplicate = models.some(
      (x) =>
        safeString(x.nameLower, "") === modelLower &&
        x.id !== (editingModelId || "")
    );
    if (duplicate) {
      setModelError("Bu model zaten var.");
      return;
    }

    const hasDate = selectedComplications.includes("Date");
    const hasGMT = selectedComplications.includes("GMT");
    const autoTags = buildAutoTags(hasDate, hasGMT);

    try {
      setSavingModel(true);

      // EDIT
      if (editingModelId) {
        await updateDoc(doc(db, "models", editingModelId), {
          name: modelTrimmed,
          nameLower: modelLower,
          brandId: modelsBrandId,

          movementNumber: movementNumber.trim(),
          gender: gender.trim(),

          movementType: movementType.trim(),
          caliber: caliber.trim(),
          baseCaliber: baseCaliber.trim(),
          powerReserveH: toNumOrNull(powerReserveH),

          caseMaterial: caseMaterial.trim(),
          caseShape: caseShape.trim(),
          diameterMm: toNumOrNull(diameterMm),
          waterResistanceM: toNumOrNull(waterResistanceM),
          bezelMaterial: bezelMaterial.trim(),
          crystal: crystal.trim(),

          dialNumerals: dialNumerals.trim(),

          complications: selectedComplications,
          hasDate,
          dateWindowPosition: hasDate ? (dateWindowPosition || null) : null,
          autoTags,

          description: description.trim(),
          updatedAt: serverTimestamp(),
        });

        showToast({
          type: "success",
          title: "Güncellendi",
          text: `"${modelTrimmed}" kaydedildi.`,
        });

        resetModelForm();
        return;
      }

      // ADD
      await addDoc(collection(db, "models"), {
        name: modelTrimmed,
        nameLower: modelLower,
        brandId: modelsBrandId,

        movementNumber: movementNumber.trim(),
        gender: gender.trim(),

        movementType: movementType.trim(),
        caliber: caliber.trim(),
        baseCaliber: baseCaliber.trim(),
        powerReserveH: toNumOrNull(powerReserveH),

        caseMaterial: caseMaterial.trim(),
        caseShape: caseShape.trim(),
        diameterMm: toNumOrNull(diameterMm),
        waterResistanceM: toNumOrNull(waterResistanceM),
        bezelMaterial: bezelMaterial.trim(),
        crystal: crystal.trim(),

        dialNumerals: dialNumerals.trim(),

        complications: selectedComplications,
        hasDate,
        dateWindowPosition: hasDate ? (dateWindowPosition || null) : null,
        autoTags,

        description: description.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      showToast({
        type: "success",
        title: "Model eklendi",
        text: `"${modelTrimmed}" eklendi.`,
      });

      resetModelForm();
    } catch {
      setModelError(editingModelId ? "Model güncellenirken hata oluştu." : "Model eklenirken hata oluştu.");
      showToast({
        type: "error",
        title: "Hata",
        text: editingModelId ? "Model güncellenemedi." : "Model eklenemedi.",
      });
    } finally {
      setSavingModel(false);
    }
  };

  /* ================= DELETE MODEL ================= */

  const handleDeleteModel = async (m: ModelDoc) => {
    if (!confirm(`"${m.name}" silinsin mi?`)) return;

    try {
      await deleteDoc(doc(db, "models", m.id));

      // Eğer şu an editliyorsak formu da kapat
      if (editingModelId === m.id) {
        resetModelForm();
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
        text: "Model silinirken hata oluştu.",
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
              Marka Yönetimi
            </div>
            <div className="mt-1 text-sm text-gray-600">
              Marka ekle, düzenle, sil. Modelleri aynı sayfada yönet.
            </div>
          </div>

          <div className="flex gap-2">
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

            {modelsOpen && (
              <button
                type="button"
                onClick={() => {
                  setModelsOpen(false);
                  resetModelForm();
                  showToast({
                    type: "info",
                    title: "Kapatıldı",
                    text: "Model paneli kapandı.",
                  });
                }}
                className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
              >
                ✖️ Model Paneli
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
              placeholder="Marka adı veya ID ara…"
              className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200"
            />
            <div className="mt-1 text-[11px] text-gray-500">
              Toplam:{" "}
              <span className="font-medium text-gray-800">{brands.length}</span>{" "}
              • Gösterilen:{" "}
              <span className="font-medium text-gray-800">
                {pagedBrands.length}
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

      {/* Add brand */}
      <div className="border rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Yeni Marka Ekle
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Marka adı tekil olmalı (küçük/büyük harf fark etmez).
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Örn: <span className="font-mono">Rolex</span>,{" "}
            <span className="font-mono">Omega</span>
          </div>
        </div>

        <form
          onSubmit={handleAddBrand}
          className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"
        >
          <div>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Marka adı…"
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
            />

            {error && <div className="mt-2 text-sm text-red-700">{error}</div>}

            {trimmedName && (
              <div className="mt-2 text-[11px] text-gray-500">
                Kaydedilecek:{" "}
                <span className="font-medium text-gray-900">{trimmedName}</span>{" "}
                <span className="mx-1">•</span>
                Key: <span className="font-mono">{nameLower}</span>
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
            {saving ? "Ekleniyor..." : "Marka Ekle"}
          </button>
        </form>
      </div>

      {/* Brands list */}
      <div className="border rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Marka Listesi
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Edit ile isim düzelt, 🧩 ile aynı sayfada modelleri yönet.
            </div>
          </div>
        </div>

        <div className="mt-4">
          {brandsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : pagedBrands.length === 0 ? (
            <div className="border rounded-2xl bg-gray-50 p-6 text-gray-600">
              <div className="font-semibold text-gray-900">Sonuç bulunamadı</div>
              <div className="mt-1 text-sm">Aramayı değiştir veya temizle.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {pagedBrands.map((b) => {
                const isEditing = editingId === b.id;

                return (
                  <div
                    key={b.id}
                    className="border rounded-2xl p-4 hover:bg-gray-50 transition"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-gray-500">Marka</div>

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
                              placeholder="Yeni marka adı…"
                            />
                            <div className="mt-1 text-[11px] text-gray-500">
                              Key:{" "}
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
                            created:{" "}
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
                                    text: "Brand ID panoya kopyalandı.",
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
                          onClick={() => openModelsForBrand(b)}
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                        >
                          🧩 Modeller
                        </button>

                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => beginEdit(b)}
                            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                          >
                            ✏️ Edit
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
                          onClick={() => handleDeleteBrand(b)}
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

      {/* MODELS PANEL */}
      <div ref={modelsPanelRef} className="border rounded-2xl bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Katalog</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">
              Model Yönetimi
            </div>
            <div className="mt-1 text-sm text-gray-600">
              Markadan 🧩 tıklayınca burada açılır. Ayrı sayfa yok.
            </div>
          </div>

          <div className="flex gap-2">
            {modelsOpen ? (
              <button
                type="button"
                onClick={() => {
                  setModelsOpen(false);
                  resetModelForm();
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
                    title: "Model Paneli",
                    text: "Bir markanın yanında 🧩 Modeller’e bas.",
                  })
                }
                className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
              >
                ℹ️ Nasıl açarım?
              </button>
            )}
          </div>
        </div>

        {!modelsOpen ? (
          <div className="mt-4 border rounded-2xl bg-gray-50 p-5 text-gray-700">
            <div className="font-semibold text-gray-900">Model paneli kapalı</div>
            <div className="mt-1 text-sm">
              Marka listesinde istediğin markanın <b>🧩 Modeller</b> butonuna bas.
              Model yönetimi burada açılacak.
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">Seçili Marka</div>
                <select
                  value={modelsBrandId}
                  onChange={(e) => {
                    setModelsBrandId(e.target.value);
                    // Marka değiştiyse edit modunu kapat (karışmasın)
                    resetModelForm();
                  }}
                  className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200 bg-white"
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>

                <div className="mt-1 text-[11px] text-gray-500">
                  Marka:{" "}
                  <span className="font-medium text-gray-900">
                    {selectedBrandForModels?.name || "-"}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Model Ara</div>
                <input
                  value={modelsSearch}
                  onChange={(e) => setModelsSearch(e.target.value)}
                  placeholder="Model ara…"
                  className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                />
                <div className="mt-1 text-[11px] text-gray-500">
                  Toplam:{" "}
                  <span className="font-medium text-gray-900">{models.length}</span>{" "}
                  • Gösterilen:{" "}
                  <span className="font-medium text-gray-900">
                    {filteredModels.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Add/Edit model form */}
            <div ref={modelFormRef} className="mt-5 border rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {editingModelId ? "Model Düzenle" : "Yeni Model Ekle"}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {editingModelId
                      ? "Düzenleme aynı sayfada yapılır. Kaydedince anında güncellenir."
                      : "Bu model seçili markaya eklenecek."}
                  </div>
                </div>

                {editingModelId ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetModelForm();
                      showToast({
                        type: "info",
                        title: "İptal",
                        text: "Model düzenleme iptal edildi.",
                      });
                    }}
                    className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                  >
                    İptal
                  </button>
                ) : null}
              </div>

              <form onSubmit={handleSaveModel} className="mt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    label="Model adı"
                    value={modelName}
                    onChange={setModelName}
                    placeholder="Örn: Submariner"
                  />
                  <Field
                    label="Mekanizma numarası"
                    value={movementNumber}
                    onChange={setMovementNumber}
                    placeholder="Örn: 3135"
                  />

                  <Field
                    label="Cinsiyet"
                    value={gender}
                    onChange={setGender}
                    placeholder="Unisex / Erkek / Kadın"
                  />
                  <Field
                    label="Çalışma şekli"
                    value={movementType}
                    onChange={setMovementType}
                    placeholder="Automatic / Quartz"
                  />

                  <Field label="Kalibre" value={caliber} onChange={setCaliber} />
                  <Field
                    label="Temel kalibre"
                    value={baseCaliber}
                    onChange={setBaseCaliber}
                  />

                  <Field
                    label="Güç rezervi (saat)"
                    value={powerReserveH}
                    onChange={setPowerReserveH}
                    type="number"
                  />
                  <div />

                  <Field
                    label="Kasa malzemesi"
                    value={caseMaterial}
                    onChange={setCaseMaterial}
                  />
                  <Field
                    label="Kasa şekli"
                    value={caseShape}
                    onChange={setCaseShape}
                  />

                  <Field
                    label="Kasa çapı (mm)"
                    value={diameterMm}
                    onChange={setDiameterMm}
                    type="number"
                  />
                  <Field
                    label="Su geçirmezlik (m)"
                    value={waterResistanceM}
                    onChange={setWaterResistanceM}
                    type="number"
                  />

                  <Field
                    label="Bezel malzemesi"
                    value={bezelMaterial}
                    onChange={setBezelMaterial}
                  />
                  <Field label="Cam tipi" value={crystal} onChange={setCrystal} />

                  <Field
                    label="Sayı / kadran"
                    value={dialNumerals}
                    onChange={setDialNumerals}
                  />
                  <div />
                </div>

                <div className="border rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">
                      Komplikasyonlar
                    </div>
                    <div className="text-xs text-gray-500">
                      seçili: {selectedComplications.length}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {COMPLICATION_PRESETS.map((c) => (
                      <label
                        key={c}
                        className="flex items-center gap-2 text-sm border rounded-xl px-3 py-2 bg-white"
                      >
                        <input
                          type="checkbox"
                          checked={selectedComplications.includes(c)}
                          onChange={() => toggleComplication(c)}
                        />
                        {c}
                      </label>
                    ))}
                  </div>

                  <div className="mt-3">
                    <div className="text-xs text-gray-500 mb-1">
                      Gün penceresi yönü
                    </div>
                    <select
                      value={dateWindowPosition}
                      onChange={(e) =>
                        setDateWindowPosition(
                          e.target.value as DateWindowPosition
                        )
                      }
                      disabled={!hasDateSelected}
                      className={cx(
                        "w-full border rounded-xl px-4 py-2.5 text-sm bg-white",
                        !hasDateSelected && "opacity-60"
                      )}
                    >
                      <option value="">(Seç)</option>
                      <option value="3">Saat 3</option>
                      <option value="4.5">4–5 arası</option>
                      <option value="6">Saat 6</option>
                    </select>

                    {!hasDateSelected && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        Not: “Date” seçilmeden aktif olmaz.
                      </div>
                    )}
                  </div>
                </div>

                <div className="border rounded-2xl p-4">
                  <div className="text-sm font-semibold text-gray-900">
                    Saat Açıklaması
                  </div>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Saatin karakteri, kullanım amacı, tasarım dili, öne çıkan özellikleri..."
                    className="mt-2 w-full border rounded-xl px-4 py-3 text-sm min-h-[140px] outline-none focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                {modelError && (
                  <div className="text-sm text-red-700">{modelError}</div>
                )}

                <button
                  disabled={savingModel}
                  className={cx(
                    "w-full py-3 rounded-xl text-sm font-semibold text-white",
                    savingModel
                      ? "bg-green-400"
                      : "bg-green-600 hover:bg-green-700"
                  )}
                >
                  {savingModel
                    ? editingModelId
                      ? "Güncelleniyor..."
                      : "Ekleniyor..."
                    : editingModelId
                    ? "Modeli Güncelle"
                    : "Model Ekle"}
                </button>
              </form>
            </div>

            {/* Models list */}
            <div className="mt-5">
              <div className="text-sm font-semibold text-gray-900">Model Listesi</div>
              <div className="mt-1 text-xs text-gray-500">
                Sil butonu sadece o modeli kaldırır. Edit ile gömülü düzenlersin.
              </div>

              <div className="mt-3">
                {modelsLoading ? (
                  <div className="space-y-2">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </div>
                ) : filteredModels.length === 0 ? (
                  <div className="border rounded-2xl bg-gray-50 p-5 text-gray-700">
                    Bu markada model yok.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredModels.map((m) => {
                      const comps = Array.isArray(m.complications)
                        ? m.complications
                        : [];
                      const tags = Array.isArray(m.autoTags) ? m.autoTags : [];
                      const isEditingModel = editingModelId === m.id;

                      return (
                        <div
                          key={m.id}
                          className={cx(
                            "border rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3",
                            isEditingModel && "ring-2 ring-gray-200"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-semibold text-gray-900 truncate">
                                {m.name}
                              </div>

                              {isEditingModel && (
                                <span className="text-[11px] px-2 py-1 rounded-xl border bg-gray-900 text-white">
                                  Düzenleniyor
                                </span>
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap gap-1">
                              {tags.map((t) => (
                                <span
                                  key={t}
                                  className="text-[11px] px-2 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700"
                                >
                                  {t}
                                </span>
                              ))}
                              {comps.slice(0, 4).map((c) => (
                                <span
                                  key={c}
                                  className="text-[11px] px-2 py-1 rounded-full bg-gray-50 border text-gray-700"
                                >
                                  {c}
                                </span>
                              ))}
                              {comps.length > 4 && (
                                <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 border text-gray-600">
                                  +{comps.length - 4}
                                </span>
                              )}
                            </div>

                            <div className="mt-1 text-[11px] text-gray-500 font-mono">
                              {m.id}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => beginModelEdit(m)}
                              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
                            >
                              ✏️ Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteModel(m)}
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
        Not: Model yönetimi ayrı route olmadan /admin/brands içinde panel olarak çalışır.
      </div>
    </div>
  );
}
