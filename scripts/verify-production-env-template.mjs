import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_LINES = [
  "NODE_ENV=production",
  "BRIDGE_FRONTEND_ORIGIN=https://<frontend-host>",
  "VITE_SIGNALING_URL=wss://<signaling-host>/signal",
  "SIGNAL_ALLOWED_ORIGINS=https://<frontend-host>",
  "SIGNAL_TURN_URLS=turns:<turn-host>:5349?transport=tcp,turn:<turn-host>:3478?transport=udp",
  "SIGNAL_TURN_CREDENTIAL_TTL_SECONDS=900",
];

const REQUIRED_SECRET_PLACEHOLDERS = new Map([
  ["SIGNAL_TURN_SHARED_SECRET", "<store-in-server-secret-manager>"],
]);

const FORBIDDEN_ASSIGNMENTS = [
  /^VITE_BRIDGE_TURN_USERNAME=/m,
  /^VITE_BRIDGE_TURN_CREDENTIAL=/m,
  /^BRIDGE_TURN_CREDENTIAL_EXPOSURE=/m,
];

export const verifyProductionEnvTemplate = (text) => {
  for (const line of REQUIRED_LINES) {
    if (!text.includes(line)) throw new Error(`production environment template is missing required line: ${line}`);
  }

  for (const pattern of FORBIDDEN_ASSIGNMENTS) {
    if (pattern.test(text)) {
      throw new Error("production environment template must not enable browser-visible TURN credentials");
    }
  }

  const assignments = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [name, ...rest] = line.split("=");
    assignments.set(name.trim(), rest.join("=").trim());
  }

  for (const [name, placeholder] of REQUIRED_SECRET_PLACEHOLDERS) {
    const value = assignments.get(name);
    if (value === undefined) throw new Error(`production environment template is missing required secret placeholder: ${name}`);
    if (value !== placeholder) {
      throw new Error(`${name} must remain a placeholder in the committed production environment template`);
    }
  }

  for (const [name, value] of assignments) {
    if (/SECRET|TOKEN|CREDENTIAL/.test(name) && value && !value.startsWith("<") && name !== "SIGNAL_TURN_CREDENTIAL_TTL_SECONDS") {
      throw new Error(`${name} must remain a placeholder in the committed production environment template`);
    }
  }

  return true;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const templatePath = path.resolve(process.cwd(), "config/production.env.example");
    verifyProductionEnvTemplate(fs.readFileSync(templatePath, "utf8"));
    console.log("Production environment template is safe and complete.");
  } catch (error) {
    console.error(`Production environment template check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
