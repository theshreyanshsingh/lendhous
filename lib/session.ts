// Signed session cookie, ported from UPB Capital's lib/session.ts. The token carries roles for coarse routing in
// middleware; every server-side check re-reads the user and roles from the database (lib/auth.ts).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lh_session";
export const PENDING_COOKIE = "lh_2fa";
export const SESSION_DAYS = 14;

export type SessionToken = {
  sub: string;
  email: string;
  roles: string[];
  name: string;
  sid?: string;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionToken) {
  return new SignJWT({ email: payload.email, roles: payload.roles, name: payload.name, sid: payload.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function signPending(sub: string) {
  return new SignJWT({ purpose: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret());
}

export async function verifyPending(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== "2fa" || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export async function verifySession(token: string): Promise<SessionToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.email !== "string" || !Array.isArray(payload.roles)) return null;
    return {
      sub: payload.sub,
      email: payload.email,
      roles: payload.roles.filter((role): role is string => typeof role === "string"),
      name: typeof payload.name === "string" ? payload.name : "",
      sid: typeof payload.sid === "string" ? payload.sid : undefined,
    };
  } catch {
    return null;
  }
}
