"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

/* =========================
   TYPES
========================= */

type CategoryDoc = {
  name: string;
  nameLower: string;
  parentId: string | null; // null = main category
  order: number;
  enabled: boolean;
  icon?: string;
  imageUrl?: string;
  createdAt?: any;
  updatedAt?: any;
};

type CategoryRow = CategoryDoc & { id: string };

/* =========================
   HELPERS
========================= */

function normalizeTR(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replaceAll("İ", "i")
    .replaceAll("I", "i")
    .replaceAll("ı", "i")
    .replaceAll("Ş", "s")
    .replaceAll("ş", "s")
    .replaceAll("Ğ", "g")
    .replaceAll("ğ", "g")
    .replaceAll("Ü", "u")
    .replaceAll("ü", "u")
    .replaceAll("Ö", "o")
    .replaceAll("ö", "o")
    .replaceAll("Ç", "c")
    .replaceAll("ç", "c");
}

function slugifyTR(s: string) {
  const base = normalizeTR(s)
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "kategori";
}

function safeInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/* =========================
   DEFAULT SEED
========================= */

type SeedItem = {
  id: string;
  name: string;
  icon?: string;
  order: number;
  subs: { id: string; name: string; order: number; icon?: string }[];
};

const DEFAULT_SEED: SeedItem[] = [
  {
    id: "kutu-oyunlari",
    name: "Kutu Oyunları",
    icon: "🎲",
    order: 10,
    subs: [
      { id: "kutu-oyunlari__kutu-oyunlari", name: "Kutu Oyunları (Genel)", order: 10, icon: "📦" },
      { id: "kutu-oyunlari__kart-oyunlari", name: "Kart Oyunları", order: 20, icon: "🃏" },
      { id: "kutu-oyunlari__parti-oyunlari", name: "Parti Oyunları", order: 30, icon: "🥳" },
      { id: "kutu-oyunlari__strateji-eurogame", name: "Strateji / Eurogame", order: 40, icon: "♟️" },
      { id: "kutu-oyunlari__tematik", name: "Tematik", order: 50, icon: "🎭" },
      { id: "kutu-oyunlari__wargame", name: "Wargame", order: 60, icon: "🪖" },
      { id: "kutu-oyunlari__kooperatif", name: "Kooperatif", order: 70, icon: "🤝" },
      { id: "kutu-oyunlari__aile", name: "Aile", order: 80, icon: "👨‍👩‍👧‍👦" },
      { id: "kutu-oyunlari__cocuk", name: "Çocuk", order: 90, icon: "🧸" },
      { id: "kutu-oyunlari__dedektif-escape", name: "Dedektif / Escape Room", order: 100, icon: "🕵️" },
      { id: "kutu-oyunlari__rpg", name: "Rol Yapma (RPG / D&D)", order: 110, icon: "🐉" },
      { id: "kutu-oyunlari__miniature", name: "Miniature Games", order: 120, icon: "🧙" },
      { id: "kutu-oyunlari__expansion", name: "Ek Paket (Expansion)", order: 130, icon: "➕" },
      { id: "kutu-oyunlari__promo", name: "Promo / Promo Kart", order: 140, icon: "⭐" },
      { id: "kutu-oyunlari__insert", name: "Insert / Organizer", order: 150, icon: "🧩" },
      { id: "kutu-oyunlari__playmat", name: "Oyun Matı (Playmat)", order: 160, icon: "🟩" },
      { id: "kutu-oyunlari__zar-token", name: "Zar / Token", order: 170, icon: "🎯" },
      { id: "kutu-oyunlari__yedek-parca", name: "Yedek Parça / Eksik Parça", order: 180, icon: "🛠️" },
    ],
  },
  {
    id: "konsollar",
    name: "Konsollar",
    icon: "🎮",
    order: 20,
    subs: [
      { id: "konsollar__playstation", name: "PlayStation Konsollar", order: 10, icon: "🟦" },
      { id: "konsollar__xbox", name: "Xbox Konsollar", order: 20, icon: "🟩" },
      { id: "konsollar__nintendo", name: "Nintendo Konsollar", order: 30, icon: "🔴" },
      { id: "konsollar__retro", name: "Retro Konsollar", order: 40, icon: "🕹️" },
      { id: "konsollar__vr", name: "VR Başlıklar", order: 50, icon: "🥽" },
      { id: "konsollar__parca-servis", name: "Mod / Tamir / Parça", order: 60, icon: "🔧" },
    ],
  },
  {
    id: "el-konsollari",
    name: "El Konsolları",
    icon: "📱",
    order: 25,
    subs: [
      { id: "el-konsollari__nintendo", name: "Nintendo El Konsolları", order: 10, icon: "🔴" },
      { id: "el-konsollari__playstation", name: "PlayStation El Konsolları", order: 20, icon: "🟦" },
      { id: "el-konsollari__pc", name: "PC / Windows El Konsolları", order: 30, icon: "💻" },
      { id: "el-konsollari__retro", name: "Retro El Konsolları", order: 40, icon: "🕹️" },
      { id: "el-konsollari__parca-servis", name: "Mod / Tamir / Parça", order: 50, icon: "🔧" },
    ],
  },
  {
    id: "konsol-oyunlari",
    name: "Konsol Oyunları",
    icon: "💿",
    order: 30,
    subs: [
      { id: "konsol-oyunlari__playstation", name: "PlayStation Oyunları", order: 10, icon: "🟦" },
      { id: "konsol-oyunlari__xbox", name: "Xbox Oyunları", order: 20, icon: "🟩" },
      { id: "konsol-oyunlari__nintendo", name: "Nintendo Oyunları", order: 30, icon: "🔴" },
      { id: "konsol-oyunlari__retro", name: "Retro Oyunlar", order: 40, icon: "🕹️" },
      { id: "konsol-oyunlari__koleksiyon", name: "Koleksiyon Sürümleri", order: 50, icon: "🏆" },
      { id: "konsol-oyunlari__steelbook", name: "Steelbook / Özel Baskı", order: 60, icon: "📀" },
      { id: "konsol-oyunlari__kodlar", name: "Oyun Kodları (PSN/Xbox/Nintendo)", order: 70, icon: "🔑" },
      { id: "konsol-oyunlari__dlc", name: "DLC / Season Pass", order: 80, icon: "🧾" },
    ],
  },
  {
    id: "ekipman",
    name: "Konsol & PC Ekipmanları",
    icon: "🧰",
    order: 40,
    subs: [
      { id: "ekipman__controller", name: "Controller / Gamepad", order: 10, icon: "🎮" },
      { id: "ekipman__dock-sarj", name: "Şarj Standı / Dock", order: 20, icon: "🔌" },
      { id: "ekipman__direksiyon", name: "Direksiyon Seti (Wheel)", order: 30, icon: "🏎️" },
      { id: "ekipman__pedal-shifter", name: "Pedal / Shifter", order: 40, icon: "🦶" },
      { id: "ekipman__arcade-stick", name: "Arcade Stick", order: 50, icon: "🕹️" },
      { id: "ekipman__vr-aksesuar", name: "VR Aksesuarları", order: 60, icon: "🥽" },
      { id: "ekipman__headset", name: "Kulaklık / Headset", order: 70, icon: "🎧" },
      { id: "ekipman__mikrofon", name: "Mikrofon", order: 80, icon: "🎙️" },
      { id: "ekipman__kamera", name: "Kamera (Stream)", order: 90, icon: "📷" },
      { id: "ekipman__capture", name: "Capture Card", order: 100, icon: "🧲" },
      { id: "ekipman__klavye-mouse", name: "Klavye / Mouse", order: 110, icon: "⌨️" },
      { id: "ekipman__mousepad", name: "Mousepad", order: 120, icon: "🟫" },
      { id: "ekipman__kablo-adaptor", name: "Kablo / Adaptör", order: 130, icon: "🧵" },
      { id: "ekipman__depolama", name: "Depolama (HDD/SSD)", order: 140, icon: "💾" },
      { id: "ekipman__case", name: "Taşıma Çantası / Case", order: 150, icon: "🧳" },
    ],
  },
  {
    id: "figurler",
    name: "Figürler",
    icon: "🧸",
    order: 50,
    subs: [
      { id: "figurler__anime", name: "Anime Figürleri", order: 10, icon: "🍥" },
      { id: "figurler__marvel-dc", name: "Marvel / DC", order: 20, icon: "🦸" },
      { id: "figurler__star-wars", name: "Star Wars", order: 30, icon: "✨" },
      { id: "figurler__oyun", name: "Oyun Figürleri", order: 40, icon: "🗡️" },
      { id: "figurler__funko", name: "Funko Pop & Vinyl", order: 50, icon: "👀" },
      { id: "figurler__nendoroid-figma", name: "Nendoroid / Figma", order: 60, icon: "🙂" },
      { id: "figurler__action-figure", name: "Action Figure", order: 70, icon: "💥" },
      { id: "figurler__statue", name: "Statue / Büst / Diorama", order: 80, icon: "🗿" },
      { id: "figurler__model-kit", name: "Model Kit (Gunpla vb.)", order: 90, icon: "🤖" },
      { id: "figurler__3d-print", name: "3D Printed Figür", order: 100, icon: "🖨️" },
      { id: "figurler__aksesuar-parca", name: "Stand / Parça / Aksesuar", order: 110, icon: "🧩" },
    ],
  },
  {
    id: "tcg",
    name: "TCG",
    icon: "🃏",
    order: 60,
    subs: [
      { id: "tcg__pokemon", name: "Pokémon TCG", order: 10, icon: "⚡" },
      { id: "tcg__yugioh", name: "Yu-Gi-Oh!", order: 20, icon: "🌀" },
      { id: "tcg__mtg", name: "Magic: The Gathering", order: 30, icon: "🧙" },
      { id: "tcg__one-piece", name: "One Piece TCG", order: 40, icon: "🏴‍☠️" },
      { id: "tcg__digimon", name: "Digimon TCG", order: 50, icon: "🐲" },
      { id: "tcg__lorcana", name: "Lorcana", order: 60, icon: "🏰" },
      { id: "tcg__tekli", name: "Tekli Kart (Singles)", order: 70, icon: "🪙" },
      { id: "tcg__booster", name: "Booster / Pack", order: 80, icon: "🎁" },
      { id: "tcg__deck", name: "Deck / Structure Deck", order: 90, icon: "📦" },
      { id: "tcg__sleeve", name: "Sleeve", order: 100, icon: "🧤" },
      { id: "tcg__binder", name: "Binder / Albüm", order: 110, icon: "📚" },
      { id: "tcg__deckbox", name: "Deck Box", order: 120, icon: "🧱" },
      { id: "tcg__playmat", name: "Playmat", order: 130, icon: "🟩" },
      { id: "tcg__zar-token", name: "Zar / Token / Sayaç", order: 140, icon: "🎯" },
    ],
  },
  {
    id: "manga-cizgi-roman",
    name: "Manga / Çizgi Roman",
    icon: "📚",
    order: 70,
    subs: [
      { id: "manga-cizgi-roman__manga", name: "Manga", order: 10, icon: "📗" },
      { id: "manga-cizgi-roman__cizgi-roman", name: "Çizgi Roman", order: 20, icon: "📘" },
      { id: "manga-cizgi-roman__light-novel", name: "Light Novel", order: 30, icon: "📙" },
      { id: "manga-cizgi-roman__artbook", name: "Artbook", order: 40, icon: "🎨" },
      { id: "manga-cizgi-roman__koleksiyon", name: "Koleksiyon Ciltleri", order: 50, icon: "🏛️" },
      { id: "manga-cizgi-roman__rehber", name: "Rehber / Tasarım Kitabı", order: 60, icon: "📝" },
    ],
  },
  {
    id: "lego-hobi",
    name: "LEGO / Hobi",
    icon: "🧱",
    order: 80,
    subs: [
      { id: "lego-hobi__lego-set", name: "LEGO Setleri", order: 10, icon: "🧱" },
      { id: "lego-hobi__minifig", name: "MiniFig / Parça", order: 20, icon: "🧑" },
      { id: "lego-hobi__technic", name: "Technic / Creator", order: 30, icon: "⚙️" },
      { id: "lego-hobi__puzzle", name: "Puzzle", order: 40, icon: "🧩" },
      { id: "lego-hobi__model-kit", name: "Maket / Model Kit", order: 50, icon: "🛩️" },
      { id: "lego-hobi__paint", name: "Boyama / Mini Paint", order: 60, icon: "🖌️" },
      { id: "lego-hobi__airbrush", name: "Airbrush / Hobi Ekipman", order: 70, icon: "💨" },
    ],
  },
  {
    id: "dekor-poster",
    name: "Dekor / Poster",
    icon: "🖼️",
    order: 90,
    subs: [
      { id: "dekor-poster__poster", name: "Poster", order: 10, icon: "🧷" },
      { id: "dekor-poster__canvas", name: "Canvas / Tablo", order: 20, icon: "🖼️" },
      { id: "dekor-poster__sticker", name: "Sticker / Print", order: 30, icon: "🏷️" },
      { id: "dekor-poster__raf", name: "Raf / Display Stand", order: 40, icon: "🧱" },
      { id: "dekor-poster__led", name: "LED / Işık Dekor", order: 50, icon: "💡" },
      { id: "dekor-poster__diorama", name: "Diorama Dekor", order: 60, icon: "🏞️" },
    ],
  },
  {
    id: "teknoloji",
    name: "Teknoloji",
    icon: "🖥️",
    order: 100,
    subs: [
      { id: "teknoloji__retro-emu", name: "Retro Emülatör Cihazları", order: 10, icon: "🕹️" },
      { id: "teknoloji__mini-pc", name: "Mini PC", order: 20, icon: "🧠" },
      { id: "teknoloji__stream", name: "Streaming Ekipmanları", order: 30, icon: "📡" },
      { id: "teknoloji__mod", name: "Mod Ekipmanları", order: 40, icon: "🌈" },
    ],
  },
  {
    id: "diger",
    name: "Diğer",
    icon: "🧩",
    order: 110,
    subs: [
      { id: "diger__bluray", name: "Blu-ray / Steelbook Film", order: 10, icon: "🎬" },
      { id: "diger__soundtrack", name: "Oyun Soundtrack (CD/Vinyl)", order: 20, icon: "🎵" },
      { id: "diger__koleksiyon", name: "Koleksiyon Eşyası", order: 30, icon: "🏺" },
      { id: "diger__mystery", name: "Mystery Box / Sürpriz Set", order: 40, icon: "🎁" },
      { id: "diger__karisik", name: "Karışık Geek Ürün", order: 50, icon: "🌀" },
    ],
  },
];

/* =========================
   PAGE
========================= */

export default function AdminCategoriesPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [error, setError] = useState("");

  const [selectedMainId, setSelectedMainId] = useState<string>("");

  const [newMainName, setNewMainName] = useState("");
  const [newMainIcon, setNewMainIcon] = useState("");
  const [newMainOrder, setNewMainOrder] = useState<number>(10);
  const [newMainImageUrl, setNewMainImageUrl] = useState("");

  const [newSubName, setNewSubName] = useState("");
  const [newSubIcon, setNewSubIcon] = useState("");
  const [newSubOrder, setNewSubOrder] = useState<number>(10);
  const [dragMainId, setDragMainId] = useState<string | null>(null);
  const [dragSubId, setDragSubId] = useState<string | null>(null);
  const [uploadingMainId, setUploadingMainId] = useState<string | null>(null);

  async function loadAll() {
    setError("");
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "categories"));
      const data: CategoryRow[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as CategoryDoc),
      }));
      setRows(data);
      // seçili ana kategori yoksa ilk ana kategoriye seç
      const mains = data.filter((x) => x.parentId == null);
      const first = mains.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
      if (!selectedMainId && first?.id) setSelectedMainId(first.id);
    } catch (e: any) {
      setError(e?.message || "Kategori yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const mains = useMemo(() => {
    return rows
      .filter((x) => x.parentId == null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [rows]);

  const subs = useMemo(() => {
    return rows
      .filter((x) => x.parentId === selectedMainId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [rows, selectedMainId]);

  async function createMain() {
    setError("");
    const name = newMainName.trim();
    if (!name) return setError("Ana kategori adı boş olamaz.");

    try {
      await addDoc(collection(db, "categories"), {
        name,
        nameLower: normalizeTR(name),
        parentId: null,
        order: safeInt(newMainOrder, 10),
        enabled: true,
        icon: (newMainIcon || "").trim() || undefined,
        imageUrl: (newMainImageUrl || "").trim() || undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies CategoryDoc);

      setNewMainName("");
      setNewMainIcon("");
      setNewMainOrder(10);
      setNewMainImageUrl("");
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Ana kategori eklenemedi.");
    }
  }

  async function createSub() {
    setError("");
    const name = newSubName.trim();
    if (!selectedMainId) return setError("Önce ana kategori seç.");
    if (!name) return setError("Alt kategori adı boş olamaz.");

    try {
      await addDoc(collection(db, "categories"), {
        name,
        nameLower: normalizeTR(name),
        parentId: selectedMainId,
        order: safeInt(newSubOrder, 10),
        enabled: true,
        icon: (newSubIcon || "").trim() || undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } satisfies CategoryDoc);

      setNewSubName("");
      setNewSubIcon("");
      setNewSubOrder(10);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Alt kategori eklenemedi.");
    }
  }

  async function toggleEnabled(id: string, next: boolean) {
    setError("");
    try {
      await updateDoc(doc(db, "categories", id), {
        enabled: next,
        updatedAt: serverTimestamp(),
      });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Güncellenemedi.");
    }
  }

  async function updateName(id: string, nextName: string) {
    setError("");
    const name = nextName.trim();
    if (!name) return setError("İsim boş olamaz.");
    try {
      await updateDoc(doc(db, "categories", id), {
        name,
        nameLower: normalizeTR(name),
        updatedAt: serverTimestamp(),
      });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "İsim güncellenemedi.");
    }
  }

  async function updateOrder(id: string, nextOrder: number) {
    setError("");
    try {
      await updateDoc(doc(db, "categories", id), {
        order: safeInt(nextOrder, 0),
        updatedAt: serverTimestamp(),
      });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Sıra güncellenemedi.");
    }
  }

  function moveById<T extends { id: string }>(
    items: T[],
    draggedId: string,
    targetId: string
  ) {
    if (draggedId === targetId) return items;
    const from = items.findIndex((x) => x.id === draggedId);
    const to = items.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) return items;
    const next = [...items];
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked);
    return next;
  }

  async function persistOrder(list: CategoryRow[]) {
    const batch = writeBatch(db);
    list.forEach((item, index) => {
      const order = (index + 1) * 10;
      batch.update(doc(db, "categories", item.id), {
        order,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  async function handleReorder(
    list: CategoryRow[],
    draggedId: string,
    targetId: string
  ) {
    const next = moveById(list, draggedId, targetId);
    if (next === list) return;
    try {
      await persistOrder(next);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Sıralama güncellenemedi.");
    }
  }

  async function updateIcon(id: string, nextIcon: string) {
    setError("");
    try {
      await updateDoc(doc(db, "categories", id), {
        icon: (nextIcon || "").trim() || undefined,
        updatedAt: serverTimestamp(),
      });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "İkon güncellenemedi.");
    }
  }

  async function updateImageUrl(id: string, nextUrl: string) {
    setError("");
    try {
      await updateDoc(doc(db, "categories", id), {
        imageUrl: (nextUrl || "").trim() || undefined,
        updatedAt: serverTimestamp(),
      });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Görsel güncellenemedi.");
    }
  }

  async function uploadMainImage(id: string, file: File) {
    if (!file) return;
    setError("");

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const maxBytes = 2 * 1024 * 1024;

    if (!allowed.includes(file.type)) {
      setError("Sadece JPG / PNG / WEBP yükleyebilirsin.");
      return;
    }
    if (file.size > maxBytes) {
      setError("Görsel çok büyük. 2MB altı yükle.");
      return;
    }

    try {
      setUploadingMainId(id);
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const imageRef = ref(storage, `categoryCovers/${id}/${Date.now()}_${safeName}`);
      await uploadBytes(imageRef, file);
      const url = await getDownloadURL(imageRef);

      await updateDoc(doc(db, "categories", id), {
        imageUrl: url,
        updatedAt: serverTimestamp(),
      });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Görsel yüklenemedi.");
    } finally {
      setUploadingMainId(null);
    }
  }

  async function removeCategory(id: string) {
    setError("");
    if (!confirm("Silmek istediğine emin misin?")) return;
    try {
      await deleteDoc(doc(db, "categories", id));
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "Silinemedi.");
    }
  }

  async function seedDefaults() {
    setError("");
    if (!confirm("Varsayılan kategoriler yüklensin mi? (Var olanları ezmez)")) return;

    try {
      const batch = writeBatch(db);

      for (const main of DEFAULT_SEED) {
        const mainRef = doc(db, "categories", main.id);
        const mainDoc: CategoryDoc = {
          name: main.name,
          nameLower: normalizeTR(main.name),
          parentId: null,
          order: main.order,
          enabled: true,
          icon: main.icon,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        batch.set(mainRef, mainDoc, { merge: true });

        for (const sub of main.subs) {
          const subRef = doc(db, "categories", sub.id);
          const subDoc: CategoryDoc = {
            name: sub.name,
            nameLower: normalizeTR(sub.name),
            parentId: main.id,
            order: sub.order,
            enabled: true,
            icon: sub.icon,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          batch.set(subRef, subDoc, { merge: true });
        }
      }

      await batch.commit();
      await loadAll();
      alert("✅ Varsayılan kategoriler yüklendi.");
    } catch (e: any) {
      setError(e?.message || "Seed başarısız.");
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">Kategoriler</h1>
          <p className="text-sm text-gray-600">
            Ana kategori = kategori, Alt kategori = alt kategori mantığı
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={seedDefaults}
            className="px-3 py-2 rounded-lg bg-black text-white hover:opacity-90"
          >
            Varsayılanları Yükle
          </button>
          <button
            onClick={loadAll}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
          >
            Yenile
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* MAIN */}
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">Ana Kategoriler</h2>
            {loading ? <span className="text-sm text-gray-500">Yükleniyor…</span> : null}
          </div>

          <div className="space-y-2 mb-4">
            {mains.map((m) => (
              <div
                key={m.id}
                className={`p-3 rounded-lg border cursor-pointer ${
                  selectedMainId === m.id ? "border-black bg-gray-50" : "hover:bg-gray-50"
                }`}
                onClick={() => setSelectedMainId(m.id)}
                draggable
                onDragStart={() => setDragMainId(m.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragMainId) handleReorder(mains, dragMainId, m.id);
                  setDragMainId(null);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 cursor-move select-none">::</span>
                  {m.imageUrl ? (
                    <img
                      src={m.imageUrl}
                      alt={`${m.name} görsel`}
                      className="h-10 w-16 rounded-md object-cover border"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-10 w-16 rounded-md border border-dashed bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">
                      Görsel yok
                    </div>
                  )}
                  <span className="text-lg">{m.icon || "📁"}</span>
                  <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-gray-500">{m.id}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <span>{m.enabled ? "Aktif" : "Pasif"}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEnabled(m.id, !m.enabled);
                        }}
                        className={`relative inline-flex h-5 w-10 items-center rounded-full transition ${
                          m.enabled ? "bg-green-600" : "bg-gray-300"
                        }`}
                        aria-pressed={!!m.enabled}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                            m.enabled ? "translate-x-5" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </label>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCategory(m.id);
                      }}
                      className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"
                    >
                      Sil
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <input
                    className="col-span-2 px-2 py-1 rounded-md border text-sm"
                    defaultValue={m.name}
                    onBlur={(e) => updateName(m.id, e.target.value)}
                  />
                  <input
                    className="px-2 py-1 rounded-md border text-sm"
                    defaultValue={String(m.order ?? 0)}
                    onBlur={(e) => updateOrder(m.id, Number(e.target.value))}
                  />
                  <input
                    className="col-span-3 px-2 py-1 rounded-md border text-sm"
                    placeholder="İkon (örn: 🎮)"
                    defaultValue={m.icon || ""}
                    onBlur={(e) => updateIcon(m.id, e.target.value)}
                  />
                  <input
                    className="col-span-3 px-2 py-1 rounded-md border text-sm"
                    placeholder="Kapak görsel URL"
                    defaultValue={m.imageUrl || ""}
                    onBlur={(e) => updateImageUrl(m.id, e.target.value)}
                    type="url"
                  />
                  <div className="col-span-3 flex items-center gap-3 text-xs text-gray-500">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={uploadingMainId === m.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadMainImage(m.id, file);
                        e.currentTarget.value = "";
                      }}
                    />
                    {uploadingMainId === m.id ? <span>Yükleniyor...</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-2">Yeni Ana Kategori</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                value={newMainName}
                onChange={(e) => setNewMainName(e.target.value)}
                className="px-3 py-2 rounded-lg border"
                placeholder="Kategori adı (örn: Figürler)"
              />
              <input
                value={newMainIcon}
                onChange={(e) => setNewMainIcon(e.target.value)}
                className="px-3 py-2 rounded-lg border"
                placeholder="İkon (örn: 🧸)"
              />
              <input
                value={String(newMainOrder)}
                onChange={(e) => setNewMainOrder(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border"
                placeholder="Sıra"
                type="number"
              />
              <input
                value={newMainImageUrl}
                onChange={(e) => setNewMainImageUrl(e.target.value)}
                className="px-3 py-2 rounded-lg border sm:col-span-3"
                placeholder="Kapak görsel URL"
                type="url"
              />
            </div>
            <button
              onClick={createMain}
              className="mt-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Ekle
            </button>
          </div>
        </div>

        {/* SUB */}
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold text-lg">Alt Kategoriler</h2>
              <p className="text-xs text-gray-500">
                Seçili:{" "}
                <span className="font-medium">
                  {mains.find((x) => x.id === selectedMainId)?.name || "-"}
                </span>
              </p>
            </div>
          </div>

          {!selectedMainId ? (
            <div className="p-3 rounded-lg bg-yellow-50 border text-yellow-800">
              Önce soldan bir ana kategori seç.
            </div>
          ) : (
            <>
              <div className="space-y-2 mb-4">
                {subs.map((s) => (
                  <div key={s.id} className="p-3 rounded-lg border hover:bg-gray-50"
                    draggable
                    onDragStart={() => setDragSubId(s.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragSubId) handleReorder(subs, dragSubId, s.id);
                      setDragSubId(null);
                    }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <span className="text-gray-400 cursor-move select-none">::</span>
                        <span className="text-lg">{s.icon || "📄"}</span>
                        <div>
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-gray-500">{s.id}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <span>{s.enabled ? "Aktif" : "Pasif"}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleEnabled(s.id, !s.enabled);
                            }}
                            className={`relative inline-flex h-5 w-10 items-center rounded-full transition ${
                              s.enabled ? "bg-green-600" : "bg-gray-300"
                            }`}
                            aria-pressed={!!s.enabled}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                                s.enabled ? "translate-x-5" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </label>
                        <button
                          onClick={() => removeCategory(s.id)}
                          className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50"
                        >
                          Sil
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <input
                        className="col-span-2 px-2 py-1 rounded-md border text-sm"
                        defaultValue={s.name}
                        onBlur={(e) => updateName(s.id, e.target.value)}
                      />
                      <input
                        className="px-2 py-1 rounded-md border text-sm"
                        defaultValue={String(s.order ?? 0)}
                        onBlur={(e) => updateOrder(s.id, Number(e.target.value))}
                      />
                      <input
                        className="col-span-3 px-2 py-1 rounded-md border text-sm"
                        placeholder="İkon (örn: 🕹️)"
                        defaultValue={s.icon || ""}
                        onBlur={(e) => updateIcon(s.id, e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Yeni Alt Kategori</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    value={newSubName}
                    onChange={(e) => setNewSubName(e.target.value)}
                    className="px-3 py-2 rounded-lg border"
                    placeholder="Alt kategori adı (örn: PlayStation)"
                  />
                  <input
                    value={newSubIcon}
                    onChange={(e) => setNewSubIcon(e.target.value)}
                    className="px-3 py-2 rounded-lg border"
                    placeholder="İkon (örn: 🎮)"
                  />
                  <input
                    value={String(newSubOrder)}
                    onChange={(e) => setNewSubOrder(Number(e.target.value))}
                    className="px-3 py-2 rounded-lg border"
                    placeholder="Sıra"
                    type="number"
                  />
                </div>
                <button
                  onClick={createSub}
                  className="mt-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  Ekle
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 text-xs text-gray-500">
        İpucu: “Varsayılanları Yükle” butonu dokümanları <b>id sabit</b> yazar.
        Listing’lerde <b>categoryId/subCategoryId</b> kullanmak için ideal.
      </div>
    </div>
  );
}
