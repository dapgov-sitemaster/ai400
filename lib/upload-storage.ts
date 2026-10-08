import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uploadDirectory(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
}

function uploadPath(storageKey: string): string {
  if (!UUID_PATTERN.test(storageKey)) {
    throw new Error("Invalid upload storage key.");
  }
  return path.join(uploadDirectory(), storageKey);
}

export async function storeUpload(
  storageKey: string,
  bytes: Uint8Array,
): Promise<void> {
  const directory = uploadDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(uploadPath(storageKey), bytes, { flag: "wx", mode: 0o600 });
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  return readFile(uploadPath(storageKey));
}

export async function removeUpload(storageKey: string): Promise<void> {
  try {
    await unlink(uploadPath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
