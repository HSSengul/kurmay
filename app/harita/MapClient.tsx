"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";

import {
  collection,
  getDocs,
  getDoc,
  doc,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildListingPath } from "@/lib/listingUrl";

type ListingLocation = {
  address?: string;
  lat: number;
  lng: number;
};

type ListingSummary = {
  id: string;
  title: string;
  price: number;
  imageUrls?: string[];
  categoryName?: string;
  subCategoryName?: string;
  ownerId?: string;
  createdAt?: any;
  location?: ListingLocation | null;
};

type ProfileMapItem = {
  id: string;
  name: string;
  avatarUrl?: string;
  listingCount: number;
  location: ListingLocation;
};

const DEFAULT_CENTER: [number, number] = [41.015, 28.979];

const fmtTL = (v: number) => {
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} TL`;
  }
};

export default function MapClient() {
  const router = useRouter();
  const [sellerItems, setSellerItems] = useState<ProfileMapItem[]>([]);
  const [listingAll, setListingAll] = useState<ListingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [expandedSellerId, setExpandedSellerId] = useState<string | null>(null);

  const [leafletReady, setLeafletReady] = useState(false);
  const [leafletApi, setLeafletApi] = useState<{
    MapContainer: any;
    Marker: any;
    TileLayer: any;
    L: any;
    useMapEvents: any;
  } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(11);
  const [bounds, setBounds] = useState<any>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [mapSettings, setMapSettings] = useState({
    aggregateBelowZoom: 11,
    listMinZoom: 12,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadLeaflet() {
      try {
        const [{ MapContainer, Marker, TileLayer, useMapEvents }, L] =
          await Promise.all([
            import("react-leaflet"),
            import("leaflet"),
            import("leaflet/dist/leaflet.css"),
          ]);

        if (cancelled) return;

        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
          iconUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
          shadowUrl:
            "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        });

        setLeafletApi({ MapContainer, Marker, TileLayer, L, useMapEvents });
        setLeafletReady(true);
      } catch {
        if (!cancelled) {
          setLeafletReady(false);
          setError("Harita bileşenleri yüklenemedi.");
        }
      }
    }

    loadLeaflet();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const settingsSnap = await getDoc(doc(db, "publicSettings", "maps"));
        if (settingsSnap.exists()) {
          const data = settingsSnap.data() as any;
          const agg = Number(data?.aggregateBelowZoom);
          const list = Number(data?.listMinZoom);
          setMapSettings((prev) => ({
            aggregateBelowZoom: Number.isFinite(agg)
              ? agg
              : prev.aggregateBelowZoom,
            listMinZoom: Number.isFinite(list) ? list : prev.listMinZoom,
          }));
        }

        const [listingSnap, profileSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "listings"),
              where("status", "==", "active"),
              limit(1000)
            )
          ),
          getDocs(
            query(
              collection(db, "publicProfiles"),
              where("showAddress", "==", true),
              limit(500)
            )
          ),
        ]);
        if (cancelled) return;

        const listings: ListingSummary[] = listingSnap.docs.map((d) => {
          const data = d.data() as any;
          const loc = data?.location;
          const location =
            loc && typeof loc.lat === "number" && typeof loc.lng === "number"
              ? {
                  lat: Number(loc.lat),
                  lng: Number(loc.lng),
                  address: String(loc.address || ""),
                }
              : null;

          return {
            id: d.id,
            title: String(data?.title || "İlan"),
            price: Number(data?.price ?? 0),
            imageUrls: Array.isArray(data?.imageUrls) ? data.imageUrls : [],
            categoryName: data?.categoryName,
            subCategoryName: data?.subCategoryName,
            ownerId: data?.ownerId,
            createdAt: data?.createdAt,
            location,
          };
        });

        const counts = new Map<string, number>();
        listings.forEach((l) => {
          const ownerId = String(l.ownerId || "");
          if (!ownerId) return;
          counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
        });

        const mapped = profileSnap.docs
          .map((d) => {
            const data = d.data() as any;
            const loc = data?.location;
            if (
              !loc ||
              typeof loc.lat !== "number" ||
              typeof loc.lng !== "number"
            ) {
              return null;
            }

            const listingCount = counts.get(d.id) || 0;
            if (listingCount <= 0) return null;

            return {
              id: d.id,
              name: String(data?.name || "Satıcı"),
              avatarUrl: data?.avatarUrl || "",
              listingCount,
              location: {
                lat: Number(loc.lat),
                lng: Number(loc.lng),
                address: String(loc.address || ""),
              },
            } as ProfileMapItem;
          })
          .filter(Boolean) as ProfileMapItem[];

        setListingAll(listings);
        setSellerItems(mapped);
      } catch (e) {
        setError("Harita verileri yüklenemedi.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const listingsByOwner = useMemo(() => {
    const map = new Map<string, ListingSummary[]>();
    listingAll.forEach((l) => {
      if (!l.ownerId) return;
      if (!map.has(l.ownerId)) map.set(l.ownerId, []);
      map.get(l.ownerId)!.push(l);
    });
    map.forEach((arr) => {
      arr.sort((a, b) => {
        const at = a.createdAt?.toDate?.()
          ? a.createdAt.toDate().getTime()
          : 0;
        const bt = b.createdAt?.toDate?.()
          ? b.createdAt.toDate().getTime()
          : 0;
        return bt - at;
      });
    });
    return map;
  }, [listingAll]);

  const center = useMemo<[number, number]>(() => {
    if (sellerItems.length === 0) return DEFAULT_CENTER;
    return [sellerItems[0].location.lat, sellerItems[0].location.lng];
  }, [sellerItems]);

  const aggregateCenter = useMemo<[number, number] | null>(() => {
    if (sellerItems.length === 0) return null;
    const sum = sellerItems.reduce(
      (acc: { lat: number; lng: number }, item: any) => {
        acc.lat += item.location.lat;
        acc.lng += item.location.lng;
        return acc;
      },
      { lat: 0, lng: 0 }
    );
    return [sum.lat / sellerItems.length, sum.lng / sellerItems.length];
  }, [sellerItems]);

  const totalListingsForSellerMode = useMemo(
    () => listingAll.length,
    [listingAll]
  );

  const effectiveListMinZoom = Math.max(
    mapSettings.listMinZoom,
    mapSettings.aggregateBelowZoom
  );

  const visibleSellers = useMemo(() => {
    if (!bounds || !leafletApi?.L) return sellerItems;
    return sellerItems.filter((item) =>
      bounds.contains(leafletApi.L.latLng(item.location.lat, item.location.lng))
    );
  }, [bounds, sellerItems, leafletApi?.L]);

  const buildCountIcon = (count: number, size = 34) => {
    if (!leafletApi?.L) return undefined;
    const html = `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:${Math.round(size / 2)}px;
        background:#1f2a24;
        color:#fff;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:${Math.max(12, Math.round(size / 3))}px;
        font-weight:700;
        border:2px solid #fff;
        box-shadow:0 6px 16px rgba(0,0,0,0.25);
      ">${count}</div>
    `;

    return leafletApi.L.divIcon({
      html,
      className: "",
      iconSize: [size, size],
      iconAnchor: [Math.round(size / 2), size],
    });
  };

  const MapEvents = leafletApi
    ? function MapEvents() {
        leafletApi.useMapEvents({
          zoomend: (e: any) => {
            const map = e.target;
            setZoomLevel(map.getZoom());
            setBounds(map.getBounds());
          },
          moveend: (e: any) => {
            const map = e.target;
            setZoomLevel(map.getZoom());
            setBounds(map.getBounds());
          },
        });
        return null;
      }
    : null;

  const title = "Satıcı Haritası";
  const sellerCount = sellerItems.length;

  return (
    <div className="min-h-screen bg-[#f7f4ef] px-4 py-6 sm:py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="rounded-3xl border border-[#ead8c5] bg-white/85 p-4 sm:p-6 shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#ead8c5] bg-[#fff7ed] px-3 py-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a6a4f]">
              Harita
            </div>
            <div className="text-xl sm:text-3xl font-semibold text-[#3f2a1a]">
              {title}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="rounded-full border border-[#ead8c5] bg-white px-3 py-1.5 text-xs sm:text-sm text-[#6b4b33]">
                Satıcı sayısı{" "}
                <span className="font-semibold text-[#3f2a1a]">
                  {sellerCount}
                </span>
              </div>
              <div className="rounded-full border border-[#ead8c5] bg-white px-3 py-1.5 text-xs sm:text-sm text-[#6b4b33]">
                Toplam ilan{" "}
                <span className="font-semibold text-[#3f2a1a]">
                  {totalListingsForSellerMode}
                </span>
              </div>
              <div className="hidden sm:inline-flex rounded-full border border-[#ead8c5] bg-white px-3 py-1.5 text-xs sm:text-sm text-[#6b4b33]">
                Görünür satıcı{" "}
                <span className="font-semibold text-[#3f2a1a]">
                  {visibleSellers.length}
                </span>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
          <div className="rounded-3xl overflow-hidden border border-[#ead8c5] bg-white/85 h-[70vh]">
            {loading || !leafletReady || !leafletApi ? (
              <div className="h-full flex items-center justify-center text-sm text-[#6b4b33]">
                Harita yükleniyor...
              </div>
            ) : (
              <leafletApi.MapContainer
                center={center}
                zoom={10}
                className="h-full w-full"
                scrollWheelZoom
                whenCreated={(map: any) => {
                  setZoomLevel(map.getZoom());
                  setBounds(map.getBounds());
                  setMapInstance(map);
                }}
              >
                <leafletApi.TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {MapEvents ? <MapEvents /> : null}

                {zoomLevel < mapSettings.aggregateBelowZoom && aggregateCenter ? (
                  <leafletApi.Marker
                    position={aggregateCenter}
                    icon={buildCountIcon(totalListingsForSellerMode, 44)}
                    eventHandlers={{
                      click: () => {
                        if (mapInstance) {
                          mapInstance.setView(
                            aggregateCenter,
                            effectiveListMinZoom
                          );
                        }
                      },
                    }}
                  />
                ) : (
                  sellerItems.map((item) => (
                    <leafletApi.Marker
                      key={item.id}
                      position={[item.location.lat, item.location.lng]}
                      icon={buildCountIcon(item.listingCount)}
                      eventHandlers={{
                        click: () => {
                          router.push(`/seller/${item.id}`);
                        },
                      }}
                    />
                  ))
                )}
              </leafletApi.MapContainer>
            )}
          </div>

          <div className="rounded-3xl border border-[#ead8c5] bg-white/85 p-4 space-y-3 max-h-[70vh] overflow-auto">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[#3f2a1a]">
                Haritadaki satıcılar
              </div>
            </div>

            {loading ? (
              <div className="text-sm text-[#6b4b33]">Yükleniyor...</div>
            ) : zoomLevel < effectiveListMinZoom ? (
              <div className="text-sm text-[#6b4b33]">
                Liste için biraz yakınlaştır.
              </div>
            ) : visibleSellers.length === 0 ? (
              <div className="text-sm text-[#6b4b33]">
                Haritada gösterilecek satıcı bulunamadı.
              </div>
            ) : (
              visibleSellers.map((item) => {
                const open = expandedSellerId === item.id;
                const sellerListings = listingsByOwner.get(item.id) || [];

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[#ead8c5] bg-white/90 p-3 space-y-2"
                  >
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/seller/${item.id}`}
                        className="flex items-center gap-3 flex-1 min-w-0"
                      >
                        <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#f3e9db] border border-[#ead8c5] flex-shrink-0">
                          {item.avatarUrl ? (
                            <Image
                              src={item.avatarUrl}
                              alt={item.name}
                              width={56}
                              height={56}
                              sizes="56px"
                              className="w-full h-full object-cover"
                              quality={45}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-[#9b7b5a]">
                              Görsel yok
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#3f2a1a] line-clamp-2">
                            {item.name}
                          </div>
                          <div className="text-xs text-[#8a6a4f] line-clamp-1">
                            İlan sayısı: {item.listingCount}
                          </div>
                        </div>
                      </Link>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSellerId(open ? null : item.id)
                        }
                        className="w-9 h-9 rounded-full border border-[#ead8c5] bg-white text-[#3f2a1a] text-lg font-semibold hover:bg-[#f7ede2] transition"
                        title="İlanları göster"
                      >
                        {open ? "−" : "+"}
                      </button>
                    </div>

                    {open && (
                      <div className="space-y-2 pl-2">
                        {sellerListings.length === 0 ? (
                          <div className="text-xs text-[#8a6a4f]">
                            Bu satıcıya ait ilan yok.
                          </div>
                        ) : (
                          sellerListings.map((l) => (
                            <Link
                              key={l.id}
                              href={buildListingPath(l.id, l.title)}
                              className="flex items-center gap-3 rounded-xl border border-[#ead8c5] bg-white/80 p-2 hover:bg-[#fff7ed] transition"
                            >
                              <div className="w-12 h-12 rounded-lg overflow-hidden bg-[#f3e9db] border border-[#ead8c5] flex-shrink-0">
                                {l.imageUrls?.[0] ? (
                                  <Image
                                    src={l.imageUrls[0]}
                                    alt={l.title}
                                    width={48}
                                    height={48}
                                    sizes="48px"
                                    className="w-full h-full object-cover"
                                    quality={45}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] text-[#9b7b5a]">
                                    Görsel yok
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-[#3f2a1a] line-clamp-2">
                                  {l.title}
                                </div>
                                <div className="text-[11px] text-[#8a6a4f]">
                                  {fmtTL(l.price)}
                                </div>
                              </div>
                            </Link>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
