"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  linkWithCredential,
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  updateProfile,
  User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/* =======================
   CONFIG
======================= */

// Email whitelist: temp maili fiilen bitiren yaklaşım
const ALLOWED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "icloud.com",
  "me.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.tr",
  "yandex.com",
  "yandex.com.tr",
  "proton.me",
  "protonmail.com",
]);

// Şifre politikası (Firebase min 6 ama biz daha iyi bir eşik koyuyoruz)
function validatePassword(pw: string) {
  const p = pw.trim();
  if (p.length < 8) return "Şifre en az 8 karakter olmalı.";
  if (!/[A-Z]/.test(p)) return "Şifre en az 1 büyük harf içermeli.";
  if (!/[a-z]/.test(p)) return "Şifre en az 1 küçük harf içermeli.";
  if (!/[0-9]/.test(p)) return "Şifre en az 1 rakam içermeli.";
  // özel karakter şartını zorunlu tutmak istersen aç:
  // if (!/[^A-Za-z0-9]/.test(p)) return "Şifre en az 1 özel karakter içermeli.";
  return "";
}

function normalizeEmail(v: string) {
  return v.trim().toLowerCase();
}

function getEmailDomain(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).toLowerCase();
}

function isAllowedEmail(email: string) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

function firebaseErrorToTR(code?: string) {
  switch (code) {
    case "auth/user-not-found":
      return "Bu e-posta ile kayıtlı kullanıcı bulunamadı.";
    case "auth/wrong-password":
      return "Şifre yanlış.";
    case "auth/email-already-in-use":
      return "Bu e-posta zaten kayıtlı.";
    case "auth/invalid-email":
      return "Geçersiz e-posta adresi.";
    case "auth/weak-password":
      return "Şifre çok zayıf.";
    case "auth/popup-closed-by-user":
      return "Google penceresi kapatıldı.";
    case "auth/cancelled-popup-request":
      return "Google giriş isteği iptal edildi.";
    case "auth/popup-blocked":
      return "Tarayıcı popup engelledi. Popup izinlerini aç.";
    case "auth/account-exists-with-different-credential":
      return "Bu e-posta farklı bir giriş yöntemiyle kayıtlı. E-posta + şifre ile giriş yapıp hesabına Google’ı bağlayabiliriz.";
    case "auth/too-many-requests":
      return "Çok fazla deneme yapıldı. Bir süre sonra tekrar dene.";
    default:
      return "Bir hata oluştu. Tekrar deneyin.";
  }
}

/* =======================
   HELPERS: USER DOCS
======================= */

async function ensureUserDocs(user: User) {
  const uid = user.uid;

  // users doc (private)
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    await setDoc(
      userRef,
      {
        role: "user",
        createdAt: serverTimestamp(),
        provider: user.providerData?.map((p) => p.providerId) || [],
        email: user.email || "",
      },
      { merge: true }
    );
  } else {
    // provider güncelle (opsiyonel)
    await setDoc(
      userRef,
      {
        provider: user.providerData?.map((p) => p.providerId) || [],
        email: user.email || "",
      },
      { merge: true }
    );
  }

  // publicProfiles doc (public) – /my zaten auto-create yapıyor ama burada da garanti altına alıyoruz
  const publicRef = doc(db, "publicProfiles", uid);
  const publicSnap = await getDoc(publicRef);
  if (!publicSnap.exists()) {
    await setDoc(
      publicRef,
      {
        name: user.displayName || "",
        bio: "",
        address: "",
        phone: "",
        websiteInstagram: "",
        avatarUrl: user.photoURL || "",
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    // Eğer foto yok ama Google foto var ise doldur (opsiyonel)
    const d = publicSnap.data();
    const needsAvatar = !d?.avatarUrl && !!user.photoURL;
    const needsName = !d?.name && !!user.displayName;
    if (needsAvatar || needsName) {
      await setDoc(
        publicRef,
        {
          avatarUrl: needsAvatar ? user.photoURL : d?.avatarUrl || "",
          name: needsName ? user.displayName : d?.name || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
}

/* =======================
   PAGE
======================= */

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();

  // ?next=/my gibi bir kullanım için
  const nextPath = useMemo(() => {
    const n = params.get("next");
    return n && n.startsWith("/") ? n : "/";
  }, [params]);

  // Modlar:
  // - login: email+password ile giriş
  // - register: email+password ile kayıt (whitelist şart)
  // - reset: şifre sıfırlama maili
  // - setpw: Google ile giren kullanıcıya şifre belirletme (link)
  const [mode, setMode] = useState<"login" | "register" | "reset" | "setpw">(
    "login"
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Google ile girildi ama password provider yoksa kullanıcıyı burada tutarız:
  const [pendingGoogleUser, setPendingGoogleUser] = useState<User | null>(null);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  // Oturum zaten açıksa direkt yönlendir
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;

      // Eğer kullanıcı google ile girmiş ve password provider linkli değilse setpw ekranına al
      const methods = u.email ? await fetchSignInMethodsForEmail(auth, u.email) : [];
      const hasPassword = methods.includes("password");
      const hasGoogle = methods.includes("google.com");

      // Google var, password yok → şifre belirlet
      if (hasGoogle && !hasPassword) {
        setPendingGoogleUser(u);
        setMode("setpw");
        return;
      }

      // Normal giriş → dokümanlar + redirect
      try {
        await ensureUserDocs(u);
      } catch {
        // doc yazımı patlarsa bile kullanıcıyı login’de kilitlemeyelim
      }
      router.push(nextPath);
    });

    return () => unsub();
  }, [router, nextPath]);

  /* =======================
     ACTIONS
  ======================= */

  const clearAlerts = () => {
    setError("");
    setMessage("");
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    const em = normalizeEmail(email);
    const pw = password;

    if (!em) {
      setError("E-posta zorunlu.");
      return;
    }
    if (!pw) {
      setError("Şifre zorunlu.");
      return;
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, em, pw);
      // onAuthStateChanged yönlendirir
    } catch (err: any) {
      setError(firebaseErrorToTR(err?.code));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    const em = normalizeEmail(email);
    const pw = password;

    if (!em) {
      setError("E-posta zorunlu.");
      return;
    }

    // Whitelist kontrolü
    if (!isAllowedEmail(em)) {
      setError(
        "Bu e-posta sağlayıcısı kabul edilmiyor. Lütfen Gmail / iCloud / Outlook / Hotmail gibi gerçek bir sağlayıcı kullan."
      );
      return;
    }

    const pwErr = validatePassword(pw);
    if (pwErr) {
      setError(pwErr);
      return;
    }

    setLoading(true);
    try {
      // Eğer bu email ile daha önce başka yöntemle kayıt varsa doğru yönlendirelim
      const methods = await fetchSignInMethodsForEmail(auth, em);
      if (methods.length > 0) {
        // password method yoksa kullanıcıya düzgün mesaj ver
        if (!methods.includes("password")) {
          setError(
            "Bu e-posta daha önce farklı bir yöntemle kayıt olmuş. Giriş yapmayı dene ya da Google ile bağlayalım."
          );
          return;
        }
      }

      await createUserWithEmailAndPassword(auth, em, pw);

      // onAuthStateChanged yönlendirir
    } catch (err: any) {
      setError(firebaseErrorToTR(err?.code));
    } finally {
      setLoading(false);
    }
  };

  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    const em = normalizeEmail(email);
    if (!em) {
      setError("E-posta zorunlu.");
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, em);
      setMessage("Şifre sıfırlama bağlantısı e-posta adresine gönderildi ✅");
      setMode("login");
    } catch (err: any) {
      setError(firebaseErrorToTR(err?.code));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    clearAlerts();
    setGoogleLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account",
      });

      const res = await signInWithPopup(auth, provider);
      const u = res.user;

      // Google ile giren kullanıcı için: şifre set edilmemişse setpw moduna geç
      const em = u.email ? normalizeEmail(u.email) : "";
      if (em) {
        const methods = await fetchSignInMethodsForEmail(auth, em);
        const hasPassword = methods.includes("password");
        const hasGoogle = methods.includes("google.com");

        if (hasGoogle && !hasPassword) {
          setPendingGoogleUser(u);
          setMode("setpw");
          setMessage("Google ile giriş tamam ✅ Şimdi bir şifre belirle.");
          return;
        }
      }

      // Zaten password linked ise normal akış
      await ensureUserDocs(u);
      router.push(nextPath);
    } catch (err: any) {
      setError(firebaseErrorToTR(err?.code));
    } finally {
      setGoogleLoading(false);
    }
  };

  // Google ile giriş yapmış kullanıcıya password linkleme
  const handleSetPasswordForGoogleUser = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    const u = pendingGoogleUser;
    if (!u) {
      setError("Oturum bulunamadı. Lütfen tekrar Google ile giriş yap.");
      setMode("login");
      return;
    }

    const em = u.email ? normalizeEmail(u.email) : "";
    if (!em) {
      setError("Google hesabından e-posta alınamadı. Farklı bir hesapla dene.");
      return;
    }

    // Şifre kalitesi
    const pwErr = validatePassword(password);
    if (pwErr) {
      setError(pwErr);
      return;
    }

    setLoading(true);
    try {
      // Email whitelist: Google email'i zaten güvenli ama yine de genel kural
      if (!isAllowedEmail(em)) {
        setError(
          "Bu e-posta sağlayıcısı kabul edilmiyor. Lütfen farklı bir Google hesabı kullan."
        );
        return;
      }

      // Aynı email için password yöntemi zaten varsa linkleme patlar; kontrol edelim
      const methods = await fetchSignInMethodsForEmail(auth, em);
      if (methods.includes("password")) {
        // Demek ki zaten password var; kullanıcı yanlışlıkla burada
        setMessage("Bu hesap zaten şifre ile giriş destekliyor ✅");
        await ensureUserDocs(u);
        router.push(nextPath);
        return;
      }

      // Link credentials
      const cred = EmailAuthProvider.credential(em, password.trim());
      await linkWithCredential(u, cred);

      // (Opsiyonel) displayName yoksa email'den türet, ya da profile update
      if (!u.displayName) {
        const nameGuess = em.split("@")[0];
        try {
          await updateProfile(u, { displayName: nameGuess });
        } catch {
          // önemli değil
        }
      }

      await ensureUserDocs(u);

      setMessage("Şifre oluşturuldu ✅ Artık Google veya şifre ile giriş yapabilirsin.");
      router.push(nextPath);
    } catch (err: any) {
      setError(firebaseErrorToTR(err?.code));
    } finally {
      setLoading(false);
    }
  };

  /* =======================
     UI
  ======================= */

  const title =
    mode === "login"
      ? "Giriş Yap"
      : mode === "register"
      ? "Kayıt Ol"
      : mode === "reset"
      ? "Şifremi Unuttum"
      : "Şifre Belirle";

  const subtitle =
    mode === "setpw"
      ? "Google ile giriş yaptın. Hesabın için bir şifre belirle."
      : " ";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-200 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-3xl font-bold text-center mb-2">{title}</h1>
        {subtitle.trim() && (
          <div className="text-center text-sm text-gray-600 mb-6">{subtitle}</div>
        )}

        {/* GOOGLE BUTTON (login/register için) */}
        {mode !== "reset" && (
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || loading || mode === "setpw"}
            className="w-full border rounded-lg py-2 font-semibold flex items-center justify-center gap-2 hover:bg-gray-50 transition disabled:opacity-50"
          >
            <span className="text-lg">G</span>
            {googleLoading ? "Google ile devam ediliyor..." : "Google ile devam et"}
          </button>
        )}

        {/* Divider */}
        {mode !== "setpw" && (
          <div className="flex items-center gap-3 my-5">
            <div className="h-px bg-gray-200 flex-1" />
            <div className="text-xs text-gray-500">veya</div>
            <div className="h-px bg-gray-200 flex-1" />
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="text-sm text-red-700 bg-red-100 p-3 rounded-lg mb-4">
            {error}
          </div>
        )}
        {message && (
          <div className="text-sm text-green-800 bg-green-100 p-3 rounded-lg mb-4">
            {message}
          </div>
        )}

        {/* FORMS */}
        {mode === "login" && (
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">E-posta</label>
              <input
                type="email"
                className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Şifre</label>
              <div className="flex gap-2">
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="px-3 border rounded-lg text-sm"
                  title={showPassword ? "Gizle" : "Göster"}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
            >
              {loading ? "Lütfen bekleyin..." : "Giriş Yap"}
            </button>

            <div className="flex justify-between items-center text-sm">
              <button
                type="button"
                onClick={() => {
                  clearAlerts();
                  setMode("register");
                }}
                className="text-blue-600 hover:underline font-medium"
              >
                Kayıt ol
              </button>

              <button
                type="button"
                onClick={() => {
                  clearAlerts();
                  setMode("reset");
                }}
                className="text-blue-600 hover:underline font-medium"
              >
                Şifremi unuttum
              </button>
            </div>
          </form>
        )}

        {mode === "register" && (
          <form onSubmit={handleEmailRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">E-posta</label>
              <input
                type="email"
                className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <div className="text-xs text-gray-500 mt-1">
                Sadece gerçek sağlayıcılar kabul edilir (Gmail / iCloud / Outlook vb.)
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Şifre</label>
              <div className="flex gap-2">
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="px-3 border rounded-lg text-sm"
                  title={showPassword ? "Gizle" : "Göster"}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                En az 8 karakter, büyük/küçük harf ve rakam içersin.
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
            >
              {loading ? "Lütfen bekleyin..." : "Kayıt Ol"}
            </button>

            <div className="text-center mt-2 text-sm">
              Zaten hesabın var mı?{" "}
              <button
                type="button"
                onClick={() => {
                  clearAlerts();
                  setMode("login");
                }}
                className="text-blue-600 hover:underline font-medium"
              >
                Giriş yap
              </button>
            </div>
          </form>
        )}

        {mode === "reset" && (
          <form onSubmit={handleSendReset} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">E-posta</label>
              <input
                type="email"
                className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <div className="text-xs text-gray-500 mt-1">
                Şifre sıfırlama bağlantısı bu adrese gönderilecek.
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
            >
              {loading ? "Gönderiliyor..." : "Sıfırlama Linki Gönder"}
            </button>

            <div className="text-center mt-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  clearAlerts();
                  setMode("login");
                }}
                className="text-blue-600 hover:underline font-medium"
              >
                Giriş ekranına dön
              </button>
            </div>
          </form>
        )}

        {mode === "setpw" && (
          <form onSubmit={handleSetPasswordForGoogleUser} className="space-y-4">
            <div className="text-sm text-gray-700 bg-gray-50 border rounded-lg p-3">
              <div className="font-medium">Hesabın:</div>
              <div className="break-all">{pendingGoogleUser?.email || "-"}</div>
              <div className="text-xs text-gray-500 mt-1">
                Bu hesaba bir şifre ekleyerek Google veya şifre ile giriş yapabilirsin.
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Yeni Şifre</label>
              <div className="flex gap-2">
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="px-3 border rounded-lg text-sm"
                  title={showPassword ? "Gizle" : "Göster"}
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                En az 8 karakter, büyük/küçük harf ve rakam içersin.
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
            >
              {loading ? "Kaydediliyor..." : "Şifreyi Oluştur"}
            </button>

            <button
              type="button"
              onClick={() => {
                // Kullanıcı isterse şifre belirlemeden de kalabilir; ama sen "şifre belirlesin" diyorsun.
                // Bu butonu istersen kaldırabilirsin; şimdilik güvenlik açısından koydum.
                clearAlerts();
                setError("Şifre belirlemeden devam edemezsin.");
              }}
              className="w-full border py-2 rounded-lg"
            >
              Vazgeç
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-gray-600">
          Yükleniyor...
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
