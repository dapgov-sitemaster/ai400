import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ai402_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const PASSWORD_HASH_PATTERN =
  /^scrypt:32768:8:1:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{86})$/;

export type AdminCredentials = {
  email: string;
  passwordHash: string;
  salt: Buffer;
  passwordDigest: Buffer;
};

function sessionSecret(): string {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("APP_SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

export function adminCredentials(): AdminCredentials {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const match = passwordHash?.match(PASSWORD_HASH_PATTERN);

  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !passwordHash ||
    !match
  ) {
    throw new Error(
      "Configure ADMIN_EMAIL and ADMIN_PASSWORD_HASH with pnpm setup:admin.",
    );
  }

  return {
    email,
    passwordHash,
    salt: Buffer.from(match[1], "base64url"),
    passwordDigest: Buffer.from(match[2], "base64url"),
  };
}

function signature(expires: string, credentials: AdminCredentials): string {
  return createHmac("sha256", sessionSecret())
    .update(
      `admin:${credentials.email}:${credentials.passwordHash}:${expires}`,
    )
    .digest("base64url");
}

function cookieHeader(value: string, maxAge: number): string {
  const attributes = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_ALLOW_INSECURE_ADMIN_COOKIE !== "true"
  ) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function createAdminCookie(credentials: AdminCredentials): string {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return cookieHeader(`${expires}.${signature(expires, credentials)}`, SESSION_SECONDS);
}

export function clearAdminCookie(): string {
  return cookieHeader("", 0);
}

export function hasAdminSession(
  request: Request,
  credentials: AdminCredentials,
): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  const value = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!value) return false;

  const [expiresText, suppliedSignature, ...extra] = value.split(".");
  if (
    extra.length ||
    !expiresText ||
    !suppliedSignature ||
    !/^[0-9]{1,12}$/.test(expiresText) ||
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)
  ) {
    return false;
  }

  const expires = Number(expiresText);
  if (
    !Number.isSafeInteger(expires) ||
    expires <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const expected = Buffer.from(signature(expiresText, credentials));
  const supplied = Buffer.from(suppliedSignature);
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

export function validAdminOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const requestUrl = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    requestUrl.host;
  const protocol =
    request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim() ?? requestUrl.protocol.slice(0, -1);
  return origin === `${protocol}://${host}`;
}
