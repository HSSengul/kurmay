"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Sora } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { devError } from "@/lib/logger";
import { buildListingPath } from "@/lib/listingUrl";
import AddressPinMap from "./AddressPinMap";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";

/* =======================
   TYPES
======================= */

type Listing = {
  id: string;
  title: string;
  price: number;
  categoryName?: string;
  subCategoryName?: string;
  imageUrls?: string[];
  createdAt?: any;
};

type PublicProfile = {
  name: string;
  bio: string;
  address: string;
  phone: string;
  websiteInstagram: string;
  showPhone: boolean;
  showAddress: boolean;
  showWebsiteInstagram: boolean;
  avatarUrl?: string;
  onboardingCompleted?: boolean;
  location?: ProfileLocation | null;
};

type ProfileLocation = {
  lat: number;
  lng: number;
  address?: string;
};

type PrivateProfile = {
  phone: string;
  address: string;
  websiteInstagram: string;
  location?: ProfileLocation | null;
};

type PublicContact = {
  phone: string;
  email: string;
  address: string;
};

/* =======================
   HELPERS
======================= */

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
  // Kullanıcı +90, 0, boşluk, parantez vs yazabilir.
  // En az 10 hane şartı (TR için pratik)
  const d = digitsOnly(phone);

  // +90 ile girerse 12 hane olabilir; 90'ı kırpıp 10'a bakarız
  if (d.startsWith("90") && d.length >= 12) {
    const rest = d.slice(2);
    return rest.length >= 10 && rest.length <= 12;
  }

  // 0 ile başlarsa 11 hane olur; 0'ı kırpıp 10'a bakarız
  if (d.startsWith("0") && d.length >= 11) {
    const rest = d.slice(1);
    return rest.length >= 10 && rest.length <= 12;
  }

  return d.length >= 10 && d.length <= 12;
}

function getPhoneHint(phone: string) {
  const d = digitsOnly(phone);
  if (!d) return "";
  if (d.length < 10) return "Telefon numarası eksik görünüyor.";
  if (d.length > 12) return "Telefon numarası çok uzun görünüyor.";
  return "";
}

function formatPriceTRY(v?: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n} ₺`;
  }
}

function timeAgoTR(createdAt: any) {
  try {
    const d: Date =
      createdAt?.toDate?.() instanceof Date
        ? createdAt.toDate()
        : createdAt instanceof Date
        ? createdAt
        : null;

    if (!d) return "";

    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec} sn önce`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} dk önce`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} sa önce`;
    const day = Math.floor(hr / 24);
    return `${day} gün önce`;
  } catch {
    return "";
  }
}

const sora = Sora({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/* =======================
   PAGE
======================= */

function MyPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onboardingQuery = useMemo(() => {
    // ?onboarding=1 gibi parametre ile ilk girişte zorlayabiliriz
    return searchParams.get("onboarding") === "1";
  }, [searchParams]);

  const [userId, setUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [listingQuery, setListingQuery] = useState("");
  const [listingSort, setListingSort] = useState<
    "newest" | "price_asc" | "price_desc" | "title"
  >("newest");

  const MY_LISTINGS_PAGE_SIZE = 24;

  /* =======================
     PROFILE STATE
  ======================= */

  const [profile, setProfile] = useState<PublicProfile>({
    name: "",
    bio: "",
    address: "",
    phone: "",
    websiteInstagram: "",
    showPhone: true,
    showAddress: true,
    showWebsiteInstagram: true,
    avatarUrl: "",
    onboardingCompleted: false,
  });
  const [profileSnapshot, setProfileSnapshot] = useState<PublicProfile | null>(null);
  const [profileLocation, setProfileLocation] = useState<ProfileLocation | null>(null);
  const [profileLocationSnapshot, setProfileLocationSnapshot] =
    useState<ProfileLocation | null>(null);

  const [publicContact, setPublicContact] = useState<PublicContact>({
    phone: "",
    email: "",
    address: "",
  });
  const [publicContactSnapshot, setPublicContactSnapshot] =
    useState<PublicContact | null>(null);

  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [editingProfile, setEditingProfile] = useState(false);

  // Avatar upload state
  const [avatarUploading, setAvatarUploading] = useState(false);

  /* =======================
     ONBOARDING STATE
  ======================= */

  const [onboardingForced, setOnboardingForced] = useState(false);
  const [onboardingBannerDismissed, setOnboardingBannerDismissed] =
    useState(false);

  const onboardingNeeded = useMemo(() => {
    // Hem query ile zorlanabilir, hem doc onboardingCompleted false ise zorlanır.
    const completed = !!profile.onboardingCompleted;
    return !completed || onboardingQuery || onboardingForced;
  }, [profile.onboardingCompleted, onboardingQuery, onboardingForced]);

  const requiredOk = useMemo(() => {
    return (
      isValidName(profile.name || "") &&
      isValidPhone(profile.phone || "") &&
      isValidAddress(profile.address || "")
    );
  }, [profile.name, profile.phone, profile.address]);

  const onboardingErrors = useMemo(() => {
    const errs: string[] = [];
    if (!isValidName(profile.name || "")) {
      errs.push("İsim en az 2 karakter olmalı.");
    }
    if (!isValidPhone(profile.phone || "")) {
      errs.push("Telefon numarası geçersiz veya eksik.");
    }
    if (!isValidAddress(profile.address || "")) {
      errs.push("Adres en az 10 karakter olmalı.");
    }
    return errs;
  }, [profile.name, profile.phone, profile.address]);

  /* =======================
     LISTINGS STATE
  ======================= */

  const [listings, setListings] = useState<Listing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsCursor, setListingsCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [listingsHasMore, setListingsHasMore] = useState(false);
  const [listingsLoadingMore, setListingsLoadingMore] = useState(false);

  const filteredListings = useMemo(() => {
    const q = normalizeSpaces(listingQuery).toLowerCase();
    let arr = listings.slice();

    if (q) {
      arr = arr.filter((l) => {
        const hay = [
          l.title || "",
          l.categoryName || "",
          l.subCategoryName || "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (listingSort === "price_asc") {
      arr.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    } else if (listingSort === "price_desc") {
      arr.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    } else if (listingSort === "title") {
      arr.sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", "tr", { sensitivity: "base" })
      );
    } else {
      arr.sort((a, b) => {
        const da = a.createdAt?.toDate?.() ? a.createdAt.toDate().getTime() : 0;
        const dbb = b.createdAt?.toDate?.() ? b.createdAt.toDate().getTime() : 0;
        return dbb - da;
      });
    }

    return arr;
  }, [listings, listingQuery, listingSort]);

  const listingStats = useMemo(() => {
    const total = listings.length;
    const latest = listings.reduce<Listing | null>((acc, cur) => {
      if (!acc) return cur;
      const at = acc.createdAt?.toDate?.() ? acc.createdAt.toDate().getTime() : 0;
      const ct = cur.createdAt?.toDate?.() ? cur.createdAt.toDate().getTime() : 0;
      return ct > at ? cur : acc;
    }, null);
    return {
      total,
      latestLabel: latest ? timeAgoTR(latest.createdAt) : "—",
    };
  }, [listings]);

  const hasListingQuery = normalizeSpaces(listingQuery).length > 0;

  const loadMoreListings = async () => {
    if (!userId) return;
    if (!listingsHasMore) return;
    if (!listingsCursor) return;
    if (listingsLoadingMore) return;

    setListingsLoadingMore(true);

    try {
      const q = query(
        collection(db, "listings"),
        where("ownerId", "==", userId),
        orderBy("createdAt", "desc"),
        startAfter(listingsCursor),
        limit(MY_LISTINGS_PAGE_SIZE)
      );

      const snap = await getDocs(q);
      const docs = snap.docs;
      const data = docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Listing, "id">),
      }));

      setListings((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const item of data) {
          if (!seen.has(item.id)) {
            merged.push(item);
            seen.add(item.id);
          }
        }
        return merged;
      });

      setListingsCursor(docs.length > 0 ? docs[docs.length - 1] : listingsCursor);
      setListingsHasMore(docs.length === MY_LISTINGS_PAGE_SIZE);
    } catch (e) {
      devError("loadMoreListings error:", e);
    } finally {
      setListingsLoadingMore(false);
    }
  };

  const completion = useMemo(() => {
    const total = 3;
    let done = 0;
    if (isValidName(profile.name || "")) done += 1;
    if (isValidPhone(profile.phone || "")) done += 1;
    if (isValidAddress(profile.address || "")) done += 1;
    const percent = Math.round((done / total) * 100);
    return { total, done, percent };
  }, [profile.name, profile.phone, profile.address]);

  const profileMessageTone = useMemo(() => {
    if (!profileMessage) return "";
    if (profileMessage.includes("❌")) {
      return "bg-red-50 border-red-200 text-red-700";
    }
    if (profileMessage.includes("✅")) {
      return "bg-emerald-50 border-emerald-200 text-emerald-700";
    }
    return "bg-slate-50 border-slate-200 text-slate-700";
  }, [profileMessage]);

  const greetingName = normalizeSpaces(profile.name || "").split(" ")[0];

  /* =======================
     AUTH + LOAD DATA
  ======================= */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.uid);

      /* =======================
         LOAD PUBLIC PROFILE
      ======================= */

      const publicRef = doc(db, "publicProfiles", user.uid);
      const privateRef = doc(db, "privateProfiles", user.uid);
      const publicSnap = await getDoc(publicRef);

      if (!publicSnap.exists()) {
        await setDoc(publicRef, {
          name: "",
          bio: "",
          showPhone: true,
          showAddress: true,
          showWebsiteInstagram: true,
          avatarUrl: "",
          onboardingCompleted: false,
          createdAt: serverTimestamp(),
        });

        // Yeni oluşturduk; state de boş kalsın
        const emptyProfile = {
          name: "",
          bio: "",
          address: "",
          phone: "",
          websiteInstagram: "",
          showPhone: true,
          showAddress: true,
          showWebsiteInstagram: true,
          avatarUrl: "",
          onboardingCompleted: false,
        };

        setProfile(emptyProfile);
        setProfileSnapshot(emptyProfile);
        setProfileLocation(null);
        setProfileLocationSnapshot(null);

        setPublicContact({ phone: "", email: "", address: "" });
        setPublicContactSnapshot({ phone: "", email: "", address: "" });

        // İlk giriş onboarding zorla + düzenleme modunu aç
        setOnboardingForced(true);
        setEditingProfile(true);
      } else {
        const d = publicSnap.data();
        let privateData: Partial<PrivateProfile> = {};
        let loadedLocation: ProfileLocation | null = null;
        try {
          const privateSnap = await getDoc(privateRef);
          if (privateSnap.exists()) {
            const p = privateSnap.data() as any;
            privateData = {
              phone: p.phone || "",
              address: p.address || "",
              websiteInstagram: p.websiteInstagram || "",
              location: p.location || null,
            };

            const loc = p.location;
            if (
              loc &&
              Number.isFinite(Number(loc.lat)) &&
              Number.isFinite(Number(loc.lng))
            ) {
              loadedLocation = {
                lat: Number(loc.lat),
                lng: Number(loc.lng),
                address: String(loc.address || ""),
              };
            }
          }
        } catch {
          privateData = {};
        }

        const mergedPhone = privateData.phone || d.phone || "";
        const mergedAddress = privateData.address || d.address || "";
        const mergedWebsite =
          privateData.websiteInstagram || d.websiteInstagram || "";

        const loadedProfile: PublicProfile = {
          name: d.name || "",
          bio: d.bio || "",
          address: mergedAddress,
          phone: mergedPhone,
          websiteInstagram: mergedWebsite,
          showPhone: d.showPhone !== false,
          showAddress: d.showAddress !== false,
          showWebsiteInstagram: d.showWebsiteInstagram !== false,
          avatarUrl: d.avatarUrl || "",
          onboardingCompleted: !!d.onboardingCompleted,
        };

        setProfile(loadedProfile);
        setProfileSnapshot(loadedProfile);
        setProfileLocation(loadedLocation);
        setProfileLocationSnapshot(loadedLocation);

        try {
          const contactSnap = await getDoc(
            doc(db, "publicContacts", user.uid)
          );
          if (contactSnap.exists()) {
            const c = contactSnap.data() as any;
            const loadedContact: PublicContact = {
              phone: c.phone || "",
              email: c.email || "",
              address: c.address || "",
            };
            setPublicContact(loadedContact);
            setPublicContactSnapshot(loadedContact);
          } else {
            setPublicContact({ phone: "", email: "", address: "" });
            setPublicContactSnapshot({ phone: "", email: "", address: "" });
          }
        } catch {
          setPublicContact({ phone: "", email: "", address: "" });
          setPublicContactSnapshot({ phone: "", email: "", address: "" });
        }

        // Onboarding gerekiyorsa kullanıcıyı düzenlemeye zorla
        if (!loadedProfile.onboardingCompleted || onboardingQuery) {
          setOnboardingForced(true);
          setEditingProfile(true);
        }
      }

      setProfileLoading(false);

      /* =======================
         LOAD MY LISTINGS
      ======================= */

      // Onboarding modunda bile ilanları yüklemeye devam edelim
      // (UX: kullanıcı daha sonra profile döndüğünde ilanlar hazır olsun)
      // Ama ekranda overlay ile kapatacağız.
      const q = query(
        collection(db, "listings"),
        where("ownerId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(MY_LISTINGS_PAGE_SIZE)
      );

      const snap = await getDocs(q);
      const docs = snap.docs;

      const data = docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Listing, "id">),
      }));

      setListings(data);
      setListingsCursor(docs.length > 0 ? docs[docs.length - 1] : null);
      setListingsHasMore(docs.length === MY_LISTINGS_PAGE_SIZE);
      setListingsLoading(false);
    });

    return () => unsub();
  }, [router, onboardingQuery]);

  /* =======================
     AVATAR UPLOAD
  ======================= */

  const handleAvatarUpload = async (file: File) => {
    if (!userId) return;

    // Basit client-side kontrol (rules yine güvence sağlar)
    const maxBytes = 2 * 1024 * 1024; // 2MB
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    if (!allowed.includes(file.type)) {
      setProfileMessage("Sadece JPG / PNG / WEBP yükleyebilirsin ❌");
      return;
    }
    if (file.size > maxBytes) {
      setProfileMessage("Fotoğraf çok büyük. 2MB altı yükle ❌");
      return;
    }

    try {
      setProfileMessage("");
      setAvatarUploading(true);

      // Overwrite mantığı: her kullanıcı tek dosya
      const avatarRef = ref(storage, `avatars/${userId}/avatar.jpg`);

      await uploadBytes(avatarRef, file);
      const url = await getDownloadURL(avatarRef);

      await setDoc(
        doc(db, "publicProfiles", userId),
        {
          avatarUrl: url,
          showPhone: profile.showPhone !== false,
          showAddress: profile.showAddress !== false,
          showWebsiteInstagram: profile.showWebsiteInstagram !== false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setProfile((p) => ({ ...p, avatarUrl: url }));
      setProfileMessage("Profil fotoğrafı yüklendi ✅");
    } catch {
      setProfileMessage("Fotoğraf yüklenirken hata oluştu ❌");
    } finally {
      setAvatarUploading(false);
    }
  };

  /* =======================
     SAVE PROFILE (PUBLIC)
  ======================= */

  const saveProfile = async () => {
    if (!userId) return;

    try {
      setProfileSaving(true);
      setProfileMessage("");

      const rawPhone = normalizeSpaces(profile.phone || "");
      const rawAddress = normalizeSpaces(profile.address || "");
      const rawWebsite = (profile.websiteInstagram || "").trim();
      const normalizedLocation =
        profileLocation &&
        Number.isFinite(profileLocation.lat) &&
        Number.isFinite(profileLocation.lng)
          ? {
              lat: Number(profileLocation.lat),
              lng: Number(profileLocation.lng),
              address: normalizeSpaces(
                String(profileLocation.address || rawAddress || "")
              ),
            }
          : null;

      const normalized: PublicProfile = {
        ...profile,
        name: normalizeSpaces(profile.name || ""),
        bio: (profile.bio || "").trim(),
        address: rawAddress,
        phone: rawPhone,
        websiteInstagram: rawWebsite,
        showPhone: profile.showPhone !== false,
        showAddress: profile.showAddress !== false,
        showWebsiteInstagram: profile.showWebsiteInstagram !== false,
        avatarUrl: profile.avatarUrl || "",
        onboardingCompleted: profile.onboardingCompleted || false,
      };

      // Onboarding gerekiyorsa minimum şartları zorla
      // Normal modda da bu kontrol yapılabilir ama şimdilik onboarding için zorunlu
      if (onboardingNeeded && !requiredOk) {
        setProfileMessage(
          "İlan verebilmek için profilini tamamlamalısın: isim + telefon + adres ❌"
        );
        return;
      }

      // Eğer onboarding gerekiyorsa bu kayıtta completed true yap
      const shouldCompleteOnboarding = onboardingNeeded && requiredOk;

      const privatePayload: PrivateProfile = {
        phone: rawPhone,
        address: rawAddress,
        websiteInstagram: rawWebsite,
        location: normalizedLocation,
      };

      await setDoc(
        doc(db, "privateProfiles", userId),
        {
          ...privatePayload,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

        const publicPayload: PublicProfile = {
          ...normalized,
          phone: normalized.showPhone ? normalized.phone : "",
          address: normalized.showAddress ? normalized.address : "",
          websiteInstagram: normalized.showWebsiteInstagram
            ? normalized.websiteInstagram
            : "",
          location: normalized.showAddress ? normalizedLocation : null,
          onboardingCompleted: shouldCompleteOnboarding
            ? true
            : !!normalized.onboardingCompleted,
        };

      await setDoc(
        doc(db, "publicProfiles", userId),
        {
          ...publicPayload,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const normalizedContact: PublicContact = {
        phone: digitsOnly(publicContact.phone || ""),
        email: (publicContact.email || "").trim(),
        address: normalizeSpaces(publicContact.address || ""),
      };

      await setDoc(
        doc(db, "publicContacts", userId),
        {
          ...normalizedContact,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

        if (shouldCompleteOnboarding) {
          setProfile((p) => ({ ...p, onboardingCompleted: true }));
          setProfileSnapshot({
            ...normalized,
            onboardingCompleted: true,
          });
          setProfileLocationSnapshot(normalizedLocation);
          setPublicContactSnapshot(normalizedContact);
          setProfileMessage("Profil tamamlandı ✅ Artık ilan verebilirsin.");
          setEditingProfile(false);
          setOnboardingForced(false);
          setOnboardingBannerDismissed(false);

        // Query temizle (UX)
        router.replace("/my");
        } else {
          setProfileMessage("Profil kaydedildi ✅");
          setProfileSnapshot(normalized);
          setProfileLocationSnapshot(normalizedLocation);
          setPublicContactSnapshot(normalizedContact);
          setEditingProfile(false);
        }
    } catch {
      setProfileMessage("Profil kaydedilirken hata oluştu ❌");
    } finally {
      setProfileSaving(false);
    }
  };

  /* =======================
     DELETE LISTING
  ======================= */

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();

    // Onboarding modunda ilan silmeye bile izin vermeyelim (kafa karışmasın)
    if (onboardingNeeded) {
      setProfileMessage("Önce profilini tamamlamalısın ❌");
      return;
    }

    const ok = confirm("Bu ilanı silmek istiyor musun?");
    if (!ok) return;

    await deleteDoc(doc(db, "listings", id));
    setListings((prev) => prev.filter((l) => l.id !== id));
  };

  const startEditingProfile = () => {
    setProfileMessage("");
    setProfileSnapshot({ ...profile });
    setPublicContactSnapshot({ ...publicContact });
    setProfileLocationSnapshot(profileLocation);
    setEditingProfile(true);
  };

  const cancelEditingProfile = () => {
    if (profileSnapshot) setProfile(profileSnapshot);
    if (publicContactSnapshot) setPublicContact(publicContactSnapshot);
    setProfileLocation(profileLocationSnapshot || null);
    setEditingProfile(false);
  };

  const handleNewListingClick = (e: React.MouseEvent) => {
    if (!onboardingNeeded) return;
    e.preventDefault();
    startEditingProfile();
    setProfileMessage("Önce profilini tamamlamalısın ❌");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* =======================
     BLOCK NAVIGATION (UX)
  ======================= */

  useEffect(() => {
    // Onboarding modunda kullanıcı yanlışlıkla sayfadan çıkmasın diye
    // tarayıcı yenileme/sekme kapama uyarısı (sadece editing açıkken)
    const shouldWarn = onboardingNeeded && editingProfile;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    if (shouldWarn) {
      window.addEventListener("beforeunload", handler);
    }

    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [onboardingNeeded, editingProfile]);

  if (profileLoading || listingsLoading) {
    return (
      <div className={`min-h-screen bg-[#f7f4ef] ${sora.className}`}>
        <div className="max-w-5xl mx-auto px-6 py-16">
          <div className="bg-white/90 rounded-2xl shadow p-8">
            <div className="h-6 w-48 bg-gray-200 rounded mb-4" />
            <div className="h-4 w-72 bg-gray-200 rounded mb-6" />
            <div className="h-10 w-full bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  /* =======================
     RENDER
  ======================= */

  return (
    <div
      className={`min-h-screen bg-[#f7f4ef] bg-[radial-gradient(circle_at_top,_#fff7ed,_#f7f4ef_55%)] text-[#1d1b16] ${sora.className}`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-5 sm:space-y-6">
        <section className="bg-white/80 backdrop-blur border border-white/70 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.45)] my-fade-up">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[11px] sm:text-xs uppercase tracking-[0.28em] text-[#b07b4a]">
                Hesabım
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold mt-2 leading-tight tracking-tight">
                Merhaba{greetingName ? ` ${greetingName}` : ""}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-2">
                Profilini güncel tut, ilanların daha hızlı görünür.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/new"
                onClick={handleNewListingClick}
                className={`px-3.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium border transition ${
                  onboardingNeeded
                    ? "border-slate-200 text-slate-400 bg-white cursor-not-allowed"
                    : "border-[#caa07a] text-[#6b3c19] bg-white hover:bg-[#f7ede2]"
                }`}
                aria-disabled={onboardingNeeded}
              >
                Yeni ilan oluştur
              </Link>
              <button
                onClick={startEditingProfile}
                className="px-3.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium bg-[#1f2a24] text-white hover:bg-[#2b3b32] transition"
              >
                {onboardingNeeded ? "Profili tamamla" : "Profili düzenle"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 sm:mt-6">
            <div className="rounded-2xl border border-[#ead8c5] bg-[#f8f2e7] p-3 sm:p-4">
              <div className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-[#a26b3c]">
                Toplam ilan
              </div>
              <div className="text-xl sm:text-2xl font-semibold mt-2">
                {listingStats.total}
              </div>
            </div>
            <div className="rounded-2xl border border-[#dbe5d9] bg-[#eef5f0] p-3 sm:p-4">
              <div className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-[#4f7b63]">
                Görünen ilan
              </div>
              <div className="text-xl sm:text-2xl font-semibold mt-2">
                {filteredListings.length}
              </div>
            </div>
            <div className="rounded-2xl border border-[#e7dfe2] bg-[#f6f0f2] p-3 sm:p-4">
              <div className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-[#8e5c69]">
                Son ilan
              </div>
              <div className="text-xl sm:text-2xl font-semibold mt-2">
                {listingStats.latestLabel || "-"}
              </div>
            </div>
          </div>
        </section>
      {/* ================= ONBOARDING BANNER ================= */}
      {onboardingNeeded && !onboardingBannerDismissed && (
        <section className="bg-amber-50/90 border border-amber-200/70 rounded-2xl sm:rounded-3xl p-4 sm:p-5 my-fade-up my-fade-delay-1">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="text-[11px] sm:text-xs uppercase tracking-[0.28em] text-amber-700">
                Profil tamamla
              </div>
              <div className="text-base sm:text-lg font-semibold mt-1">
                İlan verebilmek için önce profilini tamamlamalısın
              </div>
              <div className="text-xs sm:text-sm text-amber-900/80 mt-1">
                Zorunlu alanlar: <b>İsim</b>, <b>Telefon</b>, <b>Adres</b>.
                Profil tamamlanmadan ilanlar paneli kilitli kalır.
              </div>
              {onboardingErrors.length > 0 && (
                <ul className="text-sm mt-3 list-disc pl-5 text-amber-900/80">
                  {onboardingErrors.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={startEditingProfile}
                  className="px-3.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium bg-amber-700 text-white hover:bg-amber-800 transition"
              >
                Profili tamamla
              </button>
              <button
                onClick={() => setOnboardingBannerDismissed(true)}
                className="text-xs underline text-amber-700"
              >
                Şimdilik kapat
              </button>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-amber-800">
              <span>Profil tamamlanma</span>
              <span>
                {completion.done}/{completion.total} alan
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/70 overflow-hidden">
              <div
                className="h-full bg-amber-500"
                style={{ width: `${completion.percent}%` }}
              />
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-5 sm:gap-6 lg:gap-8">
        {/* ================= LEFT – MY LISTINGS ================= */}
        <div className="relative bg-white/90 border border-white/70 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.45)] my-fade-up my-fade-delay-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-5 sm:mb-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold">Benim ilanlarım</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Toplam {listingStats.total} ilan.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={listingQuery}
                onChange={(e) => setListingQuery(e.target.value)}
                placeholder="İlanlarda ara"
                className="w-full sm:w-52 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#d8b18a]"
              />
              <select
                value={listingSort}
                onChange={(e) =>
                  setListingSort(
                    e.target.value as
                      | "newest"
                      | "price_asc"
                      | "price_desc"
                      | "title"
                  )
                }
                className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm"
              >
                <option value="newest">En yeni</option>
                <option value="price_asc">Fiyat (artan)</option>
                <option value="price_desc">Fiyat (azalan)</option>
                <option value="title">Başlık (A-Z)</option>
              </select>
              <div className="flex items-center rounded-full border border-slate-200 bg-white p-1">
                <button
                  onClick={() => setViewMode("grid")}
                  disabled={onboardingNeeded}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition ${
                    viewMode === "grid"
                      ? "bg-[#1f2a24] text-white"
                      : "text-slate-600"
                  } ${onboardingNeeded ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={
                    onboardingNeeded ? "Önce profilini tamamlamalısın" : undefined
                  }
                >
                  Kart
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  disabled={onboardingNeeded}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition ${
                    viewMode === "list"
                      ? "bg-[#1f2a24] text-white"
                      : "text-slate-600"
                  } ${onboardingNeeded ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={
                    onboardingNeeded ? "Önce profilini tamamlamalısın" : undefined
                  }
                >
                  Liste
                </button>
              </div>
            </div>
          </div>

          {listings.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-2xl p-5 sm:p-6 text-center bg-white/70">
              <div className="text-base sm:text-lg font-semibold">
                Henüz ilan eklemedin
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-2">
                İlk ilanını ekleyerek vitrine çık.
              </p>
              <Link
                href="/new"
                onClick={handleNewListingClick}
                className={`mt-4 inline-flex items-center justify-center px-3.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium border transition ${
                  onboardingNeeded
                    ? "border-slate-200 text-slate-400 bg-white cursor-not-allowed"
                    : "border-[#1f2a24] text-[#1f2a24] hover:bg-[#1f2a24] hover:text-white"
                }`}
                aria-disabled={onboardingNeeded}
              >
                İlan oluştur
              </Link>
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-2xl p-5 sm:p-6 text-center bg-white/70">
              <div className="text-base sm:text-lg font-semibold">
                {hasListingQuery ? "Sonuç bulunamadı" : "İlan bulunamadı"}
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-2">
                {hasListingQuery
                  ? "Aramana uygun ilan bulunamadı. Farklı bir anahtar kelime dene."
                  : "Şu anda görünür ilan yok. Daha sonra tekrar kontrol edebilirsin."}
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {filteredListings.map((l) => (
                <div
                  key={l.id}
                  onClick={() => {
                    if (onboardingNeeded) {
                      setProfileMessage("Önce profilini tamamlamalısın ❌");
                      return;
                    }
                    router.push(buildListingPath(l.id, l.title));
                  }}
                  className={`group relative border border-slate-200 rounded-2xl overflow-hidden bg-white cursor-pointer transition hover:shadow-lg ${
                    onboardingNeeded ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  {l.imageUrls?.[0] && (
                    <Image
                      src={l.imageUrls[0]}
                      alt={l.title ? `${l.title} görseli` : "İlan görseli"}
                      width={400}
                      height={160}
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="w-full h-36 sm:h-40 object-cover transition duration-300 group-hover:scale-105"
                    />
                  )}

                  <div className="p-3 sm:p-4">
                    <div className="text-sm sm:text-base font-semibold">
                      {l.title}
                    </div>
                    <div className="text-[11px] sm:text-xs text-slate-500 mt-1">
                      {timeAgoTR(l.createdAt) || "-"}
                    </div>
                    <div className="text-xs sm:text-sm text-slate-600 mt-1">
                      {l.categoryName} / {l.subCategoryName}
                    </div>
                    <div className="font-semibold mt-2 text-sm sm:text-base">
                      {formatPriceTRY(l.price)}
                    </div>

                    <button
                      onClick={(e) => handleDelete(e, l.id)}
                      className="mt-3 text-xs sm:text-sm text-red-600 underline"
                    >
                      Sil
                    </button>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onboardingNeeded) {
                        setProfileMessage("Önce profilini tamamlamalısın ❌");
                        return;
                      }
                      router.push(`/ilan-duzenle/${l.id}`);
                    }}
                    className="absolute bottom-3 right-3 bg-white border rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-[11px] shadow hover:bg-gray-100"
                    title="İlanı düzenle"
                    disabled={onboardingNeeded}
                  >
                    ✏️
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <ul className="space-y-3 sm:space-y-4">
              {filteredListings.map((l) => (
                <li
                  key={l.id}
                  onClick={() => {
                    if (onboardingNeeded) {
                      setProfileMessage("Önce profilini tamamlamalısın ❌");
                      return;
                    }
                    router.push(buildListingPath(l.id, l.title));
                  }}
                  className={`relative border border-slate-200 rounded-2xl p-3 sm:p-4 flex justify-between items-center bg-white cursor-pointer transition hover:shadow-lg ${
                    onboardingNeeded ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  <div className="flex gap-3 sm:gap-4 items-center">
                    {l.imageUrls?.[0] && (
                      <Image
                        src={l.imageUrls[0]}
                        alt={l.title ? `${l.title} görseli` : "İlan görseli"}
                        width={80}
                        height={80}
                        sizes="80px"
                        className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl"
                      />
                    )}
                    <div>
                      <div className="text-sm sm:text-base font-semibold">
                        {l.title}
                      </div>
                      <div className="text-[11px] sm:text-xs text-slate-500 mt-1">
                        {timeAgoTR(l.createdAt) || "-"}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-600 mt-1">
                        {l.categoryName} / {l.subCategoryName}
                      </div>
                      <div className="font-semibold mt-1 text-sm sm:text-base">
                        {formatPriceTRY(l.price)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, l.id)}
                    className="text-xs sm:text-sm text-red-600 underline"
                  >
                    Sil
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onboardingNeeded) {
                        setProfileMessage("Önce profilini tamamlamalısın ❌");
                        return;
                      }
                      router.push(`/ilan-duzenle/${l.id}`);
                    }}
                    className="absolute bottom-3 right-3 bg-white border rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-[11px] shadow hover:bg-gray-100"
                    title="İlanı düzenle"
                    disabled={onboardingNeeded}
                  >
                    ✏️
                  </button>
                </li>
              ))}
            </ul>
          )}

          {listingsHasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={loadMoreListings}
                disabled={listingsLoadingMore}
                className="px-4 py-2 rounded-full border border-slate-200 text-sm bg-white/80 hover:bg-white disabled:opacity-60"
              >
                {listingsLoadingMore ? "Yükleniyor…" : "Daha fazla ilan yükle"}
              </button>
            </div>
          )}

          {/* ================= ONBOARDING OVERLAY (LISTINGS LOCK) ================= */}
          {onboardingNeeded && (
            <div className="absolute inset-0 bg-[#f7f4ef]/80 backdrop-blur-sm rounded-2xl flex items-center justify-center p-6">
              <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-lg p-5 sm:p-6 text-center">
                <div className="text-base sm:text-lg font-semibold">
                  Profilini tamamla, ilanların açılacak
                </div>
                <div className="text-xs sm:text-sm text-slate-600 mt-2">
                  İlan sayfalarını görüntülemek ve düzenlemek için{" "}
                  <b>İsim + Telefon + Adres</b> bilgilerini kaydetmelisin.
                </div>

                <div className="mt-4 text-xs sm:text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 text-left">
                  <div className="font-medium mb-2">Eksikler:</div>
                  <ul className="list-disc pl-5 space-y-1">
                    {!isValidName(profile.name || "") && (
                      <li>İsim (en az 2 karakter)</li>
                    )}
                    {!isValidPhone(profile.phone || "") && (
                      <li>Telefon (en az 10 hane)</li>
                    )}
                    {!isValidAddress(profile.address || "") && (
                      <li>Adres (en az 10 karakter)</li>
                    )}
                  </ul>
                </div>

                <button
                  onClick={startEditingProfile}
                  className="mt-5 w-full bg-[#1f2a24] text-white py-2 rounded-full text-xs sm:text-sm hover:bg-[#2b3b32] transition"
                >
                  Profili tamamla
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ================= RIGHT – PROFILE ================= */}
        <div className="bg-white/90 border border-white/70 rounded-2xl sm:rounded-3xl p-4 sm:p-6 space-y-4 h-fit sticky top-6 my-fade-up my-fade-delay-3">
          <h2 className="text-lg sm:text-xl font-semibold">Profil bilgileri</h2>

          {/* Onboarding durum etiketi */}
          {onboardingNeeded ? (
            <div className="text-xs sm:text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-3">
              <div className="font-semibold">Profil eksik</div>
              <div className="mt-1">
                İlan vermek için profilini tamamlaman gerekiyor.
              </div>
            </div>
          ) : (
            <div className="text-xs sm:text-sm bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-3">
              <div className="font-semibold">Profil tamamlandı ✅</div>
              <div className="mt-1">Artık ilanlarını yönetebilirsin.</div>
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 sm:p-4">
            <div className="flex items-center justify-between text-[11px] sm:text-xs uppercase tracking-[0.2em] text-slate-500">
              <span>Profil tamamlama</span>
              <span>{completion.percent}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#d7a86e] to-[#c67b5b]"
                style={{ width: `${completion.percent}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] sm:text-xs text-slate-500">
              {completion.done}/{completion.total} zorunlu alan
            </div>
          </div>

          {/* ===== AVATAR (Profil Fotoğrafı) ===== */}
          <div className="flex items-center gap-3 sm:gap-4">
            {profile.avatarUrl ? (
              <Image
                src={profile.avatarUrl}
                alt="Profil fotoğrafı"
                width={80}
                height={80}
                sizes="80px"
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border"
              />
            ) : (
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-base sm:text-lg font-semibold text-slate-500 border">
                {(normalizeSpaces(profile.name || "") || "K")[0].toUpperCase()}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <div className="text-xs sm:text-sm text-slate-600">
                Profil fotoğrafı (Herkese açık)
              </div>

              {!editingProfile ? (
                <div className="text-[11px] sm:text-xs text-slate-400">
                  Düzenle modunda yükleyebilirsin.
                </div>
              ) : (
                <label
                  className={`text-xs sm:text-sm underline cursor-pointer select-none ${
                    avatarUploading ? "text-slate-400" : "text-[#1f2a24]"
                  }`}
                >
                  {avatarUploading ? "Yükleniyor..." : "Fotoğraf Yükle"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={avatarUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      handleAvatarUpload(f);
                      // Aynı dosyayı tekrar seçebilmek için reset
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              )}

              {editingProfile && (
                <div className="text-[11px] sm:text-xs text-slate-400">
                  JPG/PNG/WEBP, max 2MB
                </div>
              )}
            </div>
          </div>

          <input
            disabled={!editingProfile}
            className={`w-full border rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100 ${
              onboardingNeeded && editingProfile && !isValidName(profile.name || "")
                ? "border-red-300"
                : "border-slate-200"
            }`}
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            placeholder="İsim *"
          />

          <textarea
            disabled={!editingProfile}
            rows={3}
            className="w-full border border-slate-200 rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100"
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="Tanıtım"
          />

          <input
            disabled={!editingProfile}
            className={`w-full border rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100 ${
              onboardingNeeded &&
              editingProfile &&
              !isValidAddress(profile.address || "")
                ? "border-red-300"
                : "border-slate-200"
            }`}
            value={profile.address}
            onChange={(e) =>
              setProfile({ ...profile, address: e.target.value })
            }
            placeholder="Adres *"
          />

          {editingProfile ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-slate-500">
                Adres Pin
              </div>
              <div className="text-[11px] sm:text-xs text-slate-500">
                Harita üzerinde bir pin seçerek adresini kaydedebilirsin.
              </div>
              <AddressPinMap
                value={profileLocation}
                address={profile.address}
                disabled={!editingProfile}
                onChange={(loc) => setProfileLocation(loc)}
                onAddressResolved={(label) =>
                  setProfile((prev) => ({ ...prev, address: label }))
                }
              />
            </div>
          ) : profile.address ? (
            <iframe
              className="w-full h-36 rounded-2xl border border-slate-200"
              src={`https://www.google.com/maps?q=${encodeURIComponent(
                profile.address
              )}&output=embed`}
            />
          ) : null}

          <input
            disabled={!editingProfile}
            className={`w-full border rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100 ${
              onboardingNeeded && editingProfile && !isValidPhone(profile.phone || "")
                ? "border-red-300"
                : "border-slate-200"
            }`}
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            placeholder="Telefon (WhatsApp) *"
          />

          {editingProfile && getPhoneHint(profile.phone || "") && (
            <div className="text-[11px] sm:text-xs text-slate-500">
              {getPhoneHint(profile.phone || "")}
            </div>
          )}

          <input
            disabled={!editingProfile}
            className="w-full border border-slate-200 rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100"
            value={profile.websiteInstagram}
            onChange={(e) =>
              setProfile({ ...profile, websiteInstagram: e.target.value })
            }
            placeholder="Website / Instagram"
          />

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-slate-500">
              Görünürlük
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500">
              Bu ayarlar ilan sayfasında <b>herkese açık</b> profil bilgilerini kontrol eder.
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={profile.showPhone}
                onChange={(e) =>
                  setProfile({ ...profile, showPhone: e.target.checked })
                }
                disabled={!editingProfile}
              />
              Telefon numaram görünsün
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={profile.showAddress}
                onChange={(e) =>
                  setProfile({ ...profile, showAddress: e.target.checked })
                }
                disabled={!editingProfile}
              />
              Adresim görünsün
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={profile.showWebsiteInstagram}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    showWebsiteInstagram: e.target.checked,
                  })
                }
                disabled={!editingProfile}
              />
              Website / Instagram görünsün
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
            <div className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-slate-500">
              İzinli İletişim (Giriş yapanlar)
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500">
              Bu bilgiler sadece <b>giriş yapmış</b> kullanıcılara gösterilir. İlan sayfasında
              ayrı bir bölüm olarak görünür.
            </div>
            <input
              disabled={!editingProfile}
              className="w-full border border-slate-200 rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100"
              value={publicContact.phone}
              onChange={(e) =>
                setPublicContact({ ...publicContact, phone: e.target.value })
              }
              placeholder="Telefon (giriş yapanlara)"
            />
            <input
              disabled={!editingProfile}
              className="w-full border border-slate-200 rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100"
              value={publicContact.email}
              onChange={(e) =>
                setPublicContact({ ...publicContact, email: e.target.value })
              }
              placeholder="E-posta (giriş yapanlara)"
            />
            <textarea
              disabled={!editingProfile}
              rows={2}
              className="w-full border border-slate-200 rounded-2xl px-3.5 py-2 text-sm disabled:bg-slate-100"
              value={publicContact.address}
              onChange={(e) =>
                setPublicContact({ ...publicContact, address: e.target.value })
              }
              placeholder="Adres (giriş yapanlara)"
            />
          </div>

          {!editingProfile ? (
            <button
              onClick={() => {
                setProfileMessage("");
                setEditingProfile(true);
              }}
              className="w-full border border-slate-200 py-2 rounded-full text-xs sm:text-sm font-medium hover:border-slate-400 transition"
            >
              {onboardingNeeded ? "Profili Tamamla" : "Profili Düzenle"}
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={saveProfile}
                disabled={
                  profileSaving ||
                  avatarUploading ||
                  (onboardingNeeded && !requiredOk)
                }
                className="w-full bg-[#1f2a24] text-white py-2 rounded-full text-xs sm:text-sm font-medium disabled:opacity-60"
                title={
                  onboardingNeeded && !requiredOk
                    ? "İsim + Telefon + Adres tamamlanmadan kaydedemezsin"
                    : undefined
                }
              >
                {profileSaving
                  ? "Kaydediliyor..."
                  : onboardingNeeded
                  ? "Kaydet ve Devam Et"
                  : "Kaydet"}
              </button>
              <button
                onClick={cancelEditingProfile}
                className="w-full border border-slate-200 py-2 rounded-full text-xs sm:text-sm font-medium hover:border-slate-400 transition"
              >
                Vazgeç
              </button>
            </div>
          )}

          {editingProfile && onboardingNeeded && !requiredOk && (
            <div className="text-xs sm:text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl p-3">
              İlan verebilmek için zorunlu alanları doldur:{" "}
              <b>İsim</b>, <b>Telefon</b>, <b>Adres</b>.
            </div>
          )}

          {profileMessage && (
            <div
              className={`text-xs sm:text-sm border rounded-2xl px-4 py-3 ${profileMessageTone}`}
            >
              {profileMessage}
            </div>
          )}

          {/* Onboarding modunda kullanıcının “kaçmasını” engelleyen küçük not */}
          {onboardingNeeded && (
            <div className="text-[11px] sm:text-xs text-slate-500 text-center pt-2">
              Profil tamamlanmadan ilanlarını yönetemezsin.
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

export default function MyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
          <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
            <div className="bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-6">
              <div className="h-6 w-40 bg-slate-200 rounded mb-2" />
              <div className="h-4 w-64 bg-slate-200 rounded" />
            </div>
            <div className="bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-6">
              <div className="h-4 w-32 bg-slate-200 rounded mb-4" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-56 bg-slate-200 rounded-2xl" />
                ))}
              </div>
            </div>
          </div>
        </div>
      }
    >
      <MyPageInner />
    </Suspense>
  );
}
