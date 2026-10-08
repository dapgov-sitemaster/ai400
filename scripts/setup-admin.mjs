import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const envPath = path.join(projectRoot, ".env");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }

  process.stdout.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Admin setup cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " " && character <= "~") {
          value += character;
          process.stdout.write("*");
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

const readline = createInterface({
  input: process.stdin,
  output: process.stdout,
});

try {
  const email = (await readline.question("Admin email: ")).trim().toLowerCase();
  readline.close();

  if (!emailPattern.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address (maximum 254 characters).");
  }

  const password = await readHidden("Admin password (minimum 15 characters): ");
  const confirmation = await readHidden("Confirm admin password: ");
  if (password.length < 15 || password.length > 128) {
    throw new Error("The password must contain 15 to 128 characters.");
  }
  const passwordBytes = Buffer.from(password);
  const confirmationBytes = Buffer.from(confirmation);
  if (
    passwordBytes.length !== confirmationBytes.length ||
    !timingSafeEqual(passwordBytes, confirmationBytes)
  ) {
    throw new Error("Passwords do not match.");
  }

  const salt = randomBytes(16);
  const digest = await scrypt(password, salt);
  const encodedHash = `scrypt:32768:8:1:${salt.toString("base64url")}:${digest.toString("base64url")}`;

  let envText = "";
  try {
    envText = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const values = {
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD_HASH: encodedHash,
  };
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const matcher = new RegExp(`^${key}=.*$`, "m");
    if (matcher.test(envText)) {
      envText = envText.replace(matcher, line);
    } else {
      envText += `${envText && !envText.endsWith("\n") ? "\n" : ""}${line}\n`;
    }
  }

  await writeFile(envPath, envText, { encoding: "utf8", mode: 0o600 });
  await chmod(envPath, 0o600);
  process.stdout.write(
    `Admin account configured for ${email}. Keep your password private; it is not stored in plain text.\n`,
  );
} catch (error) {
  readline.close();
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
