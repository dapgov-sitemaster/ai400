import { database } from "../../../../db/raw";
import { adminCredentials, hasAdminSession } from "../../../../lib/admin-auth";
import { readUpload } from "../../../../lib/upload-storage";

type UploadRow = {
  name: string;
  storage_key: string;
  type: string;
};

export async function GET(request: Request) {
  try {
    const credentials = adminCredentials();
    if (!hasAdminSession(request, credentials)) {
      return Response.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const id = new URL(request.url).searchParams.get("id");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return new Response("Not found", { status: 404 });
    }

    const result = await database().query<UploadRow>(
      `SELECT u.name, u.storage_key, u.type
       FROM uploads u
       INNER JOIN applications a ON a.owner = u.owner
       WHERE u.id = $1 AND a.status = 'submitted'`,
      [id],
    );
    const upload = result.rows[0];
    if (!upload) return new Response("Not found", { status: 404 });

    const bytes = await readUpload(upload.storage_key);
    const safeName = encodeURIComponent(upload.name).replace(/['()]/g, escape);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": upload.type,
        "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Unable to load an admin application attachment.", error);
    return Response.json(
      { error: "Document download is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function escape(character: string): string {
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
}
