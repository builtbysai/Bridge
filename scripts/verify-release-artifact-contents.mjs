import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REQUIRED = [
  "dist/index.html",
  "dist/manifest.webmanifest",
  "dist/sw.js",
  "dist/_headers",
  "dist-server/signaling.js",
  "dist-server/package.json",
  "dist-server/package-lock.json",
  "dist-server/bridge-runtime.cdx.json",
  "bridge-dependencies.cdx.json",
  "bridge-artifacts.sha256"
];

const FORBIDDEN_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  ".gitignore"
]);

const FORBIDDEN_EXTENSIONS = new Set([
  ".map",
  ".ts",
  ".tsx",
  ".pem",
  ".key",
  ".p12",
  ".pfx"
]);

const allowedTopLevel = new Set([
  "dist",
  "dist-server",
  "bridge-dependencies.cdx.json",
  "bridge-artifacts.sha256"
]);

const rootIndex = process.argv.indexOf("--root");
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] ?? "" : process.cwd());
if (rootIndex >= 0 && !process.argv[rootIndex + 1]) throw new Error("--root requires a directory");

const relative = absolute => path.relative(root, absolute).split(path.sep).join("/");

const walk = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const rel = relative(absolute);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) throw new Error(`Release artifact must not contain symlinks: ${rel}`);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(rel);
    else throw new Error(`Release artifact contains unsupported filesystem entry: ${rel}`);
  }
  return files;
};

const assertSafePath = file => {
  const segments = file.split("/");
  const basename = segments.at(-1) ?? "";
  const lower = basename.toLowerCase();
  const extension = path.extname(lower);

  if (segments.includes("node_modules")) throw new Error(`Release artifact must not contain node_modules: ${file}`);
  if (FORBIDDEN_BASENAMES.has(lower) || lower.startsWith(".env.")) throw new Error(`Release artifact contains environment/config secret material: ${file}`);
  if (FORBIDDEN_EXTENSIONS.has(extension)) throw new Error(`Release artifact contains forbidden source/secret extension ${extension}: ${file}`);
  if (/(^|[._-])(test|spec)([._-]|$)/i.test(basename)) throw new Error(`Release artifact contains test/spec material: ${file}`);
  if (segments.some(segment => ["src", "scripts", "e2e", "docs", ".git", ".github"].includes(segment))) {
    throw new Error(`Release artifact contains repository-only content: ${file}`);
  }

  if (file.startsWith("dist-server/")) {
    const allowedRuntimeMetadata = new Set([
      "dist-server/package.json",
      "dist-server/package-lock.json",
      "dist-server/bridge-runtime.cdx.json"
    ]);
    if (!allowedRuntimeMetadata.has(file) && extension !== ".js") {
      throw new Error(`Signaling runtime contains unexpected file type: ${file}`);
    }
  }
};

const existing = new Set();
for (const name of allowedTopLevel) {
  const absolute = path.join(root, name);
  let stats;
  try {
    stats = await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (stats.isSymbolicLink()) throw new Error(`Release artifact top-level entry must not be a symlink: ${name}`);
  if (stats.isDirectory()) {
    for (const file of await walk(absolute)) existing.add(file);
  } else if (stats.isFile()) {
    existing.add(name);
  }
}

for (const required of REQUIRED) {
  if (!existing.has(required)) throw new Error(`Release artifact is missing required file: ${required}`);
}

for (const file of existing) assertSafePath(file);

const packageJson = JSON.parse(await readFile(path.join(root, "dist-server/package.json"), "utf8"));
if (packageJson.private !== true) throw new Error("Packaged signaling runtime must remain private");
const scripts = packageJson.scripts ?? {};
if (JSON.stringify(scripts) !== JSON.stringify({ start: "node signaling.js" })) {
  throw new Error("Packaged signaling runtime scripts must contain only the reviewed start command");
}
if (packageJson.devDependencies && Object.keys(packageJson.devDependencies).length > 0) throw new Error("Packaged signaling runtime must not declare devDependencies");

console.log(`Bridge release artifact content policy passed (${existing.size} files checked).`);
