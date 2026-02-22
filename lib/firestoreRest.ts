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
  if (
    typeof (globalThis as any).EdgeRuntime !== "undefined" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    return envFallback;
  }
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
  const finalInit: RequestInit = { ...(init || {}) };
  if (typeof window === "undefined") {
    if (!(finalInit as any).next) {
      (finalInit as any).next = { revalidate: 300 };
    }
    if (!finalInit.cache) {
      finalInit.cache = "force-cache";
    }
  }

  const res = await fetch(url, finalInit);
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

const toFirestoreValue = (v: string | number | boolean | null) => {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  return { stringValue: String(v) };
};

type EqualFilter = {
  fieldPath: string;
  value: string | number | boolean | null;
};

type SortDirection = "ASCENDING" | "DESCENDING";

export type RunQueryByFieldParams = {
  collectionId: string;
  fieldPath: string;
  value: string | number | boolean | null;
  orderByField?: string | null;
  direction?: SortDirection;
  limit?: number;
  equalFilters?: EqualFilter[];
};

export type RunCollectionQueryParams = {
  collectionId: string;
  orderByField?: string | null;
  direction?: SortDirection;
  limit?: number;
  selectFields?: string[];
  equalFilters?: EqualFilter[];
};

export const isFirestoreIndexError = (err: unknown) => {
  const message = String((err as any)?.message || "");
  return (
    message.includes("requires an index") ||
    message.includes("create_composite") ||
    message.includes("FAILED_PRECONDITION")
  );
};

const isActiveDoc = (
  doc: Record<string, any>,
  statusField: string,
  statusValue: string
) => String(doc?.[statusField] || "") === statusValue;

const toEpochMs = (value: any) => {
  const date = new Date(value as any);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const sortByCreatedAtDesc = <T extends Record<string, any>>(
  rows: Array<T & { id: string }>
) =>
  [...rows].sort(
    (a, b) => toEpochMs((b as any)?.createdAt) - toEpochMs((a as any)?.createdAt)
  );

const buildWhere = (filters: EqualFilter[]) => {
  if (!Array.isArray(filters) || filters.length === 0) return undefined;
  if (filters.length === 1) {
    return {
      fieldFilter: {
        field: { fieldPath: filters[0].fieldPath },
        op: "EQUAL",
        value: toFirestoreValue(filters[0].value),
      },
    };
  }

  return {
    compositeFilter: {
      op: "AND",
      filters: filters.map((f) => ({
        fieldFilter: {
          field: { fieldPath: f.fieldPath },
          op: "EQUAL",
          value: toFirestoreValue(f.value),
        },
      })),
    },
  };
};

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
    if (err?.status === 404 || err?.status === 403) return null;
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
  equalFilters = [],
}: RunQueryByFieldParams): Promise<Array<T & { id: string }>> {
  const base = getBaseUrl();
  if (!base) return [];

  const allFilters: EqualFilter[] = [
    { fieldPath, value },
    ...(Array.isArray(equalFilters) ? equalFilters : []),
  ];

  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: buildWhere(allFilters),
      limit,
    },
  };
  if (orderByField) {
    (body.structuredQuery as any).orderBy = [
      { field: { fieldPath: orderByField }, direction },
    ];
  }

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

export async function runCollectionQuery<T = Record<string, any>>({
  collectionId,
  orderByField = "createdAt",
  direction = "DESCENDING",
  limit = 24,
  selectFields,
  equalFilters = [],
}: RunCollectionQueryParams): Promise<Array<T & { id: string }>> {
  const base = getBaseUrl();
  if (!base) return [];

  const structuredQuery: any = {
    from: [{ collectionId }],
    limit,
  };
  if (orderByField) {
    structuredQuery.orderBy = [{ field: { fieldPath: orderByField }, direction }];
  }

  if (Array.isArray(selectFields) && selectFields.length > 0) {
    structuredQuery.select = {
      fields: selectFields.map((fieldPath) => ({ fieldPath })),
    };
  }

  const where = buildWhere(equalFilters);
  if (where) {
    structuredQuery.where = where;
  }

  const url = withKey(`${base}/documents:runQuery`);
  const json = (await fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  })) as RunQueryResult[];

  const docs = json
    .map((row) => row.document)
    .filter(Boolean) as FirestoreDoc[];

  return docs.map((d) => decodeDoc(d)) as Array<T & { id: string }>;
}

export async function runActiveQueryByField<T = Record<string, any>>(
  params: Omit<RunQueryByFieldParams, "equalFilters"> & {
    statusField?: string;
    statusValue?: string;
    fallbackMultiplier?: number;
  }
): Promise<Array<T & { id: string }>> {
  const {
    statusField = "status",
    statusValue = "active",
    fallbackMultiplier = 4,
    limit = 24,
    ...rest
  } = params;

  try {
    return await runQueryByField<T>({
      ...rest,
      limit,
      equalFilters: [{ fieldPath: statusField, value: statusValue }],
    });
  } catch (err) {
    if (!isFirestoreIndexError(err)) throw err;

    const fallbackLimit = Math.min(500, Math.max(limit, limit * fallbackMultiplier * 3));
    const fallback = await runCollectionQuery<T & Record<string, any>>({
      collectionId: rest.collectionId,
      orderByField: null,
      limit: fallbackLimit,
      equalFilters: [{ fieldPath: statusField, value: statusValue }],
    });

    return sortByCreatedAtDesc(
      fallback.filter((doc) => {
        if (!isActiveDoc(doc as Record<string, any>, statusField, statusValue))
          return false;
        if (String((doc as any)?.[rest.fieldPath] || "") !== String(rest.value || ""))
          return false;
        return true;
      })
    ).slice(0, limit);
  }
}

export async function runActiveCollectionQuery<T = Record<string, any>>(
  params: Omit<RunCollectionQueryParams, "equalFilters"> & {
    statusField?: string;
    statusValue?: string;
    fallbackMultiplier?: number;
  }
): Promise<Array<T & { id: string }>> {
  const {
    statusField = "status",
    statusValue = "active",
    fallbackMultiplier = 4,
    limit = 24,
    selectFields,
    ...rest
  } = params;

  try {
    return await runCollectionQuery<T>({
      ...rest,
      limit,
      selectFields,
      equalFilters: [{ fieldPath: statusField, value: statusValue }],
    });
  } catch (err) {
    if (!isFirestoreIndexError(err)) throw err;

    const fallbackLimit = Math.min(500, Math.max(limit, limit * fallbackMultiplier * 3));
    const fields = Array.isArray(selectFields) ? [...selectFields] : undefined;
    if (fields && !fields.includes(statusField)) fields.push(statusField);
    if (fields && !fields.includes("createdAt")) fields.push("createdAt");

    const fallback = await runCollectionQuery<T & Record<string, any>>({
      collectionId: rest.collectionId,
      orderByField: null,
      limit: fallbackLimit,
      selectFields: fields,
      equalFilters: [{ fieldPath: statusField, value: statusValue }],
    });

    return sortByCreatedAtDesc(
      fallback.filter((doc) => {
        if (!isActiveDoc(doc as Record<string, any>, statusField, statusValue))
          return false;
        return true;
      })
    ).slice(0, limit);
  }
}

export function normTRAscii(input: string) {
  const lowered = (input || "").toLocaleLowerCase("tr-TR").trim();
  if (!lowered) return "";

  return lowered
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/[\/]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
