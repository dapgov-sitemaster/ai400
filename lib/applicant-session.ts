import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ai402_applicant";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ApplicantSession = {
  owner: string;
  setCookie?: string;
};

function signingSecret(): string {
  const secret = process.env.APP_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SESSION_SECRET must contain at least 32 characters.");
  }
  return "local-development-session-secret-do-not-use-in-production";
}

function signature(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

function cookieHeader(value: string): string {
  const attributes = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_SECONDS}`,
  ];
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_ALLOW_INSECURE_ADMIN_COOKIE !== "true"
  ) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function readOwner(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  const value = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!value) return null;

  const [owner, expiresText, suppliedSignature, ...extra] = value.split(".");
  if (
    extra.length ||
    !owner ||
    !UUID_PATTERN.test(owner) ||
    !expiresText ||
    !suppliedSignature ||
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)
  ) {
    return null;
  }

  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const signedValue = `${owner}.${expiresText}`;
  const expectedSignature = Buffer.from(signature(signedValue));
  const actualSignature = Buffer.from(suppliedSignature);
  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return null;
  }

  return owner;
}

export function getApplicantSession(request: Request): ApplicantSession {
  const existingOwner = readOwner(request);
  if (existingOwner) return { owner: existingOwner };

  return createApplicantSession();
}

export function createApplicantSession(): ApplicantSession {
  const owner = randomUUID();
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const signedValue = `${owner}.${expires}`;
  return {
    owner,
    setCookie: cookieHeader(`${signedValue}.${signature(signedValue)}`),
  };
}

export function withSessionCookie(
  response: Response,
  session: ApplicantSession,
): Response {
  if (session.setCookie) response.headers.append("Set-Cookie", session.setCookie);
  return response;
}
