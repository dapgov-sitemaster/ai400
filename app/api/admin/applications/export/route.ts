import { database } from "../../../../../db/raw";
import { createApplicationsCsv } from "../../../../../lib/application-csv";
import { adminCredentials, hasAdminSession } from "../../../../../lib/admin-auth";

type ExportRow = {
  data: Record<string, unknown>;
  enrollment_status: "not_enrolled" | "enrolled";
  reference: string | null;
  submitted: Date;
  uploads: { name: string }[];
};

function parseDate(value: string | null): Date | null | undefined {
  if (value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime()) || date.toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
  }) !== value) return undefined;
  return date;
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
    const fromValue = url.searchParams.get("from");
    const toValue = url.searchParams.get("to");
    const from = parseDate(fromValue);
    const to = parseDate(toValue);
    if (
      from === undefined ||
      to === undefined ||
      (from && to && from > to)
    ) {
      return Response.json(
        { error: "Enter a valid date range; the start date must not follow the end date." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const values: Date[] = [];
    let where = "a.status = 'submitted'";
    if (from) {
      values.push(from);
      where += ` AND a.submitted >= $${values.length}`;
    }
    if (to) {
      values.push(new Date(to.getTime() + 24 * 60 * 60 * 1000));
      where += ` AND a.submitted < $${values.length}`;
    }

    const result = await database().query<ExportRow>(
      `SELECT
         a.data,
         a.enrollment_status,
         a.reference,
         a.submitted,
         COALESCE(
           json_agg(json_build_object('name', u.name))
             FILTER (WHERE u.id IS NOT NULL),
           '[]'::json
         ) AS uploads
       FROM applications a
       LEFT JOIN uploads u ON u.owner = a.owner
       WHERE ${where}
       GROUP BY a.owner
       ORDER BY a.submitted DESC, a.owner`,
      values,
    );
    const csv = createApplicationsCsv(
      result.rows.map((row) => ({
        data: row.data,
        enrollmentStatus: row.enrollment_status,
        reference: row.reference,
        submitted: row.submitted,
        uploads: row.uploads,
      })),
    );
    const datePart = [fromValue, toValue].filter(Boolean).join("-to-") || "all";

    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="ai402-applications-${datePart}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Unable to export admin applications.", error);
    return Response.json(
      { error: "Unable to export applications right now. Please retry." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
