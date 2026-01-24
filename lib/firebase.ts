import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

/* =======================
   FIREBASE CONFIG
======================= */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

/* =======================
   INIT APP (SSR SAFE)
======================= */

// Next.js hot reload + server/client farkı yüzünden
// Firebase app sadece bir kere initialize edilir
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* =======================
   SERVICES
======================= */

export const db = getFirestore(app);
export const auth = getAuth(app);

// Storage explicit app ile bağlanır (çoklu app bug’larını önler)
export const storage = getStorage(app);
