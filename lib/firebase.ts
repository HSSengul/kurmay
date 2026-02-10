// lib/firebase.ts
import { initializeApp, getApp, getApps } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Analytics sadece browser’da çalışır (Next.js SSR’da patlamasın diye)
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID!,
};

// ✅ App init (Hot reload’da birden fazla init olmasın)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ App Check (opsiyonel)
export let appCheck: ReturnType<typeof initializeAppCheck> | null = null;
if (typeof window !== "undefined") {
  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN;
  const debugFlag = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG;

  // ✅ Debug token sabit olsun (her yenilemede değişmesin)
  if (debugToken) {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  } else if (debugFlag === "true") {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
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
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ✅ Analytics (opsiyonel)
// - SSR’da çalışmaz
// - Sadece prod + browser’da aktif olsun istersen burası ideal
export async function getFirebaseAnalytics() {
  if (typeof window === "undefined") return null;
  const supported = await isSupported();
  if (!supported) return null;
  return getAnalytics(app);
}

export default app;
