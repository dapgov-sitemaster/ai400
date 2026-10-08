import { database } from "../../../../db/raw";
import { adminCredentials, hasAdminSession } from "../../../../lib/admin-auth";
import { removeUpload } from "../../../../lib/upload-storage";

const PAGE_SIZE = 25;
const MAX_PAGE = 100_000;

type ApplicationRow = {
  data: Record<string, unknown>;
  enrollment_status: "not_enrolled" | "enrolled";
  reference: string | null;
  submitted: Date;
  uploads: { id: string; kind: string; name: string; type: string }[];
};

function isSameOrigin(request: Request): boolean {
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

export async function GET(request: Request) {
  try {
    const credentials = adminCredentials();
    if (!hasAdminSession(request, credentials)) {
      return Response.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const url = new URL(request.url);
    const requestedPage = Number(url.searchParams.get("page") ?? "1");
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (
      !Number.isSafeInteger(requestedPage) ||
      requestedPage < 1 ||
      requestedPage > MAX_PAGE
    ) {
      return Response.json(
        { error: "Invalid page number." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const values: unknown[] = [];
    let where = "a.status = 'submitted'";
    if (query) {
      values.push(query);
      where += ` AND (
        strpos(lower(coalesce(a.reference, '')), lower($1)) > 0 OR
        strpos(lower(coalesce(a.data->>'name', '')), lower($1)) > 0 OR
        strpos(lower(coalesce(a.data->>'email', '')), lower($1)) > 0 OR
        strpos(lower(coalesce(a.data->>'agency', '')), lower($1)) > 0
      )`;
    }

    const count = await database().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM applications a WHERE ${where}`,
      values,
    );

    values.push(PAGE_SIZE, (requestedPage - 1) * PAGE_SIZE);
    const limitPosition = values.length - 1;
    const offsetPosition = values.length;
    const result = await database().query<ApplicationRow>(
      `SELECT
         a.data,
         a.enrollment_status,
         a.reference,
         a.submitted,
         COALESCE(
           json_agg(json_build_object(
             'id', u.id,
             'kind', u.kind,
             'name', u.name,
             'type', u.type
           )) FILTER (WHERE u.id IS NOT NULL),
           '[]'::json
         ) AS uploads
       FROM applications a
       LEFT JOIN uploads u ON u.owner = a.owner
       WHERE ${where}
       GROUP BY a.owner
       ORDER BY a.submitted DESC, a.owner
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      values,
    );

    return Response.json(
      {
        applications: result.rows.map((row) => ({
          data: row.data,
          enrollmentStatus: row.enrollment_status,
          reference: row.reference,
          submitted: row.submitted.toISOString(),
          uploads: row.uploads,
        })),
        total: Number(count.rows[0]?.total ?? "0"),
        page: requestedPage,
        pageSize: PAGE_SIZE,
        adminEmail: credentials.email,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load the admin application dashboard.", error);
    return Response.json(
      { error: "Admin dashboard is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }

  try {
    if (!hasAdminSession(request, adminCredentials())) {
      return Response.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 1024) {
      return Response.json({ error: "Invalid status update." }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > 1024) {
      return Response.json({ error: "Invalid status update." }, { status: 413 });
    }

    let body: { reference?: unknown; enrollmentStatus?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid status update." }, { status: 400 });
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      typeof body.reference !== "string" ||
      !/^AI402-[0-9A-F]{8}$/.test(body.reference) ||
      (body.enrollmentStatus !== "enrolled" &&
        body.enrollmentStatus !== "not_enrolled")
    ) {
      return Response.json({ error: "Invalid enrollment status." }, { status: 400 });
    }

    const result = await database().query<{
      enrollment_status: "not_enrolled" | "enrolled";
    }>(
      `UPDATE applications
       SET enrollment_status = $2
       WHERE reference = $1 AND status = 'submitted'
       RETURNING enrollment_status`,
      [body.reference, body.enrollmentStatus],
    );
    if (!result.rowCount) {
      return Response.json(
        { error: "Submitted application not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        reference: body.reference,
        enrollmentStatus: result.rows[0].enrollment_status,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to update application enrollment status.", error);
    return Response.json(
      { error: "Unable to update enrollment status. Please retry." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }

  try {
    if (!hasAdminSession(request, adminCredentials())) {
      return Response.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 1024) {
      return Response.json({ error: "Invalid application deletion." }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > 1024) {
      return Response.json({ error: "Invalid application deletion." }, { status: 413 });
    }

    let body: { reference?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid application deletion." }, { status: 400 });
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.reference !== "string" ||
      !/^AI402-[0-9A-F]{8}$/.test(body.reference)
    ) {
      return Response.json({ error: "Invalid application reference." }, { status: 400 });
    }

    const client = await database().connect();
    let storageKeys: string[];
    try {
      await client.query("BEGIN");
      const application = await client.query<{ owner: string }>(
        "SELECT owner FROM applications WHERE reference = $1 AND status = 'submitted' FOR UPDATE",
        [body.reference],
      );
      if (!application.rowCount) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "Submitted application not found." },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }

      const owner = application.rows[0].owner;
      storageKeys = (
        await client.query<{ storage_key: string }>(
          "SELECT storage_key FROM uploads WHERE owner = $1",
          [owner],
        )
      ).rows.map((row) => row.storage_key);
      await client.query("DELETE FROM uploads WHERE owner = $1", [owner]);
      const deleted = await client.query(
        "DELETE FROM applications WHERE owner = $1 AND reference = $2 AND status = 'submitted'",
        [owner, body.reference],
      );
      if (deleted.rowCount !== 1) {
        throw new Error("Application changed while deletion was in progress.");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const failedCleanup: string[] = [];
    for (const storageKey of storageKeys) {
      try {
        await removeUpload(storageKey);
      } catch (error) {
        console.error("Unable to remove an uploaded file for a deleted application.", error);
        failedCleanup.push(storageKey);
      }
    }
    if (failedCleanup.length) {
      return Response.json(
        {
          deleted: true,
          warning:
            "The application was deleted, but one or more stored files could not be removed. Contact the system administrator.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { deleted: true, reference: body.reference },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to delete admin application.", error);
    return Response.json(
      { error: "Unable to delete this application. Please retry." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
