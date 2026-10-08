import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const production = process.env.NODE_ENV === "production";
if (production && (!process.env.APP_SESSION_SECRET || process.env.APP_SESSION_SECRET.length < 32)) {
  throw new Error("Set APP_SESSION_SECRET to a random value of at least 32 characters.");
}
if (production && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH)) {
  throw new Error("Configure ADMIN_EMAIL and ADMIN_PASSWORD_HASH with pnpm setup:admin.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to the PostgreSQL connection string.");
}

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
process.env.HOST ??= "0.0.0.0";
const uploadDirectory = path.resolve(
  process.env.UPLOAD_DIR ?? path.join(projectRoot, "data", "uploads"),
);
await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });

const migration = spawn(
  process.execPath,
  [path.join(projectRoot, "scripts", "migrate-postgres.mjs")],
  { cwd: projectRoot, stdio: "inherit", env: process.env },
);
const migrationExitCode = await new Promise((resolve, reject) => {
  migration.once("error", reject);
  migration.once("exit", (code) => resolve(code ?? 1));
});
if (migrationExitCode !== 0) {
  throw new Error(`Database migrations failed with exit code ${migrationExitCode}.`);
}

const vinext = spawn(
  process.execPath,
  [path.join(projectRoot, "dist", "standalone", "server.js")],
  { cwd: projectRoot, stdio: "inherit", env: process.env },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => vinext.kill(signal));
}

vinext.once("error", (error) => {
  console.error("Unable to start the Node.js web server.", error);
  process.exitCode = 1;
});
vinext.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
