"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type Brand = {
  id: string;
  name: string;
  nameLower: string;
};

type Model = {
  id: string;
  name: string;
  nameLower: string;
  brandId: string;
};

type Conversation = {
  buyerId: string;
  sellerId: string;
  unread: {
    buyer: number;
    seller: number;
  };
  deletedFor?: {
    buyer: boolean;
    seller: boolean;
  };
};

export default function Header() {
  const router = useRouter();
  const headerRef = useRef<HTMLDivElement>(null);

  const [user, setUser] = useState<User | null>(null);
  const [openMenu, setOpenMenu] = useState<null | "buy" | "sell">(null);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);

  const [unreadTotal, setUnreadTotal] = useState(0);

  const activeBrandObj = useMemo(
    () => brands.find((b) => b.id === activeBrand) || null,
    [brands, activeBrand]
  );

  useEffect(() => {
    if (!headerRef.current) return;

    const updateHeight = () => {
      const h = headerRef.current!.offsetHeight;
      document.documentElement.style.setProperty(
        "--app-header-height",
        `${h}px`
      );
    };

    updateHeight();

    const ro = new ResizeObserver(updateHeight);
    ro.observe(headerRef.current);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setActiveBrand(null);
        setModels([]);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    async function loadBrands() {
      const q = query(collection(db, "brands"), orderBy("nameLower", "asc"));
      const snap = await getDocs(q);
      setBrands(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          nameLower: d.data().nameLower,
        }))
      );
    }
    loadBrands();
  }, []);

  useEffect(() => {
    if (!activeBrand || openMenu !== "buy") return;
    let cancelled = false;

    async function loadModels() {
      const q = query(
        collection(db, "models"),
        where("brandId", "==", activeBrand),
        orderBy("nameLower", "asc")
      );

      const snap = await getDocs(q);
      if (!cancelled) {
        setModels(
          snap.docs.map((d) => ({
            id: d.id,
            name: d.data().name,
            nameLower: d.data().nameLower,
            brandId: d.data().brandId,
          }))
        );
      }
    }

    loadModels();
    return () => {
      cancelled = true;
    };
  }, [activeBrand, openMenu]);

  useEffect(() => {
    if (!user) {
      setUnreadTotal(0);
      return;
    }

    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      let total = 0;

      snap.forEach((doc) => {
        const data = doc.data() as Conversation;

        if (
          (data.buyerId === user.uid && data.deletedFor?.buyer) ||
          (data.sellerId === user.uid && data.deletedFor?.seller)
        ) {
          return;
        }

        if (data.buyerId === user.uid) {
          total += data.unread?.buyer || 0;
        } else if (data.sellerId === user.uid) {
          total += data.unread?.seller || 0;
        }
      });

      setUnreadTotal(total);
    });

    return () => unsub();
  }, [user]);

  return (
    <header
      ref={headerRef}
      className="w-full bg-white border-b shadow-sm relative z-50"
    >
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold text-blue-600">
            İlanSitesi
          </Link>

          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === "buy" ? null : "buy")}
              className="font-medium hover:text-blue-600"
            >
              Saat Al ▾
            </button>

            {openMenu === "buy" && (
              <div className="absolute left-0 top-full mt-3 bg-white border shadow-2xl rounded-2xl p-6 w-[520px]">
                <div className="grid grid-cols-2 gap-6">
                  <div className="border-r pr-4">
                    <div className="text-sm text-gray-500 mb-3">
                      Markalar
                    </div>
                    <ul className="space-y-2">
                      {brands.map((b) => (
                        <li key={b.id}>
                          <div
                            onMouseEnter={() => setActiveBrand(b.id)}
                            className={`cursor-pointer px-3 py-2 rounded-lg text-sm ${
                              activeBrand === b.id
                                ? "bg-blue-100 text-blue-700 font-medium"
                                : "hover:bg-gray-100"
                            }`}
                          >
                            <Link
                              href={`/${b.nameLower}`}
                              onClick={() => {
                                setOpenMenu(null);
                                setActiveBrand(null);
                                setModels([]);
                              }}
                              className="block"
                            >
                              {b.name}
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500 mb-3">
                      Modeller
                    </div>
                    {!activeBrandObj ? (
                      <div className="text-sm text-gray-400">
                        Marka seç
                      </div>
                    ) : models.length === 0 ? (
                      <div className="text-sm text-gray-400">
                        Bu markaya ait model yok
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {models.map((m) => (
                          <li key={m.id}>
                            <Link
                              href={`/${activeBrandObj.nameLower}/${m.nameLower}`}
                              onClick={() => {
                                setOpenMenu(null);
                                setActiveBrand(null);
                                setModels([]);
                              }}
                              className="block text-sm px-2 py-1 rounded hover:bg-gray-100"
                            >
                              {m.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === "sell" ? null : "sell")}
              className="font-medium hover:text-blue-600"
            >
              Saat Sat ▾
            </button>

            {openMenu === "sell" && (
              <div className="absolute left-0 top-full mt-3 bg-white border shadow-xl rounded-xl p-3 w-48">
                <Link
                  href="/new"
                  onClick={() => setOpenMenu(null)}
                  className="block px-3 py-2 rounded hover:bg-gray-100 text-sm"
                >
                  İlan Ver
                </Link>

                {user && (
                  <Link
                    href="/my"
                    onClick={() => setOpenMenu(null)}
                    className="block px-3 py-2 rounded hover:bg-gray-100 text-sm"
                  >
                    Benim İlanlarım
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <Link
              href="/my/messages"
              className="relative flex items-center justify-center w-10 h-10 rounded-full hover:bg-gray-100"
            >
              <svg
                className="w-6 h-6 text-gray-700"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 8h10M7 12h6m-6 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                />
              </svg>

              {unreadTotal > 0 && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
                  {unreadTotal}
                </div>
              )}
            </Link>
          )}

          {user ? (
            <>
              <span className="text-sm text-gray-600 hidden sm:block">
                {user.email}
              </span>

              <Link
                href="/my"
                className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-lg text-sm"
              >
                Benim İlanlarım
              </Link>

              <Link
                href="/new"
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm"
              >
                Yeni İlan
              </Link>

              <button
                onClick={handleLogout}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm"
              >
                Çıkış
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
            >
              Giriş Yap
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
