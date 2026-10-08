import { randomUUID } from "node:crypto";
import { database } from "../../../db/raw";
import { getApplicantSession, withSessionCookie } from "../../../lib/applicant-session";
import { issues, normalizeApplicationData } from "../../fields";

type ApplicationRow = {
  status: string;
  reference: string | null;
  submitted: Date | null;
  updated: Date;
};

function applicationResponse(row: ApplicationRow | null) {
  if (!row) return null;
  return {
    status: row.status,
    reference: row.reference,
    submitted: row.submitted?.toISOString() ?? null,
    updated: row.updated.toISOString(),
  };
}

function validOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const requestUrl = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    requestUrl.host;
  const protocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim() ?? requestUrl.protocol.slice(0, -1);
  return origin === `${protocol}://${host}`;
}

export async function GET(request: Request) {
  const session = getApplicantSession(request);
  try {
    const db = database();
    const [application, files] = await Promise.all([
      db.query(
        "SELECT data, status, reference, submitted, updated FROM applications WHERE owner = $1",
        [session.owner],
      ),
      db.query(
        "SELECT id, kind, name FROM uploads WHERE owner = $1 ORDER BY name",
        [session.owner],
      ),
    ]);

    return withSessionCookie(
      Response.json({
        application: application.rows[0] ?? null,
        files: files.rows,
      }),
      session,
    );
  } catch (error) {
    console.error("Unable to load applicant application.", error);
    return withSessionCookie(
      Response.json(
        { error: "Your application could not be loaded. Please retry." },
        { status: 503 },
      ),
      session,
    );
  }
}

export async function POST(request: Request) {
  if (!validOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }

  const session = getApplicantSession(request);
  const raw = await request.text();
  if (raw.length > 80_000) {
    return withSessionCookie(
      Response.json({ error: "Application is too large." }, { status: 413 }),
      session,
    );
  }

  let body: { data?: unknown; submit?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return withSessionCookie(
      Response.json({ error: "Invalid application request." }, { status: 400 }),
      session,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !body.data ||
    typeof body.data !== "object" ||
    Array.isArray(body.data) ||
    (body.submit !== undefined && typeof body.submit !== "boolean")
  ) {
    return withSessionCookie(
      Response.json({ error: "Invalid application." }, { status: 400 }),
      session,
    );
  }

  const data = normalizeApplicationData(body.data);
  if (!data) {
    return withSessionCookie(
      Response.json(
        { error: "Application contains invalid or unsupported fields." },
        { status: 400 },
      ),
      session,
    );
  }

  const submit = body.submit === true;
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      session.owner,
    ]);

    const previous = await client.query<ApplicationRow>(
      "SELECT status, reference, submitted, updated FROM applications WHERE owner = $1 FOR UPDATE",
      [session.owner],
    );
    if (previous.rows[0]?.status === "submitted") {
      await client.query("COMMIT");
      return withSessionCookie(
        Response.json(applicationResponse(previous.rows[0])),
        session,
      );
    }

    if (submit) {
      const errors = issues(data);
      const attachment = data.endorsement;
      if (
        attachment === "attached" &&
        !(await client.query(
          "SELECT id FROM uploads WHERE owner = $1 AND kind = $2",
          [session.owner, "endorsement"],
        )).rowCount
      ) {
        errors.push({
          step: 4,
          message: "Upload the document marked attached.",
        });
      }
      if (errors.length) {
        await client.query("ROLLBACK");
        return withSessionCookie(
          Response.json({ error: errors[0].message, errors }, { status: 400 }),
          session,
        );
      }
    }

    const now = new Date();
    const reference = submit
      ? `AI402-${randomUUID().slice(0, 8).toUpperCase()}`
      : null;
    const result = await client.query<ApplicationRow>(
      `INSERT INTO applications (owner, data, status, reference, submitted, updated)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6)
       ON CONFLICT (owner) DO UPDATE SET
         data = EXCLUDED.data,
         status = EXCLUDED.status,
         reference = EXCLUDED.reference,
         submitted = EXCLUDED.submitted,
         updated = EXCLUDED.updated
       WHERE applications.status = 'draft'
       RETURNING status, reference, submitted, updated`,
      [
        session.owner,
        JSON.stringify(data),
        submit ? "submitted" : "draft",
        reference,
        submit ? now : null,
        now,
      ],
    );
    await client.query("COMMIT");

    return withSessionCookie(Response.json(applicationResponse(result.rows[0])), session);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Unable to save applicant application.", error);
    return withSessionCookie(
      Response.json(
        {
          error:
            "We could not save your application. Your entries are still on this page; please retry.",
        },
        { status: 503 },
      ),
      session,
    );
  } finally {
    client.release();
  }
}
