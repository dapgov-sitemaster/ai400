import { database } from "../../../../db/raw";
import {
  adminCredentials,
  hasAdminSession,
  validAdminOrigin,
} from "../../../../lib/admin-auth";

type LockoutRow = {
  key: string;
  failures: number;
  window_started: Date;
  locked_until: Date;
};

function isAdmin(request: Request): boolean {
  return hasAdminSession(request, adminCredentials());
}

export async function GET(request: Request) {
  try {
    if (!isAdmin(request)) {
      return Response.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = await database().query<LockoutRow>(
      `SELECT key, failures, window_started, locked_until
       FROM admin_login_attempts
       WHERE locked_until > NOW()
       ORDER BY locked_until`,
    );

    return Response.json(
      {
        lockouts: result.rows.map((row) => ({
          id: row.key.slice(0, 12),
          key: row.key,
          failures: row.failures,
          lastAttempt: row.window_started.toISOString(),
          lockedUntil: row.locked_until.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to list admin login lockouts.", error);
    return Response.json(
      { error: "Unable to load blocked sign-ins." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!validAdminOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }

  try {
    if (!isAdmin(request)) {
      return Response.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 256) {
      return Response.json({ error: "Invalid unlock request." }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > 256) {
      return Response.json({ error: "Invalid unlock request." }, { status: 413 });
    }

    let body: { key?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid unlock request." }, { status: 400 });
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.key !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.key)
    ) {
      return Response.json({ error: "Invalid lockout identifier." }, { status: 400 });
    }

    const result = await database().query(
      `DELETE FROM admin_login_attempts
       WHERE key = $1 AND locked_until > NOW()
       RETURNING key`,
      [body.key],
    );

    if (!result.rowCount) {
      return Response.json(
        { error: "This lockout has expired or was already released." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { released: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to release admin login lockout.", error);
    return Response.json(
      { error: "Unable to release the sign-in lockout." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
