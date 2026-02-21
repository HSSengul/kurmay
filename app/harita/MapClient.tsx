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
  startAfter,
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

type ListingGroup = {
  key: string;
  lat: number;
  lng: number;
  listings: ListingSummary[];
};

const DEFAULT_CENTER: [number, number] = [41.015, 28.979];
const LISTINGS_BATCH = 500;
const PROFILES_BATCH = 500;
const MAX_FETCH_PAGES = 40;

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

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toMapPointKey(lat: number, lng: number) {
  return `${lat.toFixed(6)}|${lng.toFixed(6)}`;
}

export default function MapClient() {
  const router = useRouter();
  const [sellerItems, setSellerItems] = useState<ProfileMapItem[]>([]);
  const [listingAll, setListingAll] = useState<ListingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapMode, setMapMode] = useState<"sellers" | "listings">("listings");

  const [expandedSellerId, setExpandedSellerId] = useState<string | null>(null);

  const [leafletReady, setLeafletReady] = useState(false);
  const [leafletApi, setLeafletApi] = useState<{
    MapContainer: any;
    Marker: any;
    TileLayer: any;
    Popup: any;
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
        const [{ MapContainer, Marker, Popup, TileLayer, useMapEvents }, L] =
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

        setLeafletApi({
          MapContainer,
          Marker,
          Popup,
          TileLayer,
          L,
          useMapEvents,
        });
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

        const fetchAllListingDocs = async () => {
          const docs: any[] = [];
          let cursor: any = null;
          for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
            const constraints: any[] = [
              where("status", "==", "active"),
              limit(LISTINGS_BATCH),
            ];
            if (cursor) constraints.push(startAfter(cursor));
            const snap = await getDocs(
              query(collection(db, "listings"), ...constraints)
            );
            docs.push(...snap.docs);
            if (snap.docs.length < LISTINGS_BATCH) break;
            cursor = snap.docs[snap.docs.length - 1];
          }
          return docs;
        };

        const fetchAllProfileDocs = async () => {
          const docs: any[] = [];
          let cursor: any = null;
          for (let page = 0; page < MAX_FETCH_PAGES; page += 1) {
            const constraints: any[] = [
              where("showAddress", "==", true),
              limit(PROFILES_BATCH),
            ];
            if (cursor) constraints.push(startAfter(cursor));
            const snap = await getDocs(
              query(collection(db, "publicProfiles"), ...constraints)
            );
            docs.push(...snap.docs);
            if (snap.docs.length < PROFILES_BATCH) break;
            cursor = snap.docs[snap.docs.length - 1];
          }
          return docs;
        };

        const [listingDocs, profileDocs] = await Promise.all([
          fetchAllListingDocs(),
          fetchAllProfileDocs(),
        ]);
        if (cancelled) return;

        const listings: ListingSummary[] = listingDocs.map((d) => {
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

        const mapped = profileDocs
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

  const listingsWithLocation = useMemo(
    () =>
      listingAll.filter(
        (item) =>
          item.location &&
          Number.isFinite(Number(item.location.lat)) &&
          Number.isFinite(Number(item.location.lng))
      ),
    [listingAll]
  );

  const listingGroups = useMemo<ListingGroup[]>(() => {
    if (listingsWithLocation.length === 0) return [];

    const grouped = new Map<string, ListingSummary[]>();
    listingsWithLocation.forEach((item) => {
      const key = toMapPointKey(item.location!.lat, item.location!.lng);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    });

    const out: ListingGroup[] = [];

    grouped.forEach((group, key) => {
      const sorted = [...group].sort((a, b) => {
        const at = a.createdAt?.toDate?.()
          ? a.createdAt.toDate().getTime()
          : 0;
        const bt = b.createdAt?.toDate?.()
          ? b.createdAt.toDate().getTime()
          : 0;
        return bt - at;
      });
      const baseLat = sorted[0].location!.lat;
      const baseLng = sorted[0].location!.lng;

      out.push({
        key,
        lat: baseLat,
        lng: baseLng,
        listings: sorted,
      });
    });

    return out;
  }, [listingsWithLocation]);

  const center = useMemo<[number, number]>(() => {
    if (mapMode === "listings" && listingsWithLocation.length > 0) {
      return [
        listingsWithLocation[0].location!.lat,
        listingsWithLocation[0].location!.lng,
      ];
    }
    if (sellerItems.length > 0) {
      return [sellerItems[0].location.lat, sellerItems[0].location.lng];
    }
    if (listingsWithLocation.length > 0) {
      return [
        listingsWithLocation[0].location!.lat,
        listingsWithLocation[0].location!.lng,
      ];
    }
    return DEFAULT_CENTER;
  }, [mapMode, sellerItems, listingsWithLocation]);

  const aggregateCenter = useMemo<[number, number] | null>(() => {
    const source =
      mapMode === "listings"
        ? listingsWithLocation.map((item) => ({
            location: { lat: item.location!.lat, lng: item.location!.lng },
          }))
        : sellerItems;
    if (source.length === 0) return null;
    const sum = source.reduce(
      (acc: { lat: number; lng: number }, item: any) => {
        acc.lat += item.location.lat;
        acc.lng += item.location.lng;
        return acc;
      },
      { lat: 0, lng: 0 }
    );
    return [sum.lat / source.length, sum.lng / source.length];
  }, [mapMode, sellerItems, listingsWithLocation]);

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

  const visibleListings = useMemo(() => {
    const groupSource =
      !bounds || !leafletApi?.L
        ? listingGroups
        : listingGroups.filter((item) =>
            bounds.contains(leafletApi.L.latLng(item.lat, item.lng))
          );

    const result: ListingSummary[] = [];
    groupSource.forEach((group) => {
      result.push(...group.listings);
    });
    return result;
  }, [bounds, listingGroups, leafletApi?.L]);

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

  const buildListingGroupIcon = (group: ListingGroup) => {
    if (!leafletApi?.L) return undefined;

    const topListing = group.listings[0];
    const image = String(topListing?.imageUrls?.[0] || "");
    const safeTitle = escapeHtml(String(topListing?.title || "Ilan"));
    const safeType = escapeHtml(
      String(
        topListing?.subCategoryName || topListing?.categoryName || "Ilan"
      )
    );
    const safePrice = escapeHtml(fmtTL(Number(topListing?.price || 0)));
    const count = group.listings.length;

    const overlapBadge =
      count > 1
        ? `<div style="
            min-width:34px;
            height:18px;
            border-radius:999px;
            background:#1f2a24;
            color:#fff;
            font-size:10px;
            font-weight:700;
            display:flex;
            align-items:center;
            justify-content:center;
            border:1px solid #fff;
            box-shadow:0 2px 6px rgba(15,23,42,0.18);
            position:absolute;
            top:-8px;
            right:-8px;
            z-index:2;
          ">${count} ilan</div>`
        : "";

    const subText =
      count > 1 ? `${safeType} · +${count - 1} ilan daha` : safeType;

    const media = image
      ? `<img src="${escapeHtml(
          image
        )}" alt="" style="width:24px;height:24px;border-radius:6px;object-fit:cover;border:1px solid #ead8c5;flex-shrink:0;" />`
      : `<div style="
          width:24px;
          height:24px;
          border-radius:6px;
          border:1px solid #ead8c5;
          background:#f7ede2;
          color:#8a6a4f;
          font-size:9px;
          font-weight:700;
          display:flex;
          align-items:center;
          justify-content:center;
          flex-shrink:0;
        ">I</div>`;

    const html = `
      <div style="
        position:relative;
        width:132px;
        height:76px;
      ">
        <div style="
          position:absolute;
          left:0;
          top:0;
          width:132px;
          display:flex;
          align-items:center;
          gap:6px;
          background:#fff;
          border:1px solid #ead8c5;
          border-radius:10px;
          padding:4px 5px;
          box-shadow:0 8px 18px rgba(15,23,42,0.2);
        ">
          ${overlapBadge}
          ${media}
          <div style="min-width:0;">
            <div style="
              font-size:9px;
              color:#8a6a4f;
              line-height:1.1;
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
            ">${subText}</div>
            <div style="
              font-size:10px;
              font-weight:700;
              color:#3f2a1a;
              line-height:1.2;
              white-space:nowrap;
              overflow:hidden;
              text-overflow:ellipsis;
            ">${safeTitle}</div>
            <div style="
              font-size:9px;
              font-weight:700;
              color:#0a8f44;
              line-height:1.1;
            ">${safePrice}</div>
          </div>
        </div>
        <div style="
          position:absolute;
          left:50%;
          bottom:0;
          transform:translateX(-50%);
          width:10px;
          height:10px;
          border-radius:999px;
          border:2px solid #fff;
          background:#0ea64b;
          box-shadow:0 3px 10px rgba(0,0,0,0.25);
        "></div>
      </div>
    `;

    return leafletApi.L.divIcon({
      html,
      className: "",
      iconSize: [132, 76],
      iconAnchor: [66, 71],
      popupAnchor: [0, -70],
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

  const title = mapMode === "sellers" ? "Satıcı Haritası" : "İlan Haritası";
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
            <div className="inline-flex rounded-full border border-[#ead8c5] bg-white p-1">
              <button
                type="button"
                onClick={() => {
                  setMapMode("sellers");
                  setExpandedSellerId(null);
                }}
                className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition ${
                  mapMode === "sellers"
                    ? "bg-[#1f2a24] text-white"
                    : "text-[#5a4330] hover:bg-[#f7ede2]"
                }`}
              >
                Satıcılar
              </button>
              <button
                type="button"
                onClick={() => {
                  setMapMode("listings");
                  setExpandedSellerId(null);
                }}
                className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition ${
                  mapMode === "listings"
                    ? "bg-[#1f2a24] text-white"
                    : "text-[#5a4330] hover:bg-[#f7ede2]"
                }`}
              >
                İlanlar
              </button>
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
                {mapMode === "sellers" ? "Görünür satıcı" : "Görünür ilan"}{" "}
                <span className="font-semibold text-[#3f2a1a]">
                  {mapMode === "sellers" ? visibleSellers.length : visibleListings.length}
                </span>
              </div>
            </div>
            {mapMode === "listings" && (
              <div className="text-[11px] sm:text-xs text-[#8a6a4f]">
                Aynı konumdaki ilanlar tek kartta toplanır. Karta tıklayınca ilan listesi açılır.
              </div>
            )}
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

                {mapMode === "sellers" ? (
                  zoomLevel < mapSettings.aggregateBelowZoom && aggregateCenter ? (
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
                  )
                ) : zoomLevel < mapSettings.aggregateBelowZoom && aggregateCenter ? (
                  <leafletApi.Marker
                    position={aggregateCenter}
                    icon={buildCountIcon(listingsWithLocation.length, 44)}
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
                  listingGroups.map((group) => (
                    <leafletApi.Marker
                      key={group.key}
                      position={[group.lat, group.lng]}
                      icon={buildListingGroupIcon(group)}
                    >
                      <leafletApi.Popup className="listing-group-popup">
                        <div className="min-w-[220px] max-w-[280px] space-y-2">
                          <div className="text-xs font-semibold text-[#3f2a1a]">
                            Bu konumda {group.listings.length} ilan var
                          </div>
                          <div className="max-h-60 overflow-auto space-y-1.5 pr-1">
                            {group.listings.map((item) => (
                              <Link
                                key={item.id}
                                href={buildListingPath(item.id, item.title)}
                                className="flex items-center gap-2 rounded-lg border border-[#ead8c5] bg-white px-2 py-1.5 hover:bg-[#fff7ed] transition"
                              >
                                <div className="w-9 h-9 rounded-md overflow-hidden bg-[#f3e9db] border border-[#ead8c5] shrink-0">
                                  {item.imageUrls?.[0] ? (
                                    <Image
                                      src={item.imageUrls[0]}
                                      alt={item.title}
                                      width={36}
                                      height={36}
                                      sizes="36px"
                                      className="w-full h-full object-cover"
                                      quality={40}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[9px] text-[#9b7b5a]">
                                      Yok
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-[#3f2a1a] line-clamp-1">
                                    {item.title}
                                  </div>
                                  <div className="text-[10px] text-[#8a6a4f] line-clamp-1">
                                    {item.subCategoryName || item.categoryName || "İlan"}
                                  </div>
                                  <div className="text-[11px] font-semibold text-[#0a8f44]">
                                    {fmtTL(item.price)}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      </leafletApi.Popup>
                    </leafletApi.Marker>
                  ))
                )}
              </leafletApi.MapContainer>
            )}
          </div>

          <div className="rounded-3xl border border-[#ead8c5] bg-white/85 p-4 space-y-3 max-h-[70vh] overflow-auto">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[#3f2a1a]">
                {mapMode === "sellers" ? "Haritadaki satıcılar" : "Haritadaki ilanlar"}
              </div>
            </div>

            {loading ? (
              <div className="text-sm text-[#6b4b33]">Yükleniyor...</div>
            ) : zoomLevel < effectiveListMinZoom ? (
              <div className="text-sm text-[#6b4b33]">
                Liste için biraz yakınlaştır.
              </div>
            ) : (
              <>
                {mapMode === "sellers" ? (
                  visibleSellers.length === 0 ? (
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
                  )
                ) : visibleListings.length === 0 ? (
                  <div className="text-sm text-[#6b4b33]">
                    Haritada gösterilecek ilan bulunamadı.
                  </div>
                ) : (
                  visibleListings.map((item) => (
                    <Link
                      key={item.id}
                      href={buildListingPath(item.id, item.title)}
                      className="flex items-center gap-3 rounded-2xl border border-[#ead8c5] bg-white/90 p-3 hover:bg-[#fff7ed] transition"
                    >
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#f3e9db] border border-[#ead8c5] flex-shrink-0">
                        {item.imageUrls?.[0] ? (
                          <Image
                            src={item.imageUrls[0]}
                            alt={item.title}
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
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#3f2a1a] line-clamp-2">
                          {item.title}
                        </div>
                        <div className="text-xs text-[#8a6a4f] line-clamp-1">
                          {item.categoryName || "Kategori"} / {item.subCategoryName || "Alt kategori"}
                        </div>
                        <div className="text-sm font-semibold text-[#1f2a24]">
                          {fmtTL(item.price)}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
