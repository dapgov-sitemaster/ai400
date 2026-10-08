import { randomUUID } from "node:crypto";
import { database } from "../../../db/raw";
import { getApplicantSession, withSessionCookie } from "../../../lib/applicant-session";
import { readUpload, removeUpload, storeUpload } from "../../../lib/upload-storage";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 1_000_000;

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

function fileType(bytes: Uint8Array): string | null {
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

export async function POST(request: Request) {
  if (!validOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }
  const session = getApplicantSession(request);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_SIZE) {
    return withSessionCookie(
      Response.json({ error: "Maximum file size is 5 MB." }, { status: 413 }),
      session,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withSessionCookie(
      Response.json({ error: "Invalid document upload." }, { status: 400 }),
      session,
    );
  }

  const file = form.get("file");
  const kind = form.get("kind");
  if (
    !(file instanceof File) ||
    kind !== "endorsement" ||
    file.size === 0 ||
    file.size > MAX_FILE_SIZE
  ) {
    return withSessionCookie(
      Response.json(
        { error: "Choose a PDF, JPG or PNG up to 5 MB." },
        { status: 400 },
      ),
      session,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = fileType(bytes);
  if (!type) {
    return withSessionCookie(
      Response.json(
        { error: "Only PDF, JPG and PNG documents are supported." },
        { status: 400 },
      ),
      session,
    );
  }

  const id = randomUUID();
  const client = await database().connect();
  let stored = false;
  let committed = false;
  let oldStorageKey: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      session.owner,
    ]);

    const application = await client.query<{ status: string }>(
      "SELECT status FROM applications WHERE owner = $1 FOR UPDATE",
      [session.owner],
    );
    if (application.rows[0]?.status === "submitted") {
      await client.query("ROLLBACK");
      return withSessionCookie(
        Response.json(
          { error: "This application has already been submitted." },
          { status: 409 },
        ),
        session,
      );
    }

    const previous = await client.query<{ storage_key: string }>(
      "SELECT storage_key FROM uploads WHERE owner = $1 AND kind = $2 FOR UPDATE",
      [session.owner, kind],
    );
    oldStorageKey = previous.rows[0]?.storage_key ?? null;
    await storeUpload(id, bytes);
    stored = true;

    await client.query(
      `INSERT INTO uploads (id, owner, kind, name, storage_key, type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (owner, kind) DO UPDATE SET
         id = EXCLUDED.id,
         name = EXCLUDED.name,
         storage_key = EXCLUDED.storage_key,
         type = EXCLUDED.type`,
      [id, session.owner, kind, file.name.slice(0, 200), id, type],
    );
    await client.query("COMMIT");
    committed = true;

    if (oldStorageKey && oldStorageKey !== id) {
      try {
        await removeUpload(oldStorageKey);
      } catch (error) {
        console.error("Unable to remove replaced applicant document.", error);
      }
    }
    return withSessionCookie(
      Response.json({ id, kind, name: file.name.slice(0, 200) }),
      session,
    );
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
      if (stored) await removeUpload(id);
    }
    console.error("Unable to store applicant document.", error);
    return withSessionCookie(
      Response.json({ error: "Upload failed. Please retry." }, { status: 503 }),
      session,
    );
  } finally {
    client.release();
  }
}

export async function GET(request: Request) {
  const session = getApplicantSession(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return withSessionCookie(new Response("Not found", { status: 404 }), session);
  }

  try {
    const result = await database().query<{
      storage_key: string;
      name: string;
      type: string;
    }>(
      "SELECT storage_key, name, type FROM uploads WHERE id = $1 AND owner = $2",
      [id, session.owner],
    );
    const upload = result.rows[0];
    if (!upload) {
      return withSessionCookie(
        new Response("Not found", { status: 404 }),
        session,
      );
    }

    const bytes = await readUpload(upload.storage_key);
    return withSessionCookie(
      new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": upload.type,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition":
            `attachment; filename*=UTF-8''${encodeURIComponent(upload.name)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      }),
      session,
    );
  } catch (error) {
    console.error("Unable to retrieve applicant document.", error);
    return withSessionCookie(
      new Response("Document unavailable", { status: 503 }),
      session,
    );
  }
}
