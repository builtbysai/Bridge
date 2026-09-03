import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HANDOFF_MANIFEST_NAME = 'lockfile-handoff-manifest.json';
export const HANDOFF_SCHEMA_VERSION = 1;
export const REVIEWED_NODE_VERSION = 'v22.23.2';
export const REVIEWED_NPM_VERSION = '10.9.8';

const REQUIRED_FILES = [
  'package.json',
  'package-lock.json',
  'server/package.json',
  'server/package-lock.json',
];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function assertCommit(commit) {
  if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) {
    throw new Error('Source commit must be a full 40-character Git SHA.');
  }
}

function assertRef(ref) {
  if (typeof ref !== 'string' || ref.trim().length === 0 || /[\r\n]/.test(ref)) {
    throw new Error('Source ref must be a non-empty single-line value.');
  }
}

function assertNodeVersion(nodeVersion) {
  if (nodeVersion !== REVIEWED_NODE_VERSION) {
    throw new Error(`Lockfile handoff must use reviewed Node ${REVIEWED_NODE_VERSION}, got ${nodeVersion ?? 'missing'}.`);
  }
}

function assertNpmVersion(npmVersion) {
  if (npmVersion !== REVIEWED_NPM_VERSION) {
    throw new Error(`Lockfile handoff must use reviewed npm ${REVIEWED_NPM_VERSION}, got ${npmVersion ?? 'missing'}.`);
  }
}

function currentNpmVersion() {
  return execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
}

async function digestFiles(rootDir) {
  const files = {};
  for (const relativePath of REQUIRED_FILES) {
    const content = await readFile(path.join(rootDir, relativePath));
    files[relativePath] = {
      sha256: sha256(content),
      bytes: content.byteLength,
    };
  }
  return files;
}

export async function createHandoffManifest({ rootDir, commit, ref, nodeVersion = process.version, npmVersion = currentNpmVersion() }) {
  assertCommit(commit);
  assertRef(ref);
  assertNodeVersion(nodeVersion);
  assertNpmVersion(npmVersion);
  return {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    source: {
      commit: commit.toLowerCase(),
      ref,
    },
    generator: {
      nodeVersion,
      npmVersion,
    },
    files: await digestFiles(rootDir),
  };
}

export async function writeHandoffManifest({ rootDir, outputPath, commit, ref, nodeVersion = process.version, npmVersion = currentNpmVersion() }) {
  const manifest = await createHandoffManifest({ rootDir, commit, ref, nodeVersion, npmVersion });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export async function verifyHandoffManifest({ rootDir, manifestPath, commit, ref }) {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (parsed?.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
    throw new Error(`Unsupported lockfile handoff manifest schema: ${parsed?.schemaVersion ?? 'missing'}.`);
  }
  assertCommit(parsed?.source?.commit);
  assertRef(parsed?.source?.ref);
  if (commit !== undefined && parsed.source.commit !== commit.toLowerCase()) {
    throw new Error(`Lockfile handoff manifest commit mismatch: expected ${commit.toLowerCase()}, got ${parsed.source.commit}.`);
  }
  if (ref !== undefined && parsed.source.ref !== ref) {
    throw new Error(`Lockfile handoff manifest ref mismatch: expected ${ref}, got ${parsed.source.ref}.`);
  }
  assertNodeVersion(parsed?.generator?.nodeVersion);
  assertNpmVersion(parsed?.generator?.npmVersion);

  const actualFiles = await digestFiles(rootDir);
  for (const relativePath of REQUIRED_FILES) {
    const recorded = parsed?.files?.[relativePath];
    const actual = actualFiles[relativePath];
    if (!recorded || recorded.sha256 !== actual.sha256 || recorded.bytes !== actual.bytes) {
      throw new Error(`Lockfile handoff manifest mismatch for ${relativePath}.`);
    }
  }
  if (Object.keys(parsed.files ?? {}).sort().join('\n') !== [...REQUIRED_FILES].sort().join('\n')) {
    throw new Error('Lockfile handoff manifest file set is not exact.');
  }
  return parsed;
}

function parseCli(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid CLI argument near ${key ?? '<end>'}.`);
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));
  const rootDir = path.resolve(options.root ?? '.');
  const manifestPath = path.resolve(options.manifest ?? path.join(rootDir, HANDOFF_MANIFEST_NAME));
  const commit = options.commit ?? process.env.GITHUB_SHA;
  const ref = options.ref ?? process.env.GITHUB_REF;

  if (command === 'generate') {
    await writeHandoffManifest({ rootDir, outputPath: manifestPath, commit, ref });
    console.log(`Wrote ${manifestPath}`);
    return;
  }
  if (command === 'verify') {
    await verifyHandoffManifest({ rootDir, manifestPath, commit, ref });
    console.log(`Verified ${manifestPath}`);
    return;
  }
  throw new Error('Usage: node scripts/lockfile-handoff-manifest.mjs <generate|verify> [--root DIR] [--manifest FILE] [--commit SHA] [--ref REF]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
