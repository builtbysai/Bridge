const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

const sortedEntries = (value) => Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right));

const hasCanonicalSha512Integrity = (value) => {
  if (typeof value !== "string" || !INTEGRITY_PATTERN.test(value)) return false;
  const encoded = value.slice("sha512-".length);
  const digest = Buffer.from(encoded, "base64");
  return digest.length === 64 && digest.toString("base64") === encoded;
};

const packageNameFromPath = (packagePath) => {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  if (index === -1) return null;
  const remainder = packagePath.slice(index + marker.length);
  if (remainder.startsWith("@")) {
    const [scope, name, ...extra] = remainder.split("/");
    return scope && name && extra.length === 0 ? `${scope}/${name}` : null;
  }
  return remainder && !remainder.includes("/") ? remainder : null;
};

const hasMatchingRegistryTarball = (url, packagePath, version) => {
  if (typeof version !== "string" || version.length === 0) return false;
  const packageName = packageNameFromPath(packagePath);
  if (!packageName) return false;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }

  const leafName = packageName.includes("/") ? packageName.slice(packageName.lastIndexOf("/") + 1) : packageName;
  return pathname === `/${packageName}/-/${leafName}-${version}.tgz`;
};

export function validateLockfilePolicy(lockfile, manifest, label = "Bridge") {
  const errors = [];
  const fail = (message) => errors.push(`${label} ${message}`);

  if (lockfile.lockfileVersion !== 3) fail(`package-lock.json must use npm lockfileVersion 3, found ${lockfile.lockfileVersion}.`);
  if (lockfile.name !== manifest.name || lockfile.version !== manifest.version) fail("package-lock.json root identity does not match package.json.");

  const root = lockfile.packages?.[""];
  if (!root || root.name !== manifest.name || root.version !== manifest.version) {
    fail("package-lock.json is missing the expected root package entry.");
  } else {
    for (const field of ["dependencies", "devDependencies"]) {
      if (JSON.stringify(sortedEntries(root[field])) !== JSON.stringify(sortedEntries(manifest[field]))) {
        fail(`package-lock.json root ${field} does not exactly match package.json.`);
      }
    }
  }

  for (const [packagePath, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!packagePath || !entry || typeof entry !== "object") continue;
    if (entry.link === true) fail(`package-lock.json contains a linked package at ${packagePath}.`);
    if (typeof entry.resolved !== "string") {
      fail(`package-lock.json package ${packagePath} is missing a resolved registry URL.`);
      continue;
    }

    let url;
    try {
      url = new URL(entry.resolved);
    } catch {
      fail(`package-lock.json package ${packagePath} has an invalid resolved URL.`);
      continue;
    }

    if (url.origin !== REGISTRY_ORIGIN || url.username || url.password || url.search || url.hash) {
      fail(`package-lock.json package ${packagePath} must resolve from exact origin ${REGISTRY_ORIGIN} without embedded credentials, query parameters, or fragments.`);
    } else if (!hasMatchingRegistryTarball(url, packagePath, entry.version)) {
      fail(`package-lock.json package ${packagePath} must resolve to the canonical registry tarball for its package name and version.`);
    }
    if (!hasCanonicalSha512Integrity(entry.integrity)) {
      fail(`package-lock.json package ${packagePath} must carry canonical 64-byte sha512 integrity metadata.`);
    }
  }

  return errors;
}
