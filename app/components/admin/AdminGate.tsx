"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export default function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = snap.exists() ? (snap.data() as any).role : null;

        if (role === "admin") {
          setOk(true);
        } else {
          router.push("/my");
          return;
        }
      } catch {
        router.push("/my");
        return;
      } finally {
        setChecking(false);
      }
    });

    return () => unsub();
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Kontrol ediliyor...
      </div>
    );
  }

  if (!ok) return null;

  return <>{children}</>;
}
