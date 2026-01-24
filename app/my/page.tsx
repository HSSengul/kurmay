"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
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
  brandName?: string;
  modelName?: string;
  imageUrls?: string[];
  createdAt?: any;
};

type PublicProfile = {
  name: string;
  bio: string;
  address: string;
  phone: string;
  websiteInstagram: string;
  avatarUrl?: string;
  onboardingCompleted?: boolean;
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

/* =======================
   PAGE
======================= */

export default function MyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onboardingQuery = useMemo(() => {
    // ?onboarding=1 gibi parametre ile ilk girişte zorlayabiliriz
    return searchParams.get("onboarding") === "1";
  }, [searchParams]);

  const [userId, setUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  /* =======================
     PROFILE STATE
  ======================= */

  const [profile, setProfile] = useState<PublicProfile>({
    name: "",
    bio: "",
    address: "",
    phone: "",
    websiteInstagram: "",
    avatarUrl: "",
    onboardingCompleted: false,
  });

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
      const publicSnap = await getDoc(publicRef);

      if (!publicSnap.exists()) {
        await setDoc(publicRef, {
          name: "",
          bio: "",
          address: "",
          phone: "",
          websiteInstagram: "",
          avatarUrl: "",
          onboardingCompleted: false,
          createdAt: serverTimestamp(),
        });

        // Yeni oluşturduk; state de boş kalsın
        setProfile({
          name: "",
          bio: "",
          address: "",
          phone: "",
          websiteInstagram: "",
          avatarUrl: "",
          onboardingCompleted: false,
        });

        // İlk giriş onboarding zorla + düzenleme modunu aç
        setOnboardingForced(true);
        setEditingProfile(true);
      } else {
        const d = publicSnap.data();
        const loadedProfile: PublicProfile = {
          name: d.name || "",
          bio: d.bio || "",
          address: d.address || "",
          phone: d.phone || "",
          websiteInstagram: d.websiteInstagram || "",
          avatarUrl: d.avatarUrl || "",
          onboardingCompleted: !!d.onboardingCompleted,
        };

        setProfile(loadedProfile);

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
        orderBy("createdAt", "desc")
      );

      const snap = await getDocs(q);

      const data = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Listing, "id">),
      }));

      setListings(data);
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

      const normalized: PublicProfile = {
        ...profile,
        name: normalizeSpaces(profile.name || ""),
        bio: (profile.bio || "").trim(),
        address: normalizeSpaces(profile.address || ""),
        phone: normalizeSpaces(profile.phone || ""),
        websiteInstagram: (profile.websiteInstagram || "").trim(),
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

      await setDoc(
        doc(db, "publicProfiles", userId),
        {
          ...normalized,
          onboardingCompleted: shouldCompleteOnboarding
            ? true
            : !!normalized.onboardingCompleted,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (shouldCompleteOnboarding) {
        setProfile((p) => ({ ...p, onboardingCompleted: true }));
        setProfileMessage("Profil tamamlandı ✅ Artık ilan verebilirsin.");
        setEditingProfile(false);
        setOnboardingForced(false);
        setOnboardingBannerDismissed(false);

        // Query temizle (UX)
        router.replace("/my");
      } else {
        setProfileMessage("Profil kaydedildi ✅");
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
    return <div className="p-8 text-center text-gray-500">Yükleniyor...</div>;
  }

  /* =======================
     RENDER
  ======================= */

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* ================= ONBOARDING BANNER ================= */}
      {onboardingNeeded && !onboardingBannerDismissed && (
        <div className="mb-6 border border-yellow-300 bg-yellow-50 text-yellow-900 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold">
                İlan verebilmek için önce profilini tamamlamalısın
              </div>
              <div className="text-sm mt-1">
                Zorunlu alanlar: <b>İsim</b>, <b>Telefon</b>, <b>Adres</b>.
                Profil tamamlanmadan ilanlar paneli kilitli kalır.
              </div>
              {onboardingErrors.length > 0 && (
                <ul className="text-sm mt-2 list-disc pl-5">
                  {onboardingErrors.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              )}
            </div>

            <button
              onClick={() => setOnboardingBannerDismissed(true)}
              className="text-sm underline whitespace-nowrap"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-8">
        {/* ================= LEFT – MY LISTINGS ================= */}
        <div className="relative">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold">Benim İlanlarım</h2>

            <div className="flex gap-2">
              <button
                onClick={() => setViewMode("grid")}
                disabled={onboardingNeeded}
                className={`px-3 py-1 rounded ${
                  viewMode === "grid" ? "bg-gray-800 text-white" : "border"
                } ${onboardingNeeded ? "opacity-50 cursor-not-allowed" : ""}`}
                title={
                  onboardingNeeded ? "Önce profilini tamamlamalısın" : undefined
                }
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode("list")}
                disabled={onboardingNeeded}
                className={`px-3 py-1 rounded ${
                  viewMode === "list" ? "bg-gray-800 text-white" : "border"
                } ${onboardingNeeded ? "opacity-50 cursor-not-allowed" : ""}`}
                title={
                  onboardingNeeded ? "Önce profilini tamamlamalısın" : undefined
                }
              >
                Liste
              </button>
            </div>
          </div>

          {listings.length === 0 ? (
            <div className="text-gray-500">Henüz ilan eklemedin.</div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {listings.map((l) => (
                <div
                  key={l.id}
                  onClick={() => {
                    if (onboardingNeeded) {
                      setProfileMessage("Önce profilini tamamlamalısın ❌");
                      return;
                    }
                    router.push(`/ilan/${l.id}`);
                  }}
                  className={`relative border rounded-xl overflow-hidden bg-white cursor-pointer hover:shadow-md ${
                    onboardingNeeded ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  {l.imageUrls?.[0] && (
                    <img
                      src={l.imageUrls[0]}
                      className="w-full h-40 object-cover"
                    />
                  )}

                  <div className="p-4">
                    <div className="font-semibold">{l.title}</div>
                    <div className="text-sm text-gray-600">
                      {l.brandName} / {l.modelName}
                    </div>
                    <div className="font-semibold mt-1">{l.price} TL</div>

                    <button
                      onClick={(e) => handleDelete(e, l.id)}
                      className="mt-3 text-sm text-red-600 underline"
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
                    className="absolute bottom-3 right-3 bg-white border rounded-full w-8 h-8 flex items-center justify-center shadow hover:bg-gray-100"
                    title="İlanı düzenle"
                    disabled={onboardingNeeded}
                  >
                    ✏️
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <ul className="space-y-4">
              {listings.map((l) => (
                <li
                  key={l.id}
                  onClick={() => {
                    if (onboardingNeeded) {
                      setProfileMessage("Önce profilini tamamlamalısın ❌");
                      return;
                    }
                    router.push(`/ilan/${l.id}`);
                  }}
                  className={`relative border rounded-lg p-4 flex justify-between items-center bg-white cursor-pointer hover:shadow-md ${
                    onboardingNeeded ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  <div className="flex gap-4 items-center">
                    {l.imageUrls?.[0] && (
                      <img
                        src={l.imageUrls[0]}
                        className="w-20 h-20 object-cover rounded"
                      />
                    )}
                    <div>
                      <div className="font-semibold">{l.title}</div>
                      <div className="text-sm text-gray-600">
                        {l.brandName} / {l.modelName}
                      </div>
                      <div className="font-semibold">{l.price} TL</div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, l.id)}
                    className="text-sm text-red-600 underline"
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
                    className="absolute bottom-3 right-3 bg-white border rounded-full w-8 h-8 flex items-center justify-center shadow hover:bg-gray-100"
                    title="İlanı düzenle"
                    disabled={onboardingNeeded}
                  >
                    ✏️
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* ================= ONBOARDING OVERLAY (LISTINGS LOCK) ================= */}
          {onboardingNeeded && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] rounded-xl flex items-center justify-center p-6">
              <div className="max-w-md w-full bg-white border rounded-2xl shadow-lg p-6 text-center">
                <div className="text-lg font-semibold">
                  Profilini tamamla, ilanların açılacak
                </div>
                <div className="text-sm text-gray-600 mt-2">
                  İlan sayfalarını görüntülemek ve düzenlemek için{" "}
                  <b>İsim + Telefon + Adres</b> bilgilerini kaydetmelisin.
                </div>

                <div className="mt-4 text-sm text-gray-700 bg-gray-50 border rounded-lg p-3 text-left">
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
                  onClick={() => {
                    setProfileMessage("");
                    setEditingProfile(true);
                    // Sağ panel visible, sadece kullanıcıya hatırlatma
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="mt-5 w-full bg-blue-600 text-white py-2 rounded-lg"
                >
                  Profili Tamamla
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ================= RIGHT – PROFILE ================= */}
        <div className="bg-white border rounded-xl p-6 space-y-4 h-fit sticky top-6">
          <h2 className="text-xl font-bold">Profil Bilgileri (Herkese Açık)</h2>

          {/* Onboarding durum etiketi */}
          {onboardingNeeded ? (
            <div className="text-sm bg-yellow-50 border border-yellow-200 text-yellow-900 rounded-lg p-3">
              <div className="font-semibold">Onboarding</div>
              <div className="mt-1">
                İlan vermek için profilini tamamlaman gerekiyor.
              </div>
            </div>
          ) : (
            <div className="text-sm bg-green-50 border border-green-200 text-green-900 rounded-lg p-3">
              <div className="font-semibold">Profil tamamlandı ✅</div>
              <div className="mt-1">Artık ilanlarını yönetebilirsin.</div>
            </div>
          )}

          {/* ===== AVATAR (Profil Fotoğrafı) ===== */}
          <div className="flex items-center gap-4">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt="Profil fotoğrafı"
                className="w-20 h-20 rounded-full object-cover border"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 border">
                👤
              </div>
            )}

            <div className="flex flex-col gap-1">
              <div className="text-sm text-gray-600">
                Profil fotoğrafı (Herkese açık)
              </div>

              {!editingProfile ? (
                <div className="text-xs text-gray-400">
                  Düzenle modunda yükleyebilirsin.
                </div>
              ) : (
                <label
                  className={`text-sm underline cursor-pointer select-none ${
                    avatarUploading ? "text-gray-400" : "text-blue-700"
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
                <div className="text-xs text-gray-400">
                  JPG/PNG/WEBP, max 2MB
                </div>
              )}
            </div>
          </div>

          <input
            disabled={!editingProfile}
            className={`w-full border rounded-lg px-4 py-2 disabled:bg-gray-100 ${
              onboardingNeeded && editingProfile && !isValidName(profile.name || "")
                ? "border-red-300"
                : ""
            }`}
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            placeholder="İsim *"
          />

          <textarea
            disabled={!editingProfile}
            rows={3}
            className="w-full border rounded-lg px-4 py-2 disabled:bg-gray-100"
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="Tanıtım"
          />

          <input
            disabled={!editingProfile}
            className={`w-full border rounded-lg px-4 py-2 disabled:bg-gray-100 ${
              onboardingNeeded &&
              editingProfile &&
              !isValidAddress(profile.address || "")
                ? "border-red-300"
                : ""
            }`}
            value={profile.address}
            onChange={(e) =>
              setProfile({ ...profile, address: e.target.value })
            }
            placeholder="Adres *"
          />

          {profile.address && (
            <iframe
              className="w-full h-40 rounded border"
              src={`https://www.google.com/maps?q=${encodeURIComponent(
                profile.address
              )}&output=embed`}
            />
          )}

          <input
            disabled={!editingProfile}
            className={`w-full border rounded-lg px-4 py-2 disabled:bg-gray-100 ${
              onboardingNeeded && editingProfile && !isValidPhone(profile.phone || "")
                ? "border-red-300"
                : ""
            }`}
            value={profile.phone}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            placeholder="Telefon (WhatsApp) *"
          />

          {editingProfile && getPhoneHint(profile.phone || "") && (
            <div className="text-xs text-gray-500">{getPhoneHint(profile.phone || "")}</div>
          )}

          <input
            disabled={!editingProfile}
            className="w-full border rounded-lg px-4 py-2 disabled:bg-gray-100"
            value={profile.websiteInstagram}
            onChange={(e) =>
              setProfile({ ...profile, websiteInstagram: e.target.value })
            }
            placeholder="Website / Instagram"
          />

          {!editingProfile ? (
            <button
              onClick={() => {
                setProfileMessage("");
                setEditingProfile(true);
              }}
              className="w-full border py-2 rounded"
            >
              {onboardingNeeded ? "Profili Tamamla" : "Profili Düzenle"}
            </button>
          ) : (
            <button
              onClick={saveProfile}
              disabled={
                profileSaving ||
                avatarUploading ||
                (onboardingNeeded && !requiredOk)
              }
              className="w-full bg-blue-600 text-white py-2 rounded disabled:opacity-60"
              title={
                onboardingNeeded && !requiredOk
                  ? "İsim + Telefon + Adres tamamlanmadan kaydedemezsin"
                  : undefined
              }
            >
              {profileSaving ? "Kaydediliyor..." : onboardingNeeded ? "Kaydet ve Devam Et" : "Kaydet"}
            </button>
          )}

          {editingProfile && onboardingNeeded && !requiredOk && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              İlan verebilmek için zorunlu alanları doldur:{" "}
              <b>İsim</b>, <b>Telefon</b>, <b>Adres</b>.
            </div>
          )}

          {profileMessage && (
            <div className="text-sm text-center">{profileMessage}</div>
          )}

          {/* Onboarding modunda kullanıcının “kaçmasını” engelleyen küçük not */}
          {onboardingNeeded && (
            <div className="text-xs text-gray-500 text-center pt-2">
              Profil tamamlanmadan ilanlarını yönetemezsin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
