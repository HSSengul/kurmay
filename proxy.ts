import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type AdminSessionPayload = {
  uid: string;
  role: "admin";
  exp: number;
};

function getSessionSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.FIREBASE_ADMIN_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    ""
  );
}

function base64UrlToBytes(input: string) {
  try {
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function verifyAdminSession(token: string) {
  const secret = getSessionSecret();
  if (!secret || !token) return false;

  const [body, signature] = token.split(".");
  if (!body || !signature) return false;

  const bodyBytes = new TextEncoder().encode(body);
  const secretBytes = new TextEncoder().encode(secret);

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const expectedSig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, bodyBytes)
  );
  const providedSig = base64UrlToBytes(signature);
  if (!providedSig || !constantTimeEqual(expectedSig, providedSig)) {
    return false;
  }

  const payloadBytes = base64UrlToBytes(body);
  if (!payloadBytes) return false;

  let payload: AdminSessionPayload | null = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return false;
  }
  if (!payload) return false;

  if (payload.role !== "admin") return false;
  if (!payload.uid || typeof payload.uid !== "string") return false;
  if (!payload.exp || typeof payload.exp !== "number") return false;
  if (payload.exp <= Date.now()) return false;

  return true;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const normalizedPathname = pathname
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i");

  if (normalizedPathname.startsWith("/admin") && pathname !== normalizedPathname) {
    const url = request.nextUrl.clone();
    url.pathname = normalizedPathname;
    return NextResponse.redirect(url, 308);
  }

  if (normalizedPathname.startsWith("/admin")) {
    const sessionToken = request.cookies.get("admin_session")?.value || "";
    const validSession = await verifyAdminSession(sessionToken);
    if (!validSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", `${pathname}${request.nextUrl.search || ""}`);
      const response = NextResponse.redirect(url);
      response.cookies.set({
        name: "admin_session",
        value: "",
        maxAge: 0,
        path: "/admin",
      });
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api).*)"],
};
