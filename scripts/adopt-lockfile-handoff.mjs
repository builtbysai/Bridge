import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HANDOFF_SCHEMA_VERSION, REVIEWED_NODE_VERSION, REVIEWED_NPM_VERSION } from './lockfile-handoff-manifest.mjs';

const SOURCE_FILES = ['package.json', 'server/package.json'];
const LOCKFILES = ['package-lock.json', 'server/package-lock.json'];
const EXACT_MANIFEST_FILES = [...SOURCE_FILES, ...LOCKFILES].sort();

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function digest(relativePath, rootDir) {
  const content = await readFile(path.join(rootDir, relativePath));
  return { content, sha256: sha256(content), bytes: content.byteLength };
}

function assertRecordedFile(recorded, actual, relativePath) {
  if (!recorded || recorded.sha256 !== actual.sha256 || recorded.bytes !== actual.bytes) {
    throw new Error(`Lockfile handoff manifest mismatch for ${relativePath}.`);
  }
}

function assertMetadata(manifest, { commit, ref }) {
  if (manifest?.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
    throw new Error(`Unsupported lockfile handoff manifest schema: ${manifest?.schemaVersion ?? 'missing'}.`);
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest?.source?.commit ?? '')) {
    throw new Error('Lockfile handoff manifest source commit must be a full 40-character Git SHA.');
  }
  if (typeof manifest?.source?.ref !== 'string' || manifest.source.ref.trim().length === 0 || /[\r\n]/.test(manifest.source.ref)) {
    throw new Error('Lockfile handoff manifest source ref must be a non-empty single-line value.');
  }
  if (manifest.source.commit !== commit.toLowerCase()) {
    throw new Error(`Lockfile handoff manifest commit mismatch: expected ${commit.toLowerCase()}, got ${manifest.source.commit}.`);
  }
  if (manifest.source.ref !== ref) {
    throw new Error(`Lockfile handoff manifest ref mismatch: expected ${ref}, got ${manifest.source.ref}.`);
  }
  if (manifest?.generator?.nodeVersion !== REVIEWED_NODE_VERSION) {
    throw new Error(`Lockfile handoff must use reviewed Node ${REVIEWED_NODE_VERSION}, got ${manifest?.generator?.nodeVersion ?? 'missing'}.`);
  }
  if (manifest?.generator?.npmVersion !== REVIEWED_NPM_VERSION) {
    throw new Error(`Lockfile handoff must use reviewed npm ${REVIEWED_NPM_VERSION}, got ${manifest?.generator?.npmVersion ?? 'missing'}.`);
  }
  const recordedFiles = Object.keys(manifest.files ?? {}).sort();
  if (recordedFiles.join('\n') !== EXACT_MANIFEST_FILES.join('\n')) {
    throw new Error('Lockfile handoff manifest file set is not exact.');
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function verifyAdoptionCandidate({ sourceRoot, artifactRoot, commit, ref }) {
  const manifestPath = path.join(artifactRoot, 'lockfile-handoff-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assertMetadata(manifest, { commit, ref });

  for (const relativePath of SOURCE_FILES) {
    assertRecordedFile(manifest.files[relativePath], await digest(relativePath, sourceRoot), relativePath);
  }

  const lockfileBytes = new Map();
  for (const relativePath of LOCKFILES) {
    const actual = await digest(relativePath, artifactRoot);
    assertRecordedFile(manifest.files[relativePath], actual, relativePath);
    lockfileBytes.set(relativePath, actual.content);
  }

  return { manifest, lockfileBytes };
}

export async function adoptLockfileHandoff({ sourceRoot, artifactRoot, commit, ref }) {
  const { lockfileBytes } = await verifyAdoptionCandidate({ sourceRoot, artifactRoot, commit, ref });
  const destinations = LOCKFILES.map((relativePath) => ({
    relativePath,
    destination: path.join(sourceRoot, relativePath),
    temp: path.join(sourceRoot, `${relativePath}.adopt-${randomUUID()}.tmp`),
  }));

  const existing = [];
  for (const entry of destinations) {
    if (await pathExists(entry.destination)) existing.push(entry.relativePath);
  }
  if (existing.length > 0) {
    throw new Error(`Refusing to overwrite existing repository lockfile(s): ${existing.join(', ')}.`);
  }

  const staged = [];
  const adopted = [];
  try {
    for (const entry of destinations) {
      await writeFile(entry.temp, lockfileBytes.get(entry.relativePath), { flag: 'wx' });
      staged.push(entry.temp);
    }
    for (const entry of destinations) {
      await rename(entry.temp, entry.destination);
      staged.splice(staged.indexOf(entry.temp), 1);
      adopted.push(entry.destination);
    }
  } catch (error) {
    await Promise.all(staged.map((filePath) => unlink(filePath).catch(() => {})));
    await Promise.all(adopted.map((filePath) => unlink(filePath).catch(() => {})));
    throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid CLI argument near ${key ?? '<end>'}.`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function gitValue(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.artifact) {
    throw new Error('Usage: node scripts/adopt-lockfile-handoff.mjs --artifact DIR [--root DIR] [--commit SHA] [--ref REF]');
  }
  const sourceRoot = path.resolve(options.root ?? '.');
  const artifactRoot = path.resolve(options.artifact);
  const commit = options.commit ?? gitValue(['rev-parse', 'HEAD'], sourceRoot);
  const ref = options.ref ?? gitValue(['symbolic-ref', '-q', 'HEAD'], sourceRoot);
  await adoptLockfileHandoff({ sourceRoot, artifactRoot, commit, ref });
  console.log('Adopted verified Bridge lockfile handoff pair.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
