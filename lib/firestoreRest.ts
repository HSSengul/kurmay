import "server-only";

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { nullValue: null };

type FirestoreDoc = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
};

type RunQueryResult = {
  document?: FirestoreDoc;
};

let envFallback: { projectId?: string; apiKey?: string } | null = null;

const readEnvFallback = () => {
  if (envFallback) return envFallback;
  envFallback = {};
  if (typeof window !== "undefined") return envFallback;
  try {
    // Lazy-read .env.local if process.env is not populated in the server runtime
    // This is a local-dev convenience to keep SSR metadata working.
    // In production, .env.local won't exist, so this no-ops.
    const fs = require("fs");
    const path = require("path");
    const files = [".env.local", ".env"];
    const roots: string[] = [];
    let cursor = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      roots.push(cursor);
      const next = path.dirname(cursor);
      if (next === cursor) break;
      cursor = next;
    }
    for (const root of roots) {
      for (const file of files) {
        const full = path.join(root, file);
        if (!fs.existsSync(full)) continue;
        const content = fs.readFileSync(full, "utf8");
        for (const line of content.split(/\r?\n/)) {
          if (!line || line.trim().startsWith("#")) continue;
          const idx = line.indexOf("=");
          if (idx < 0) continue;
          const key = line.slice(0, idx).trim();
          let val = line.slice(idx + 1).trim();
          if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key === "NEXT_PUBLIC_FIREBASE_PROJECT_ID" && !envFallback.projectId) {
            envFallback.projectId = val;
          }
          if (key === "NEXT_PUBLIC_FIREBASE_API_KEY" && !envFallback.apiKey) {
            envFallback.apiKey = val;
          }
        }
      }
      if (envFallback.projectId && envFallback.apiKey) break;
    }
  } catch {
    // ignore
  }
  return envFallback;
};

const getProjectId = () =>
  readEnvFallback().projectId ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  "";

const getApiKey = () =>
  readEnvFallback().apiKey || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";

const getBaseUrl = () => {
  const projectId = getProjectId();
  if (!projectId) return "";
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
};

const withKey = (url: string) => {
  const apiKey = getApiKey();
  if (!apiKey) return url;
  return url.includes("?") ? `${url}&key=${apiKey}` : `${url}?key=${apiKey}`;
};

const fetchJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Firestore REST ${res.status}: ${text}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
};

const decodeValue = (v: FirestoreValue | undefined): any => {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return Boolean(v.booleanValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) {
    const values = v.arrayValue.values || [];
    return values.map((x) => decodeValue(x));
  }
  if ("mapValue" in v) {
    const fields = v.mapValue.fields || {};
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(fields)) {
      out[k] = decodeValue(val);
    }
    return out;
  }
  return null;
};

const decodeDoc = (doc: FirestoreDoc) => {
  const out: Record<string, any> = {};
  const fields = doc.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeValue(v);
  }
  if (doc.name) {
    const parts = doc.name.split("/");
    out.id = parts[parts.length - 1];
  }
  return out;
};

const toStringValue = (v: string) => ({ stringValue: v });

export async function fetchDocument<T = Record<string, any>>(
  collectionId: string,
  docId: string
): Promise<(T & { id: string }) | null> {
  const base = getBaseUrl();
  if (!base) return null;
  try {
    const url = withKey(`${base}/documents/${collectionId}/${docId}`);
    const json = await fetchJson(url);
    return decodeDoc(json) as T & { id: string };
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function listCollection<T = Record<string, any>>(
  collectionId: string,
  pageSize = 500,
  maxPages = 5
): Promise<Array<T & { id: string }>> {
  const base = getBaseUrl();
  if (!base) return [];

  const out: Array<T & { id: string }> = [];
  let pageToken = "";
  let page = 0;

  while (page < maxPages) {
    const tokenPart = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const url = withKey(
      `${base}/documents/${collectionId}?pageSize=${pageSize}${tokenPart}`
    );
    const json = await fetchJson(url);
    const docs = Array.isArray(json?.documents) ? json.documents : [];
    out.push(...(docs.map((d: FirestoreDoc) => decodeDoc(d)) as Array<T & { id: string }>));
    pageToken = json?.nextPageToken || "";
    if (!pageToken) break;
    page += 1;
  }

  return out;
}

export async function runQueryByField<T = Record<string, any>>({
  collectionId,
  fieldPath,
  value,
  orderByField = "createdAt",
  direction = "DESCENDING",
  limit = 24,
}: {
  collectionId: string;
  fieldPath: string;
  value: string;
  orderByField?: string;
  direction?: "ASCENDING" | "DESCENDING";
  limit?: number;
}): Promise<Array<T & { id: string }>> {
  const base = getBaseUrl();
  if (!base) return [];

  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath },
          op: "EQUAL",
          value: toStringValue(value),
        },
      },
      orderBy: [{ field: { fieldPath: orderByField }, direction }],
      limit,
    },
  };

  const url = withKey(`${base}/documents:runQuery`);
  const json = (await fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })) as RunQueryResult[];

  const docs = json
    .map((row) => row.document)
    .filter(Boolean) as FirestoreDoc[];

  return docs.map((d) => decodeDoc(d)) as Array<T & { id: string }>;
}

export function normTRAscii(input: string) {
  return (input || "")
    .toLocaleLowerCase("tr-TR")
    .trim()
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replaceAll("İ", "i")
    .replace(/[\/]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
