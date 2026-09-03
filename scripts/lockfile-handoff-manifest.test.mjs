import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REVIEWED_NODE_VERSION, REVIEWED_NPM_VERSION, writeHandoffManifest, verifyHandoffManifest } from './lockfile-handoff-manifest.mjs';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REF = 'refs/heads/project/device-bridge';

async function fixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bridge-lockfile-handoff-'));
  await mkdir(path.join(rootDir, 'server'));
  await writeFile(path.join(rootDir, 'package.json'), '{"name":"bridge"}\n');
  await writeFile(path.join(rootDir, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(path.join(rootDir, 'server/package.json'), '{"name":"server"}\n');
  await writeFile(path.join(rootDir, 'server/package-lock.json'), '{"lockfileVersion":3}\n');
  const manifestPath = path.join(rootDir, 'lockfile-handoff-manifest.json');
  await writeHandoffManifest({
    rootDir,
    outputPath: manifestPath,
    commit: COMMIT,
    ref: REF,
    nodeVersion: REVIEWED_NODE_VERSION,
    npmVersion: REVIEWED_NPM_VERSION,
  });
  return { rootDir, manifestPath };
}

test('verifies an exact handoff manifest', async () => {
  const { rootDir, manifestPath } = await fixture();
  await verifyHandoffManifest({ rootDir, manifestPath, commit: COMMIT, ref: REF });
});

test('rejects stale lockfiles or source manifests', async () => {
  const { rootDir, manifestPath } = await fixture();
  await writeFile(path.join(rootDir, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
  await assert.rejects(
    verifyHandoffManifest({ rootDir, manifestPath, commit: COMMIT, ref: REF }),
    /mismatch for package-lock\.json/,
  );
});

test('rejects a manifest from another source commit', async () => {
  const { rootDir, manifestPath } = await fixture();
  await assert.rejects(
    verifyHandoffManifest({ rootDir, manifestPath, commit: 'fedcba9876543210fedcba9876543210fedcba98', ref: REF }),
    /commit mismatch/,
  );
});

test('rejects lockfile handoff evidence from another Node 22 release', async () => {
  const { rootDir, manifestPath } = await fixture();
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  parsed.generator.nodeVersion = 'v22.22.0';
  await writeFile(manifestPath, JSON.stringify(parsed));
  await assert.rejects(
    verifyHandoffManifest({ rootDir, manifestPath, commit: COMMIT, ref: REF }),
    /reviewed Node v22\.23\.2/,
  );
});

test('rejects non-Node-22 generator evidence', async () => {
  const { rootDir, manifestPath } = await fixture();
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  parsed.generator.nodeVersion = 'v23.0.0';
  await writeFile(manifestPath, JSON.stringify(parsed));
  await assert.rejects(
    verifyHandoffManifest({ rootDir, manifestPath, commit: COMMIT, ref: REF }),
    /reviewed Node v22\.23\.2/,
  );
});

test('rejects lockfile handoff evidence from an unreviewed npm version', async () => {
  const { rootDir, manifestPath } = await fixture();
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  parsed.generator.npmVersion = '10.9.7';
  await writeFile(manifestPath, JSON.stringify(parsed));
  await assert.rejects(
    verifyHandoffManifest({ rootDir, manifestPath, commit: COMMIT, ref: REF }),
    /reviewed npm 10\.9\.8/,
  );
});
