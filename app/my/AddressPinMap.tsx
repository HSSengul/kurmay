"use client";

import { useEffect, useMemo, useState } from "react";

type LocationValue = {
  lat: number;
  lng: number;
  address?: string;
};

type LeafletApi = {
  MapContainer: any;
  Marker: any;
  TileLayer: any;
  useMapEvents: any;
};

type AddressPinMapProps = {
  value: LocationValue | null;
  address: string;
  disabled?: boolean;
  onChange: (value: LocationValue | null) => void;
  onAddressResolved?: (address: string) => void;
};

const DEFAULT_CENTER: [number, number] = [41.015, 28.979];

async function geocodeAddress(address: string) {
  const q = (address || "").trim();
  if (!q) return null;
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok) return null;
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label: String(data.label || q) };
  } catch {
    return null;
  }
}

async function reverseGeocode(lat: number, lng: number) {
  try {
    const res = await fetch(
      `/api/reverse-geocode?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(
        String(lng)
      )}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.ok) return null;
    const label = String(data.label || "").trim();
    return label || null;
  } catch {
    return null;
  }
}

export default function AddressPinMap({
  value,
  address,
  disabled,
  onChange,
  onAddressResolved,
}: AddressPinMapProps) {
  const [leafletApi, setLeafletApi] = useState<LeafletApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMessage, setLookupMessage] = useState("");

  const [marker, setMarker] = useState<LocationValue | null>(value);
  const [center, setCenter] = useState<[number, number]>(
    value ? [value.lat, value.lng] : DEFAULT_CENTER
  );
  const [initialized, setInitialized] = useState(false);

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

        setLeafletApi({ MapContainer, Marker, TileLayer, useMapEvents });
      } catch {
        setLookupMessage("Harita bileşenleri yüklenemedi.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadLeaflet();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!value) return;
    setMarker(value);
    setCenter([value.lat, value.lng]);
  }, [value?.lat, value?.lng]);

  useEffect(() => {
    if (initialized) return;
    if (value || !address) return;

    let cancelled = false;

    async function initFromAddress() {
      setLookupBusy(true);
      setLookupMessage("");
      const geo = await geocodeAddress(address);
      if (cancelled) return;
      if (geo) {
        const next = { lat: geo.lat, lng: geo.lng, address: geo.label };
        setMarker(next);
        setCenter([geo.lat, geo.lng]);
        onChange(next);
        onAddressResolved?.(geo.label);
      }
      setLookupBusy(false);
      setInitialized(true);
    }

    initFromAddress();

    return () => {
      cancelled = true;
    };
  }, [address, initialized, onAddressResolved, onChange, value]);

  const centerLabel = useMemo(() => {
    if (!marker) return "Pin seçilmedi";
    return `${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}`;
  }, [marker]);

  const handlePick = async (lat: number, lng: number) => {
    if (disabled) return;
    setLookupMessage("");

    const next: LocationValue = {
      lat,
      lng,
      address: marker?.address || address || "",
    };

    setMarker(next);
    setCenter([lat, lng]);
    onChange(next);

    const label = await reverseGeocode(lat, lng);
    if (label) {
      const updated: LocationValue = { lat, lng, address: label };
      setMarker(updated);
      onChange(updated);
      onAddressResolved?.(label);
    }
  };

  const handleSyncFromAddress = async () => {
    if (disabled) return;
    setLookupBusy(true);
    setLookupMessage("");
    const geo = await geocodeAddress(address);
    if (!geo) {
      setLookupMessage("Adres bulunamadı.");
      setLookupBusy(false);
      return;
    }

    const next: LocationValue = { lat: geo.lat, lng: geo.lng, address: geo.label };
    setMarker(next);
    setCenter([geo.lat, geo.lng]);
    onChange(next);
    onAddressResolved?.(geo.label);
    setLookupBusy(false);
  };

  const MapClickHandler = leafletApi
    ? function MapClickHandler() {
        leafletApi.useMapEvents({
          click(e: any) {
            handlePick(e.latlng.lat, e.latlng.lng);
          },
        });
        return null;
      }
    : null;

  return (
    <div className="space-y-2">
      <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white h-52">
        {loading || !leafletApi ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Harita yükleniyor...
          </div>
        ) : (
          <leafletApi.MapContainer
            center={center}
            zoom={13}
            className="h-full w-full"
            scrollWheelZoom={!disabled}
          >
            <leafletApi.TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {MapClickHandler ? <MapClickHandler /> : null}

            {marker && (
              <leafletApi.Marker
                position={[marker.lat, marker.lng]}
                draggable={!disabled}
                eventHandlers={{
                  dragend: (e: any) => {
                    const pos = e.target.getLatLng();
                    handlePick(pos.lat, pos.lng);
                  },
                }}
              />
            )}
          </leafletApi.MapContainer>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Seçili konum: {centerLabel}</span>
        <button
          type="button"
          onClick={handleSyncFromAddress}
          disabled={disabled || lookupBusy || !address}
          className="px-2 py-1 rounded-full border border-slate-200 bg-white text-xs disabled:opacity-60"
        >
          {lookupBusy ? "Adres aranıyor..." : "Adresten pinle"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setMarker(null);
            onChange(null);
          }}
          disabled={disabled}
          className="px-2 py-1 rounded-full border border-slate-200 bg-white text-xs disabled:opacity-60"
        >
          Pini kaldır
        </button>
      </div>

      {lookupMessage && (
        <div className="text-xs text-rose-600">{lookupMessage}</div>
      )}
    </div>
  );
}
