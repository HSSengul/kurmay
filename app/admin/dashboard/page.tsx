"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  StatCard,
  ToastView,
  useToast,
  cx,
  formatDateTR,
} from "@/app/components/admin/ui";

/* =========================
   HELPERS (TR DateKey)
========================= */

function getDateKeyTR(date = new Date()): string {
  try {
    // Europe/Istanbul gün sınırı doğru olsun
    return date.toLocaleDateString("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // fallback
    const d = new Date(date.getTime());
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

function safeNum(v: any, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function severityBadge(sev?: string) {
  if (sev === "high") return "🔴 HIGH";
  if (sev === "medium") return "🟠 MED";
  return "⚪ LOW";
}

function typeLabel(t?: string) {
  if (!t) return "flag";
  if (t === "lowPrice") return "Düşük Fiyat";
  if (t === "bannedWordsListing") return "Yasaklı Kelime (İlan)";
  if (t === "bannedWordsMessage") return "Yasaklı Kelime (Mesaj)";
  if (t === "newAccountHighActivity") return "Yeni Hesap + Aktivite";
  return t;
}

/* =========================
   TYPES
========================= */

type AdminGlobalStats = {
  totalUsers?: number;
  totalListings?: number;
  totalConversations?: number;
  totalMessages?: number;
  totalReports?: number;
  totalAutoFlags?: number;
  updatedAt?: any;
};

type DailyStats = {
  dateKey: string;

  newUsers?: number;
  newListings?: number;
  newConversations?: number;
  newMessages?: number;

  reportsOpened?: number;
  reportsResolved?: number;

  autoFlagsOpened?: number;
  updatedAt?: any;
};

type ReportRow = {
  id: string;
  type?: string;
  status?: string;
  reason?: string;
  createdAt?: any;
  targetType?: string;
  targetId?: string;
};

type AutoFlagRow = {
  id: string;
  type?: string;
  severity?: "low" | "medium" | "high";
  status?: "open" | "resolved";

  targetType?: "listing" | "user" | "message";
  targetId?: string;
  targetPath?: string;

  sampleText?: string | null;
  meta?: Record<string, any>;

  createdAt?: any;
  updatedAt?: any;
};

/* =========================
   MINI TREND UI
========================= */

function MiniBarRow(props: { label: string; value: number; max: number }) {
  const { label, value, max } = props;
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="w-10 text-[11px] text-slate-500">{label}</div>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-2 rounded-full bg-[#0f172a]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-10 text-right text-[11px] text-slate-700">{value}</div>
    </div>
  );
}

function TrendDayCard(props: {
  day: DailyStats;
  maxUsers: number;
  maxListings: number;
  maxConvos: number;
  maxMessages: number;
}) {
  const { day, maxUsers, maxListings, maxConvos, maxMessages } = props;

  const u = safeNum(day.newUsers, 0);
  const l = safeNum(day.newListings, 0);
  const c = safeNum(day.newConversations, 0);
  const m = safeNum(day.newMessages, 0);

  return (
    <div className="border border-slate-200/80 rounded-2xl p-4 bg-white/85 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">{day.dateKey}</div>
        <span className="text-[11px] px-2 py-1 rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
          7 gün
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <MiniBarRow label="Kullanıcı" value={u} max={maxUsers} />
        <MiniBarRow label="İlan" value={l} max={maxListings} />
        <MiniBarRow label="Sohbet" value={c} max={maxConvos} />
        <MiniBarRow label="Mesaj" value={m} max={maxMessages} />
      </div>
    </div>
  );
}

/* =========================
   PAGE
========================= */

export default function AdminDashboardPage() {
  const { toast, showToast } = useToast();

  const todayKey = useMemo(() => getDateKeyTR(new Date()), []);

  // global totals
  const [globalStats, setGlobalStats] = useState<AdminGlobalStats | null>(null);

  // today stats
  const [todayStats, setTodayStats] = useState<DailyStats | null>(null);

  // trend last 7
  const [trend7, setTrend7] = useState<DailyStats[]>([]);

  // reports
  const [lastReports, setLastReports] = useState<ReportRow[]>([]);

  // alarms (autoFlags)
  const [openFlags, setOpenFlags] = useState<AutoFlagRow[]>([]);

  const [loading, setLoading] = useState(false);

  const trendMax = useMemo(() => {
    const maxUsers = Math.max(...trend7.map((d) => safeNum(d.newUsers, 0)), 0);
    const maxListings = Math.max(
      ...trend7.map((d) => safeNum(d.newListings, 0)),
      0
    );
    const maxConvos = Math.max(
      ...trend7.map((d) => safeNum(d.newConversations, 0)),
      0
    );
    const maxMessages = Math.max(
      ...trend7.map((d) => safeNum(d.newMessages, 0)),
      0
    );

    return { maxUsers, maxListings, maxConvos, maxMessages };
  }, [trend7]);

  async function loadDashboard() {
    setLoading(true);

    try {
      // ✅ 1) GLOBAL TOTALS
      const globalRef = doc(db, "adminStats", "global");
      const globalSnap = await getDoc(globalRef);

      if (globalSnap.exists()) {
        setGlobalStats(globalSnap.data() as any);
      } else {
        setGlobalStats({
          totalUsers: 0,
          totalListings: 0,
          totalConversations: 0,
          totalMessages: 0,
          totalReports: 0,
          totalAutoFlags: 0,
        });
      }

      // ✅ 2) TODAY (adminStatsDaily/{YYYY-MM-DD})
      const todayRef = doc(db, "adminStatsDaily", todayKey);
      const todaySnap = await getDoc(todayRef);

      if (todaySnap.exists()) {
        setTodayStats(todaySnap.data() as any);
      } else {
        setTodayStats({
          dateKey: todayKey,
          newUsers: 0,
          newListings: 0,
          newConversations: 0,
          newMessages: 0,
          reportsOpened: 0,
          reportsResolved: 0,
          autoFlagsOpened: 0,
        });
      }

      // ✅ 3) LAST 7 DAYS TREND
      const dailySnap = await getDocs(
        query(
          collection(db, "adminStatsDaily"),
          orderBy("dateKey", "desc"),
          limit(7)
        )
      );

      const days = dailySnap.docs
        .map((d) => d.data() as any)
        .filter(Boolean) as DailyStats[];

      // order asc for nicer UI
      const asc = [...days].sort((a, b) => (a.dateKey > b.dateKey ? 1 : -1));
      setTrend7(asc);

      // ✅ 4) LAST REPORTS (Son 10)
      try {
        const rSnap = await getDocs(
          query(
            collection(db, "reports"),
            orderBy("createdAt", "desc"),
            limit(10)
          )
        );

        const rows = rSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ReportRow[];

        setLastReports(rows);
      } catch {
        setLastReports([]);
      }

      // ✅ 5) ALARM CENTER (autoFlags open)
      // (index ihtimali varsa fallback koyduk)
      try {
        let flags: AutoFlagRow[] = [];

        try {
          const fSnap = await getDocs(
            query(
              collection(db, "autoFlags"),
              where("status", "==", "open"),
              orderBy("updatedAt", "desc"),
              limit(10)
            )
          );

          flags = fSnap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          })) as AutoFlagRow[];
        } catch {
          // fallback: orderBy olmadan (index istemez)
          const fSnap2 = await getDocs(
            query(
              collection(db, "autoFlags"),
              where("status", "==", "open"),
              limit(10)
            )
          );

          flags = fSnap2.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          })) as AutoFlagRow[];
        }

        setOpenFlags(flags);
      } catch {
        setOpenFlags([]);
      }

      showToast({
        type: "success",
        title: "Güncellendi",
        text: "Kontrol paneli verileri yenilendi (YOL B).",
      });
    } catch {
      showToast({
        type: "error",
        title: "Hata",
        text: "Kontrol paneli verileri çekilemedi.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const totals = {
    users: safeNum(globalStats?.totalUsers, 0),
    listings: safeNum(globalStats?.totalListings, 0),
    convos: safeNum(globalStats?.totalConversations, 0),
    messages: safeNum(globalStats?.totalMessages, 0),
  };

  const today = {
    users: safeNum(todayStats?.newUsers, 0),
    listings: safeNum(todayStats?.newListings, 0),
    convos: safeNum(todayStats?.newConversations, 0),
    messages: safeNum(todayStats?.newMessages, 0),
    reportsOpened: safeNum(todayStats?.reportsOpened, 0),
    reportsResolved: safeNum(todayStats?.reportsResolved, 0),
    autoFlagsOpened: safeNum(todayStats?.autoFlagsOpened, 0),
  };

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      {/* Header */}
      <div className="border rounded-2xl bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Admin</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">
              Kontrol Paneli
            </div>
            <div className="mt-1 text-sm text-gray-600">
              YOL B aktif ✅ (adminStats + daily + autoFlags)
            </div>

            <div className="mt-2 text-[11px] text-gray-500">
              Bugün anahtarı: <span className="font-semibold">{todayKey}</span>
              {globalStats?.updatedAt ? (
                <span className="ml-2">
                  • global güncelleme: {formatDateTR(globalStats.updatedAt)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadDashboard}
              className={cx(
                "px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm",
                loading ? "opacity-60 pointer-events-none" : ""
              )}
            >
              ⟳ Yenile
            </button>

            <Link
              href="/admin/categories"
              className="px-3 py-2 rounded-xl bg-gray-900 text-white hover:bg-black text-sm"
            >
              Kataloğa Git
            </Link>
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          title="Toplam Kullanıcı"
          value={String(totals.users)}
          hint="adminStats/global"
          icon="👤"
        />
        <StatCard
          title="Toplam İlan"
          value={String(totals.listings)}
          hint="adminStats/global"
          icon="🕰️"
        />
        <StatCard
          title="Toplam Sohbet"
          value={String(totals.convos)}
          hint="adminStats/global"
          icon="💬"
        />
        <StatCard
          title="Toplam Mesaj"
          value={String(totals.messages)}
          hint="adminStats/global"
          icon="✉️"
        />
      </div>

      {/* Today */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          title="Bugün Kayıt"
          value={String(today.users)}
          hint="adminStatsDaily/today"
          icon="🆕"
        />
        <StatCard
          title="Bugün İlan"
          value={String(today.listings)}
          hint="adminStatsDaily/today"
          icon="📌"
        />
        <StatCard
          title="Bugün Sohbet"
          value={String(today.convos)}
          hint="adminStatsDaily/today"
          icon="🧵"
        />
        <StatCard
          title="Bugün Mesaj"
          value={String(today.messages)}
          hint="adminStatsDaily/today"
          icon="📨"
        />
      </div>

      {/* Trend + Panels */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Trend 7 Days */}
        <div className="border rounded-2xl bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Son 7 Gün Trend
              </div>
              <div className="mt-1 text-xs text-gray-500">
                users / listings / conversations / messages (adminStatsDaily)
              </div>
            </div>

            <span className="text-[11px] px-2 py-1 rounded-xl border bg-gray-50 text-gray-600">
              chart-lite
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {trend7.length === 0 ? (
              <div className="border rounded-2xl bg-gray-50 p-5 text-gray-700">
                <div className="font-semibold text-gray-900">Trend yok</div>
                <div className="mt-1 text-sm">
                  Henüz daily stat oluşmadı. İlk aktivitelerden sonra dolacak.
                </div>
              </div>
            ) : (
              trend7.map((d) => (
                <TrendDayCard
                  key={d.dateKey}
                  day={d}
                  maxUsers={trendMax.maxUsers}
                  maxListings={trendMax.maxListings}
                  maxConvos={trendMax.maxConvos}
                  maxMessages={trendMax.maxMessages}
                />
              ))
            )}
          </div>
        </div>

        {/* Alarm Center */}
        <div className="border rounded-2xl bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Alarm Merkezi
              </div>
              <div className="mt-1 text-xs text-gray-500">
                oto bayraklar (açık) + rapor özetleri
              </div>
            </div>

            <Link
              href="/admin/auto-flags"
              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
            >
              Oto Bayraklar
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="border rounded-2xl p-4 bg-gray-50">
              <div className="text-xs text-gray-500">Bugün Rapor Açıldı</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">
                {today.reportsOpened}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                reportsOpened
              </div>
            </div>

            <div className="border rounded-2xl p-4 bg-gray-50">
              <div className="text-xs text-gray-500">Bugün Rapor Çözüldü</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">
                {today.reportsResolved}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                reportsResolved
              </div>
            </div>

            <div className="border rounded-2xl p-4 bg-gray-50">
              <div className="text-xs text-gray-500">Bugün Oto Bayrak</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">
                {today.autoFlagsOpened}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                autoFlagsOpened
              </div>
            </div>
          </div>

          {/* Open Flags List */}
          <div className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-900">
                Açık Oto Bayraklar (Son 10)
                </div>
                <span className="text-[11px] px-2 py-1 rounded-xl border bg-gray-50 text-gray-600">
                durum=açık
                </span>
              </div>

            <div className="mt-2 space-y-2">
              {openFlags.length === 0 ? (
                <div className="border rounded-2xl bg-gray-50 p-4 text-gray-700">
                  <div className="font-semibold text-gray-900">
                    Şimdilik alarm yok ✅
                  </div>
                  <div className="mt-1 text-sm">
                    Risk tespiti gelince burada listelenecek.
                  </div>
                </div>
              ) : (
                openFlags.map((f) => (
                  <div
                    key={f.id}
                    className="border rounded-2xl p-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {severityBadge(f.severity)} • {typeLabel(f.type)}
                        </div>

                        <div className="mt-1 text-xs text-gray-500">
                          Target:{" "}
                          <span className="font-semibold">
                            {f.targetType || "unknown"}
                          </span>{" "}
                          • {f.targetId?.slice(0, 10) || "—"}
                        </div>

                        {f.sampleText ? (
                          <div className="mt-1 text-[11px] text-gray-600 line-clamp-2">
                            “{String(f.sampleText)}”
                          </div>
                        ) : null}

                        <div className="mt-1 text-[11px] text-gray-500">
                          {f.updatedAt ? formatDateTR(f.updatedAt) : "—"}
                        </div>
                      </div>

                      <span className="text-[11px] px-2 py-1 rounded-xl border bg-white text-gray-600">
                        {f.id.slice(0, 6)}…
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-4">
            <div className="text-sm font-semibold text-gray-900">
              Quick Actions
            </div>

            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Link
                href="/admin/users"
                className="px-4 py-3 rounded-2xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-left"
              >
                <div className="text-sm font-semibold">Kullanıcı Yönetimi</div>
                <div className="text-xs text-gray-500 mt-1">
                  ban / note / risk
                </div>
              </Link>

              <Link
                href="/admin/listings"
                className="px-4 py-3 rounded-2xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-left"
              >
                <div className="text-sm font-semibold">İlan Moderasyonu</div>
                <div className="text-xs text-gray-500 mt-1">
                  disable / enable
                </div>
              </Link>

              <Link
                href="/admin/reports"
                className="px-4 py-3 rounded-2xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-left"
              >
                <div className="text-sm font-semibold">Raporlar</div>
                <div className="text-xs text-gray-500 mt-1">
                  open / resolved
                </div>
              </Link>

              <Link
                href="/admin/settings"
                className="px-4 py-3 rounded-2xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-left"
              >
                <div className="text-sm font-semibold">Ayarlar</div>
                <div className="text-xs text-gray-500 mt-1">
                  policy / feature flags
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Last Reports */}
      <div className="border rounded-2xl bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Son Raporlar
            </div>
            <div className="mt-1 text-xs text-gray-500">
              En yeni 10 rapor (reports)
            </div>
          </div>

          <Link
            href="/admin/reports"
            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
          >
            Tümünü gör
          </Link>
        </div>

        <div className="mt-4 space-y-2">
          {lastReports.length === 0 ? (
            <div className="border rounded-2xl bg-gray-50 p-5 text-gray-700">
              <div className="font-semibold text-gray-900">Henüz rapor yok</div>
              <div className="mt-1 text-sm">
                Raporlar gelince burada görünür.
              </div>
            </div>
          ) : (
            lastReports.map((r) => (
              <div
                key={r.id}
                className="border rounded-2xl p-3 hover:bg-gray-50 transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">
                      {r.type || r.targetType || "report"} •{" "}
                      {r.status || "open"}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {r.reason ? `Sebep: ${r.reason}` : "Sebep alanı yok"}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {formatDateTR(r.createdAt)}
                    </div>
                  </div>

                  <span className="text-[11px] px-2 py-1 rounded-xl border bg-white text-gray-600">
                    {r.id.slice(0, 6)}…
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="text-[11px] text-gray-500">
        Not: Bu sayfa artık count query kullanmıyor. Tüm veriler YOL B
        (adminStats + daily) üzerinden geliyor. Bu yüzden hızlı ve ucuz.
      </div>
    </div>
  );
}
