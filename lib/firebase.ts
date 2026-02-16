// lib/firebase.ts
import { initializeApp, getApp, getApps } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Analytics sadece browser’da çalışır (Next.js SSR’da patlamasın diye)
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
};

export const firebaseConfigReady = Object.values(firebaseConfig).every(
  (v) => typeof v === "string" && v.length > 0
);

// ✅ App init (Hot reload’da birden fazla init olmasın)
const app = firebaseConfigReady
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

// ✅ App Check (opsiyonel)
export let appCheck: ReturnType<typeof initializeAppCheck> | null = null;
if (typeof window !== "undefined" && app) {
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN;
  const debugFlag = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG;

  // ✅ Debug token sadece development'ta aktif
  if (process.env.NODE_ENV !== "production") {
    if (debugToken) {
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    } else if (debugFlag === "true") {
      (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
  }

  const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
  if (appCheckSiteKey) {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch {
      // App Check zaten init edilmiş olabilir
    }
  }
}

// ✅ Core servisler
export const auth = app ? getAuth(app) : (null as any);
export const db = app ? getFirestore(app) : (null as any);
export const storage = app ? getStorage(app) : (null as any);

// ✅ Analytics (opsiyonel)
// - SSR’da çalışmaz
// - Sadece prod + browser’da aktif olsun istersen burası ideal
export async function getFirebaseAnalytics() {
  if (typeof window === "undefined") return null;
  if (!app) return null;
  const supported = await isSupported();
  if (!supported) return null;
  return getAnalytics(app);
}

export default app;
