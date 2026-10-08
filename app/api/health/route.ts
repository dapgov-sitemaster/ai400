import { database } from "../../../db/raw";

export async function GET() {
  try {
    await database().query("SELECT 1");
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("Health check could not reach PostgreSQL.", error);
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
