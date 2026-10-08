import { clearAdminCookie, validAdminOrigin } from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  if (!validAdminOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }

  const response = Response.json({ authenticated: false });
  response.headers.append("Set-Cookie", clearAdminCookie());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
