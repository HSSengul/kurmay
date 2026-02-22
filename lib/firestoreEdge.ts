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

const getProjectId = () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const getApiKey = () => process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";

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

const fetchJson = async (url: string) => {
  const res = await fetch(url, {
    cache: "force-cache",
    next: { revalidate: 300 },
  });
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
      out[k] = decodeValue(val as FirestoreValue);
    }
    return out;
  }
  return null;
};

const decodeDoc = (doc: FirestoreDoc) => {
  const out: Record<string, any> = {};
  const fields = doc.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeValue(v as FirestoreValue);
  }
  if (doc.name) {
    const parts = doc.name.split("/");
    out.id = parts[parts.length - 1];
  }
  return out;
};

export async function fetchDocumentEdge<T = Record<string, any>>(
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

export async function listCollectionEdge<T = Record<string, any>>(
  collectionId: string,
  pageSize = 500,
  maxPages = 2
): Promise<Array<T & { id: string }>> {
  const base = getBaseUrl();
  if (!base) return [];

  const out: Array<T & { id: string }> = [];
  let pageToken = "";
  let page = 0;

  while (page < maxPages) {
    const tokenPart = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const url = withKey(`${base}/documents/${collectionId}?pageSize=${pageSize}${tokenPart}`);
    const json = await fetchJson(url);
    const docs = Array.isArray(json?.documents) ? json.documents : [];
    out.push(...(docs.map((d: FirestoreDoc) => decodeDoc(d)) as Array<T & { id: string }>));
    pageToken = json?.nextPageToken || "";
    if (!pageToken) break;
    page += 1;
  }

  return out;
}
