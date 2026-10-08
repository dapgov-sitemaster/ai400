import { database } from "../../../../db/raw";
import {
  createApplicantSession,
  getApplicantSession,
  withSessionCookie,
} from "../../../../lib/applicant-session";

function validOrigin(request: Request): boolean {
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

export async function POST(request: Request) {
  if (!validOrigin(request)) {
    return Response.json({ error: "Invalid request." }, { status: 403 });
  }

  const currentSession = getApplicantSession(request);
  try {
    const existing = await database().query<{ status: string }>(
      "SELECT status FROM applications WHERE owner = $1",
      [currentSession.owner],
    );
    if (existing.rows[0]?.status !== "submitted") {
      return withSessionCookie(
        Response.json(
          {
            error:
              "A new application can only be started after the current application has been submitted.",
          },
          { status: 409 },
        ),
        currentSession,
      );
    }

    const nextSession = createApplicantSession();
    return withSessionCookie(
      Response.json({ started: true }),
      nextSession,
    );
  } catch (error) {
    console.error("Unable to start a new applicant session.", error);
    return withSessionCookie(
      Response.json(
        { error: "Unable to start a new application. Please retry." },
        { status: 503 },
      ),
      currentSession,
    );
  }
}
