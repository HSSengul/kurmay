import { NextResponse } from "next/server";

export const runtime = "nodejs";

type LookupResponse = {
  users?: Array<{
    localId?: string;
  }>;
};

function getFieldString(fields: any, key: string): string | null {
  const v = fields?.[key];
  if (!v) return null;
  if (typeof v.stringValue === "string") return v.stringValue;
  return null;
}

export async function POST(request: Request) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";

  if (!apiKey || !projectId) {
    return NextResponse.json(
      { ok: false, error: "missing_env" },
      { status: 500 }
    );
  }

  let idToken = "";
  try {
    const body = (await request.json()) as { idToken?: string };
    idToken = String(body?.idToken || "");
  } catch {
    idToken = "";
  }

  if (!idToken) {
    return NextResponse.json(
      { ok: false, error: "missing_token" },
      { status: 400 }
    );
  }

  try {
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!lookupRes.ok) {
      return NextResponse.json(
        { ok: false, error: "invalid_token" },
        { status: 401 }
      );
    }

    const lookup = (await lookupRes.json()) as LookupResponse;
    const uid = lookup?.users?.[0]?.localId || "";
    if (!uid) {
      return NextResponse.json(
        { ok: false, error: "invalid_user" },
        { status: 401 }
      );
    }

    const userDocRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`,
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      }
    );

    if (!userDocRes.ok) {
      return NextResponse.json(
        { ok: false, error: "user_doc_denied" },
        { status: 403 }
      );
    }

    const userDoc = (await userDocRes.json()) as any;
    const role = getFieldString(userDoc?.fields, "role");

    if (role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "not_admin" },
        { status: 403 }
      );
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "admin_session",
      value: "1",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/admin",
      maxAge: 60 * 60 * 8,
    });
    return res;
  } catch {
    return NextResponse.json(
      { ok: false, error: "session_error" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: "admin_session",
    value: "",
    path: "/admin",
    maxAge: 0,
  });
  return res;
}
