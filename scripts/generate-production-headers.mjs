import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const GENERIC_WSS_TOKEN = /(^|\s)wss:(?=\s|;|$)/g;

const parseSignalingOrigin = raw => {
  if (!raw?.trim()) throw new Error("VITE_SIGNALING_URL is required to generate production headers");
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("VITE_SIGNALING_URL must be an absolute URL");
  }
  if (url.protocol !== "wss:") throw new Error("VITE_SIGNALING_URL must use wss: in production");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/signal") {
    throw new Error("VITE_SIGNALING_URL must be an exact wss://host/signal URL with no credentials, query, or fragment");
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) throw new Error("VITE_SIGNALING_URL must not use a loopback hostname in production");
  return `wss://${url.host}`;
};

export const generateProductionHeaders = ({ headersText, signalingUrl }) => {
  const signalingOrigin = parseSignalingOrigin(signalingUrl);
  const lines = headersText.split(/\r?\n/);
  const cspIndexes = lines
    .map((line, index) => (/^\s*Content-Security-Policy:/i.test(line) ? index : -1))
    .filter(index => index >= 0);

  if (cspIndexes.length !== 1) {
    throw new Error(`Expected exactly one Content-Security-Policy header, found ${cspIndexes.length}`);
  }

  const index = cspIndexes[0];
  const cspLine = lines[index];
  const connectMatch = cspLine.match(/connect-src\s+([^;]+);/i);
  if (!connectMatch) throw new Error("Content-Security-Policy must define connect-src");

  const genericMatches = connectMatch[1].match(GENERIC_WSS_TOKEN) ?? [];
  if (genericMatches.length !== 1) {
    throw new Error(`Baseline connect-src must contain exactly one generic wss: token, found ${genericMatches.length}`);
  }

  const narrowedConnect = connectMatch[1].replace(GENERIC_WSS_TOKEN, (match, prefix) => `${prefix}${signalingOrigin}`);
  lines[index] = cspLine.replace(connectMatch[0], `connect-src ${narrowedConnect};`);

  const output = lines.join("\n");
  const outputCsp = lines[index];
  if (!outputCsp.includes(signalingOrigin)) throw new Error("Generated CSP is missing the exact signaling origin");
  if (/(^|\s)wss:(?=\s|;|$)/i.test(outputCsp)) throw new Error("Generated CSP still contains a generic wss: allowance");
  return output;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const sourcePath = path.resolve(process.cwd(), process.argv[2] ?? "dist/_headers");
    const destinationPath = path.resolve(process.cwd(), process.argv[3] ?? sourcePath);
    const output = generateProductionHeaders({
      headersText: fs.readFileSync(sourcePath, "utf8"),
      signalingUrl: process.env.VITE_SIGNALING_URL,
    });
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, output, "utf8");
    console.log(`Production CSP narrowed in ${path.relative(process.cwd(), destinationPath) || destinationPath}.`);
  } catch (error) {
    console.error(`Production header generation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
