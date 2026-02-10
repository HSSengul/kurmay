// app/admin/listing-schemas/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

/* =========================
   TYPES
========================= */

type Category = {
  id: string;
  name: string;
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

type ListingSchemaDoc = {
  categoryId: string;
  version: number;
  fields: SchemaField[];
  updatedAt?: any;
  createdAt?: any;
};

/* =========================
   HELPERS
========================= */

function safeString(v: any, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function clampInt(n: number, a: number, b: number) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function normalizeSpaces(v: string) {
  return (v || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(input: string) {
  // key: küçük harf + sayı + altçizgi, boşluk yok
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

function parseOptions(input: string) {
  // virgül ile ayır, trimle, boşları at
  return normalizeSpaces(input)
    .split(",")
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function isFieldType(x: any): x is FieldType {
  return x === "text" || x === "number" || x === "select" || x === "boolean" || x === "multiselect";
}

function prettyJson(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return "";
  }
}

/* =========================
   PAGE
========================= */

export default function AdminListingSchemasPage() {
  const router = useRouter();

  /* ================= AUTH / ADMIN GATE ================= */

  const [authChecking, setAuthChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  /* ================= BRANDS ================= */

  const [categories, setCategories] = useState<Category[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  /* ================= SCHEMA STATE ================= */

  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaExists, setSchemaExists] = useState(false);

  const [schemaVersion, setSchemaVersion] = useState<number>(1);
  const [fields, setFields] = useState<SchemaField[]>([]);

  // metadata
  const [schemaMeta, setSchemaMeta] = useState<{ createdAt?: any; updatedAt?: any } | null>(null);

  /* ================= UI STATE ================= */

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>("");
  const [ok, setOk] = useState<string>("");

  const okTimerRef = useRef<any>(null);

  const showOk = (msg: string) => {
    setOk(msg);
    if (okTimerRef.current) clearTimeout(okTimerRef.current);
    okTimerRef.current = setTimeout(() => setOk(""), 2200);
  };

  useEffect(() => {
    return () => {
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
    };
  }, []);

  /* ================= ADMIN CHECK ================= */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthChecking(true);
      setError("");
      setOk("");

      if (!u) {
        setUserId(null);
        setIsAdmin(false);
        setAuthChecking(false);
        router.replace("/login");
        return;
      }

      setUserId(u.uid);

      try {
        const uRef = doc(db, "users", u.uid);
        const uSnap = await getDoc(uRef);

        if (!uSnap.exists()) {
          setIsAdmin(false);
          setAuthChecking(false);
          router.replace("/");
          return;
        }

        const role = safeString(uSnap.data()?.role, "");
        const adminOk = role === "admin";

        setIsAdmin(adminOk);
        setAuthChecking(false);

        if (!adminOk) router.replace("/");
      } catch (e: any) {
        console.error("Admin check error:", e);
        setIsAdmin(false);
        setAuthChecking(false);
        router.replace("/");
      }
    });

    return () => unsub();
  }, [router]);

  /* ================= LOAD BRANDS ================= */

  useEffect(() => {
    if (!isAdmin) return;

    const q = query(collection(db, "categories"), orderBy("nameLower", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Category[] = snap.docs.map((d) => ({
          id: d.id,
          name: safeString(d.data()?.name, d.id),
        }));
        setCategories(list);

        // ilk kategori otomatik sec (istersen)
        if (!selectedCategoryId && list.length > 0) {
          setSelectedCategoryId(list[0].id);
        }
      },
      (err) => {
        console.error("categories onSnapshot error:", err);
        setCategories([]);
      }
    );

    return () => unsub();
  }, [isAdmin]);

  /* ================= LOAD SCHEMA ================= */

  useEffect(() => {
    if (!isAdmin) return;

    if (!selectedCategoryId) {
      setSchemaExists(false);
      setSchemaVersion(1);
      setFields([]);
      setSchemaMeta(null);
      return;
    }

    let alive = true;

    const run = async () => {
      setSchemaLoading(true);
      setError("");
      setOk("");

      try {
        const ref = doc(db, "listingSchemas", selectedCategoryId);
        const snap = await getDoc(ref);

        if (!alive) return;

        if (!snap.exists()) {
          setSchemaExists(false);
          setSchemaVersion(1);
          setFields([]);
          setSchemaMeta(null);
          return;
        }

        const d = snap.data() as ListingSchemaDoc;

        const v = Number(d?.version ?? 1) || 1;
        const fs = Array.isArray(d?.fields) ? d.fields : [];

        // normalize minimal
        const normalized: SchemaField[] = fs
          .map((f) => ({
            key: safeString(f.key, ""),
            label: safeString(f.label, ""),
            type: isFieldType(f.type) ? f.type : "text",
            required: !!f.required,
            placeholder: f.placeholder ? safeString(f.placeholder, "") : "",
            min: typeof f.min === "number" ? f.min : f.min === null ? null : undefined,
            max: typeof f.max === "number" ? f.max : f.max === null ? null : undefined,
            options: Array.isArray(f.options) ? f.options.map((x: any) => safeString(x, "")).filter(Boolean) : [],
          }))
          .filter((f) => f.key && f.label);

        setSchemaExists(true);
        setSchemaVersion(v);
        setFields(normalized);
        setSchemaMeta({ createdAt: (d as any)?.createdAt, updatedAt: (d as any)?.updatedAt });
      } catch (e: any) {
        console.error("load schema error:", e);
        setSchemaExists(false);
        setSchemaVersion(1);
        setFields([]);
        setSchemaMeta(null);
      } finally {
        if (alive) setSchemaLoading(false);
      }
    };

    run();

    return () => {
      alive = false;
    };
  }, [isAdmin, selectedCategoryId]);

  /* ================= FILTERED BRANDS ================= */

  const filteredCategories = useMemo(() => {
    const q = normalizeSpaces(categorySearch).toLowerCase();
    if (!q) return categories;
    return categories.filter((b) => b.name.toLowerCase().includes(q));
  }, [categories, categorySearch]);

  const selectedCategory = useMemo(() => {
    return categories.find((b) => b.id === selectedCategoryId) || null;
  }, [categories, selectedCategoryId]);

  /* ================= FIELD OPS ================= */

  const addField = () => {
    setError("");
    setOk("");

    // default key
    const baseKey = "yeni_alan";
    const existing = new Set(fields.map((f) => f.key));
    let k = baseKey;
    let i = 1;
    while (existing.has(k)) {
      k = `${baseKey}_${i}`;
      i++;
    }

    const f: SchemaField = {
      key: k,
      label: "Yeni Alan",
      type: "text",
      required: false,
      placeholder: "",
      min: null,
      max: null,
      options: [],
    };

    setFields((prev) => [...prev, f]);
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    setFields((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;

      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const updateField = (idx: number, patch: Partial<SchemaField>) => {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== idx) return f;
        return { ...f, ...patch };
      })
    );
  };

  /* ================= VALIDATION ================= */

  const validateSchema = () => {
    if (!selectedCategoryId) return "Kategori seçmelisin.";

    const v = Number(schemaVersion);
    if (!Number.isFinite(v) || v < 1 || v > 1000) {
      return "Version 1 - 1000 arasında olmalı.";
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      return "En az 1 alan eklemelisin.";
    }

    const keys = fields.map((f) => normalizeKey(f.key));
    const keySet = new Set<string>();

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];

      const k = normalizeKey(f.key);
      const label = normalizeSpaces(f.label);

      if (!k) return `Alan #${i + 1}: key zorunlu.`;
      if (!label) return `Alan #${i + 1}: label zorunlu.`;
      if (!isFieldType(f.type)) return `Alan #${i + 1}: type geçersiz.`;

      if (keySet.has(k)) return `Key tekrar ediyor: "${k}"`;
      keySet.add(k);

      if (f.type === "number") {
        const min = f.min ?? null;
        const max = f.max ?? null;

        if (min !== null && typeof min !== "number") return `Alan "${k}": min sayı olmalı.`;
        if (max !== null && typeof max !== "number") return `Alan "${k}": max sayı olmalı.`;
        if (min !== null && max !== null && min > max) return `Alan "${k}": min > max olamaz.`;
      }

      if (f.type === "select" || f.type === "multiselect") {
        const opts = Array.isArray(f.options) ? f.options : [];
        const cleanOpts = opts.map((x) => normalizeSpaces(String(x))).filter(Boolean);

        if (cleanOpts.length === 0) {
          return `Alan "${k}": options zorunlu (en az 1).`;
        }
      }
    }

    return "";
  };

  /* ================= SAVE / DELETE ================= */

  const saveSchema = async () => {
    setError("");
    setOk("");

    const err = validateSchema();
    if (err) {
      setError(err);
      return;
    }

    try {
      setSaving(true);

      // normalize output
      const normalizedFields: SchemaField[] = fields.map((f) => {
        const k = normalizeKey(f.key);
        const label = normalizeSpaces(f.label);

        const out: SchemaField = {
          key: k,
          label,
          type: f.type,
          required: !!f.required,
        };

        const placeholder = normalizeSpaces(safeString(f.placeholder, ""));
        if (placeholder) out.placeholder = placeholder;

        if (f.type === "number") {
          out.min = typeof f.min === "number" ? f.min : f.min === null ? null : null;
          out.max = typeof f.max === "number" ? f.max : f.max === null ? null : null;
        } else {
          // diğer tiplerde min/max temizle
          out.min = null;
          out.max = null;
        }

        if (f.type === "select" || f.type === "multiselect") {
          const opts = uniq((f.options || []).map((x) => normalizeSpaces(String(x))).filter(Boolean));
          out.options = opts;
        } else {
          out.options = [];
        }

        return out;
      });

      const ref = doc(db, "listingSchemas", selectedCategoryId);

      // create/update
      await setDoc(
        ref,
        {
          categoryId: selectedCategoryId,
          version: clampInt(Number(schemaVersion), 1, 1000),
          fields: normalizedFields,
          updatedAt: serverTimestamp(),
          createdAt: schemaExists ? (schemaMeta?.createdAt || serverTimestamp()) : serverTimestamp(),
        },
        { merge: true }
      );

      setSchemaExists(true);
      showOk("Kaydedildi ✅");
    } catch (e: any) {
      console.error("saveSchema error:", e);
      const code = e?.code || "";
      if (code === "permission-denied") {
        setError("Yetki hatası (permission-denied). Admin olarak giriş yaptığından emin ol.");
      } else {
        setError(e?.message || "Kaydetme sırasında hata oluştu.");
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteSchema = async () => {
    setError("");
    setOk("");

    if (!selectedCategoryId) return;

    const sure = confirm("Şema silinecek. Emin misin?");
    if (!sure) return;

    try {
      setDeleting(true);
      await deleteDoc(doc(db, "listingSchemas", selectedCategoryId));

      setSchemaExists(false);
      setSchemaVersion(1);
      setFields([]);
      setSchemaMeta(null);

      showOk("Silindi ✅");
    } catch (e: any) {
      console.error("deleteSchema error:", e);
      setError(e?.message || "Silme sırasında hata oluştu.");
    } finally {
      setDeleting(false);
    }
  };

  /* ================= RENDER ================= */

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gray-100 p-10 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow p-6 w-full max-w-md text-center">
          <div className="text-lg font-semibold">Kontrol ediliyor...</div>
          <div className="text-sm text-gray-500 mt-2">Admin yetkisi doğrulanıyor.</div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-100 p-10 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow p-6 w-full max-w-md text-center">
          <div className="text-lg font-semibold text-red-700">Erişim yok</div>
          <div className="text-sm text-gray-500 mt-2">Bu sayfa sadece admin içindir.</div>
          <button
            onClick={() => router.replace("/")}
            className="mt-5 w-full bg-gray-900 hover:bg-black text-white font-semibold py-3 rounded-xl"
          >
            Ana sayfaya dön
          </button>
        </div>
      </div>
    );
  }

  const schemaPreview = {
    categoryId: selectedCategoryId,
    version: schemaVersion,
    fields: fields,
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="bg-white rounded-2xl shadow p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">İlan Şemaları</div>
            <div className="text-sm text-gray-500">
              Kategoriye göre dinamik form alanlarını yönet.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-400">
              UID: <span className="font-mono">{userId}</span>
            </div>
          </div>
        </div>

        {/* STATUS */}
        {(error || ok) && (
          <div
            className={`rounded-2xl border p-4 text-sm ${
              error
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-green-50 border-green-200 text-green-700"
            }`}
          >
            {error || ok}
          </div>
        )}

        {/* GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
          {/* LEFT: BRAND LIST */}
          <div className="bg-white rounded-2xl shadow p-5 space-y-4 h-fit">
            <div className="font-semibold">Kategoriler</div>

            <input
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              className="w-full border rounded-xl px-4 py-2 text-sm"
              placeholder="Ara..."
            />

            <div className="max-h-[520px] overflow-auto border rounded-xl">
              {filteredCategories.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">Kategori bulunamadı.</div>
              ) : (
                <div className="divide-y">
                  {filteredCategories.map((b) => {
                    const active = b.id === selectedCategoryId;
                    return (
                      <button
                        key={b.id}
                        onClick={() => setSelectedCategoryId(b.id)}
                        className={`w-full text-left px-4 py-3 text-sm transition ${
                          active ? "bg-gray-900 text-white" : "hover:bg-gray-50"
                        }`}
                      >
                        <div className="font-semibold">{b.name}</div>
                        <div className={`text-xs ${active ? "text-gray-200" : "text-gray-400"}`}>
                          {b.id}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="text-xs text-gray-500">
              Seçili:{" "}
              <span className="font-semibold">
                {selectedCategory ? selectedCategory.name : "—"}
              </span>
            </div>
          </div>

          {/* RIGHT: EDITOR */}
          <div className="bg-white rounded-2xl shadow p-6 space-y-6">
            {/* TOP BAR */}
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xl font-bold">
                  {selectedCategory ? selectedCategory.name : "Kategori seç"}
                </div>

                <div className="text-sm text-gray-500">
                  Doküman ID: <span className="font-mono">{selectedCategoryId || "—"}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                      schemaExists
                        ? "bg-green-50 border-green-200 text-green-700"
                        : "bg-gray-50 border-gray-200 text-gray-600"
                    }`}
                  >
                    {schemaLoading ? "Yükleniyor..." : schemaExists ? "Şema var ✅" : "Şema yok ❌"}
                  </span>

                  {schemaMeta?.updatedAt && (
                    <span className="text-xs text-gray-400">
                      Güncelleme: <span className="font-mono">{String(schemaMeta.updatedAt)}</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={addField}
                  disabled={!selectedCategoryId || saving || deleting}
                  className="px-4 py-2 rounded-xl bg-gray-900 hover:bg-black text-white text-sm font-semibold disabled:opacity-50"
                >
                  + Alan Ekle
                </button>

                <button
                  onClick={saveSchema}
                  disabled={!selectedCategoryId || saving || deleting}
                  className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {saving ? "Kaydediliyor..." : "Kaydet"}
                </button>

                <button
                  onClick={deleteSchema}
                  disabled={!schemaExists || saving || deleting}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {deleting ? "Siliniyor..." : "Sil"}
                </button>
              </div>
            </div>

            {/* VERSION */}
            <div className="border rounded-2xl p-5 space-y-3">
              <div className="font-semibold">Şema Sürümü</div>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={schemaVersion}
                  onChange={(e) => setSchemaVersion(clampInt(Number(e.target.value || 1), 1, 1000))}
                  className="w-40 border rounded-xl px-4 py-2"
                  min={1}
                  max={1000}
                  disabled={!selectedCategoryId || saving || deleting}
                />

                <div className="text-sm text-gray-500">
                  Yeni alan eklediğinde ileride migration için version kullanacağız.
                </div>
              </div>
            </div>

            {/* FIELDS */}
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-lg">Alanlar</div>
                <div className="text-xs text-gray-500">{fields.length} alan</div>
              </div>

              {fields.length === 0 ? (
                <div className="text-sm text-gray-500 border rounded-2xl p-5">
                  Henüz alan yok. <b>+ Alan Ekle</b> ile başlayabilirsin.
                </div>
              ) : (
                <div className="space-y-4">
                  {fields.map((f, idx) => {
                    const isSelectLike = f.type === "select" || f.type === "multiselect";
                    const isNumber = f.type === "number";

                    const optionsText = isSelectLike ? (f.options || []).join(", ") : "";

                    return (
                      <div key={`${f.key}-${idx}`} className="border rounded-2xl p-5 space-y-4">
                        {/* ROW TOP */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-700">
                              #{idx + 1}
                            </div>

                            <div className="text-sm text-gray-500">
                              key:{" "}
                              <span className="font-mono font-semibold text-gray-900">
                                {normalizeKey(f.key)}
                              </span>
                            </div>

                            {f.required && (
                              <div className="text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700">
                                zorunlu
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => moveField(idx, -1)}
                              disabled={idx === 0 || saving || deleting}
                              className="px-3 py-2 rounded-xl border text-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                              ↑
                            </button>

                            <button
                              onClick={() => moveField(idx, 1)}
                              disabled={idx === fields.length - 1 || saving || deleting}
                              className="px-3 py-2 rounded-xl border text-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                              ↓
                            </button>

                            <button
                              onClick={() => removeField(idx)}
                              disabled={saving || deleting}
                              className="px-3 py-2 rounded-xl border text-sm hover:bg-gray-50 text-red-700 disabled:opacity-50"
                            >
                              Kaldır
                            </button>
                          </div>
                        </div>

                        {/* ROW GRID */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <div className="text-sm font-semibold">
                              Key <span className="text-red-600">*</span>
                            </div>
                            <input
                              value={f.key}
                              onChange={(e) => updateField(idx, { key: normalizeKey(e.target.value) })}
                              className="w-full border rounded-xl px-4 py-2"
                              placeholder="örn: productionYear"
                              disabled={saving || deleting}
                            />
                            <div className="text-xs text-gray-500">
                              Sadece <span className="font-mono">a-z 0-9 _</span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm font-semibold">
                              Label <span className="text-red-600">*</span>
                            </div>
                            <input
                              value={f.label}
                              onChange={(e) => updateField(idx, { label: e.target.value })}
                              className="w-full border rounded-xl px-4 py-2"
                              placeholder="Örn: Üretim Yılı"
                              disabled={saving || deleting}
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm font-semibold">Type</div>
                            <select
                              value={f.type}
                              onChange={(e) => {
                                const t = e.target.value as FieldType;

                                // type değişince bazı alanları temizle
                                if (t === "number") {
                                  updateField(idx, { type: t, options: [], min: f.min ?? null, max: f.max ?? null });
                                } else if (t === "select" || t === "multiselect") {
                                  updateField(idx, { type: t, options: f.options || ["Seçenek 1"], min: null, max: null });
                                } else {
                                  updateField(idx, { type: t, options: [], min: null, max: null });
                                }
                              }}
                              className="w-full border rounded-xl px-4 py-2"
                              disabled={saving || deleting}
                            >
                              <option value="text">text</option>
                              <option value="number">number</option>
                              <option value="select">select</option>
                              <option value="multiselect">multiselect</option>
                              <option value="boolean">boolean</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm font-semibold">Zorunlu</div>
                            <select
                              value={f.required ? "yes" : "no"}
                              onChange={(e) => updateField(idx, { required: e.target.value === "yes" })}
                              className="w-full border rounded-xl px-4 py-2"
                              disabled={saving || deleting}
                            >
                              <option value="no">Hayır</option>
                              <option value="yes">Evet</option>
                            </select>
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <div className="text-sm font-semibold">Placeholder (opsiyonel)</div>
                            <input
                              value={f.placeholder || ""}
                              onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                              className="w-full border rounded-xl px-4 py-2"
                              placeholder="Örn: 2020 / Siyah / 42mm"
                              disabled={saving || deleting}
                            />
                          </div>

                          {/* NUMBER MIN/MAX */}
                          {isNumber && (
                            <>
                              <div className="space-y-2">
                                <div className="text-sm font-semibold">Min (opsiyonel)</div>
                                <input
                                  type="number"
                                  value={typeof f.min === "number" ? f.min : ""}
                                  onChange={(e) => {
                                    const v = e.target.value.trim();
                                    updateField(idx, { min: v === "" ? null : Number(v) });
                                  }}
                                  className="w-full border rounded-xl px-4 py-2"
                                  disabled={saving || deleting}
                                />
                              </div>

                              <div className="space-y-2">
                                <div className="text-sm font-semibold">Max (opsiyonel)</div>
                                <input
                                  type="number"
                                  value={typeof f.max === "number" ? f.max : ""}
                                  onChange={(e) => {
                                    const v = e.target.value.trim();
                                    updateField(idx, { max: v === "" ? null : Number(v) });
                                  }}
                                  className="w-full border rounded-xl px-4 py-2"
                                  disabled={saving || deleting}
                                />
                              </div>
                            </>
                          )}

                          {/* SELECT/MULTI OPTIONS */}
                          {isSelectLike && (
                            <div className="space-y-2 md:col-span-2">
                              <div className="text-sm font-semibold">
                                Options <span className="text-red-600">*</span>{" "}
                                <span className="text-xs text-gray-500">(virgülle ayır)</span>
                              </div>

                              <textarea
                                value={optionsText}
                                onChange={(e) => {
                                  const opts = parseOptions(e.target.value);
                                  updateField(idx, { options: opts });
                                }}
                                className="w-full border rounded-xl px-4 py-2 min-h-[90px]"
                                placeholder="Örn: Siyah, Beyaz, Mavi"
                                disabled={saving || deleting}
                              />

                              <div className="text-xs text-gray-500">
                                Kaydedilirken otomatik trim + duplicate temizlenir.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* PREVIEW */}
            <div className="border rounded-2xl p-5 space-y-3">
              <div className="font-semibold">JSON Önizleme</div>
              <pre className="text-xs bg-gray-50 border rounded-xl p-4 overflow-auto max-h-[340px]">
                {prettyJson(schemaPreview)}
              </pre>
              <div className="text-xs text-gray-500">
                Bu doc <span className="font-mono">listingSchemas/{selectedCategoryId || "..."}</span>{" "}
                olarak kaydedilir.
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER NOTE */}
        <div className="text-xs text-gray-500">
          Not: Bu sayfa sadece admin. Yeni İlan sayfası bu şemayı okuyup
          <span className="font-mono"> attributes + schemaVersion</span> alanlarını ilana yazar.
        </div>
      </div>
    </div>
  );
}
