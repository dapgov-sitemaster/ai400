import { createHmac, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { database } from "../../../../db/raw";
import {
  adminCredentials,
  createAdminCookie,
  validAdminOrigin,
} from "../../../../lib/admin-auth";

const MAX_LOGIN_ATTEMPTS = 5;

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

function loginBucket(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const address =
    forwardedFor?.split(",").at(-1)?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return createHmac("sha256", process.env.APP_SESSION_SECRET!)
    .update(`admin-login:${address}`)
    .digest("hex");
}

async function recordFailedAttempt(
  bucket: string,
): Promise<{ failures: number; lockedUntil: Date | null }> {
  const result = await database().query<{
    failures: number;
    locked_until: Date | null;
  }>(
    `INSERT INTO admin_login_attempts (key, window_started, failures)
     VALUES ($1, NOW(), 1)
     ON CONFLICT (key) DO UPDATE SET
       window_started = CASE
         WHEN admin_login_attempts.window_started <= NOW() - INTERVAL '1 minute'
           THEN NOW()
         ELSE admin_login_attempts.window_started
       END,
       failures = CASE
         WHEN admin_login_attempts.window_started <= NOW() - INTERVAL '1 minute'
           THEN 1
         ELSE admin_login_attempts.failures + 1
       END,
       locked_until = CASE
         WHEN admin_login_attempts.window_started <= NOW() - INTERVAL '1 minute'
           THEN NULL
         WHEN admin_login_attempts.failures + 1 >= ${MAX_LOGIN_ATTEMPTS}
           THEN NOW() + INTERVAL '1 minute'
         ELSE admin_login_attempts.locked_until
       END
     RETURNING failures, locked_until`,
    [bucket],
  );
  return {
    failures: result.rows[0].failures,
    lockedUntil: result.rows[0].locked_until,
  };
}

function lockedResponse(lockedUntil: Date): Response {
  const retryAfter = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
  );
  return Response.json(
    {
      error:
        "Too many failed sign-in attempts. Access from this network is locked for one minute.",
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

export async function POST(request: Request) {
  if (!validAdminOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) {
    return Response.json({ error: "Invalid login request." }, { status: 413 });
  }

  let credentials;
  let submitted: { email?: unknown; password?: unknown };
  try {
    credentials = adminCredentials();
    const raw = await request.text();
    if (raw.length > 4096) {
      return Response.json({ error: "Invalid login request." }, { status: 413 });
    }
    submitted = JSON.parse(raw);
    if (
      !submitted ||
      typeof submitted !== "object" ||
      Array.isArray(submitted)
    ) {
      return Response.json(
        { error: "Invalid login request." },
        { status: 400 },
      );
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Invalid login request." }, { status: 400 });
    }
    console.error("Admin login is not configured correctly.", error);
    return Response.json(
      { error: "Admin login is not configured. Contact the site operator." },
      { status: 503 },
    );
  }

  const email =
    typeof submitted.email === "string"
      ? submitted.email.trim().toLowerCase()
      : "";
  const password =
    typeof submitted.password === "string" ? submitted.password : "";

  try {
    const bucket = loginBucket(request);
    const existing = await database().query<{ locked_until: Date | null }>(
      "SELECT locked_until FROM admin_login_attempts WHERE key = $1",
      [bucket],
    );
    if (
      existing.rows[0]?.locked_until &&
      existing.rows[0].locked_until.getTime() > Date.now()
    ) {
      return lockedResponse(existing.rows[0].locked_until);
    }

    let passwordMatches = false;
    if (email.length <= 254 && password.length > 0 && password.length <= 128) {
      const suppliedDigest = await derivePassword(password, credentials.salt);
      passwordMatches =
        suppliedDigest.length === credentials.passwordDigest.length &&
        timingSafeEqual(suppliedDigest, credentials.passwordDigest);
    }
    if (email !== credentials.email || !passwordMatches) {
      const attempt = await recordFailedAttempt(bucket);
      if (
        attempt.lockedUntil &&
        attempt.lockedUntil.getTime() > Date.now() &&
        attempt.failures >= MAX_LOGIN_ATTEMPTS
      ) {
        return lockedResponse(attempt.lockedUntil);
      }
      return Response.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    }

    await database().query("DELETE FROM admin_login_attempts WHERE key = $1", [
      bucket,
    ]);
    const response = Response.json({ authenticated: true });
    response.headers.append("Set-Cookie", createAdminCookie(credentials));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Unable to authenticate admin account.", error);
    return Response.json(
      { error: "Admin login is temporarily unavailable." },
      { status: 503 },
    );
  }
}
