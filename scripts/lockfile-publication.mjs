import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

function cleanup(paths) {
  for (const path of paths) {
    rmSync(path, { force: true });
  }
}

function requireRegularFile(path, label, { allowMissing = false } = {}) {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) {
      throw new TypeError(`${label} must be a regular file: ${path}`);
    }
    return stats;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw error;
  }
}

function readRegularFileNoFollow(path, label) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      throw new TypeError(`${label} must be a regular file: ${path}`);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}

function writeExclusive(path, content) {
  writeFileSync(path, content, { flag: "wx", mode: 0o644 });
}

function requireDistinctPublicationPaths(entries) {
  const paths = entries.flatMap(({ stagedPath, destinationPath }) => [stagedPath, destinationPath]);
  const resolvedPaths = paths.map((path) => resolve(path));
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    throw new TypeError(
      "Bridge lockfile publication requires two distinct staged paths and two distinct destination paths with no staged/destination overlap.",
    );
  }
}

function requireDistinctExistingFileIdentities(publications) {
  const identities = new Map();
  for (const publication of publications) {
    for (const candidate of [
      { path: publication.stagedPath, stats: publication.stagedStats, label: publication.stagedLabel },
      { path: publication.destinationPath, stats: publication.destinationStats, label: publication.destinationLabel },
    ]) {
      if (!candidate.stats) continue;
      const identity = `${candidate.stats.dev}:${candidate.stats.ino}`;
      const previous = identities.get(identity);
      if (previous) {
        throw new TypeError(
          `Bridge lockfile publication paths must not be hard-link aliases: ${previous.label} (${previous.path}) and ${candidate.label} (${candidate.path}) reference the same file.`,
        );
      }
      identities.set(identity, candidate);
    }
  }
}

export function publishLockfilePair(entries) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw new TypeError("Bridge lockfile publication requires exactly two lockfiles.");
  }

  const stagedStats = [];
  for (const [index, entry] of entries.entries()) {
    if (
      !entry
      || typeof entry.stagedPath !== "string"
      || typeof entry.destinationPath !== "string"
      || typeof entry.expectedSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(entry.expectedSha256)
    ) {
      throw new TypeError(
        `Bridge lockfile publication entry ${index + 1} requires stagedPath, destinationPath, and a lowercase 64-character expectedSha256.`,
      );
    }
    stagedStats.push(requireRegularFile(entry.stagedPath, `Staged lockfile ${index + 1}`));
  }

  requireDistinctPublicationPaths(entries);

  const publicationId = randomUUID();
  const publications = entries.map(({ stagedPath, destinationPath, expectedSha256 }, index) => {
    const destinationLabel = `Destination lockfile ${index + 1}`;
    const destinationStats = requireRegularFile(destinationPath, destinationLabel, { allowMissing: true });
    return {
      stagedPath,
      destinationPath,
      expectedSha256,
      stagedStats: stagedStats[index],
      destinationStats,
      stagedLabel: `Staged lockfile ${index + 1}`,
      destinationLabel,
      existed: destinationStats !== null,
      backupPath: `${destinationPath}.bridge-backup-${publicationId}-${index}`,
      preparedPath: `${destinationPath}.bridge-publish-${publicationId}-${index}`,
    };
  });
  requireDistinctExistingFileIdentities(publications);

  const transientPaths = publications.flatMap(({ backupPath, preparedPath }) => [backupPath, preparedPath]);

  try {
    for (const [index, publication] of publications.entries()) {
      if (publication.existed) {
        const currentDestination = readRegularFileNoFollow(
          publication.destinationPath,
          `Destination lockfile ${index + 1}`,
        );
        writeExclusive(publication.backupPath, currentDestination);
      }

      const stagedContent = readRegularFileNoFollow(
        publication.stagedPath,
        `Staged lockfile ${index + 1}`,
      );
      const stagedSha256 = sha256Hex(stagedContent);
      if (stagedSha256 !== publication.expectedSha256) {
        throw new Error(
          `Staged lockfile ${index + 1} changed after policy validation; expected sha256 ${publication.expectedSha256}, got ${stagedSha256}.`,
        );
      }
      writeExclusive(publication.preparedPath, stagedContent);
    }
  } catch (error) {
    cleanup(transientPaths);
    throw error;
  }

  try {
    for (const publication of publications) {
      renameSync(publication.preparedPath, publication.destinationPath);
    }
  } catch (publicationError) {
    const rollbackErrors = [];
    for (const publication of publications) {
      try {
        if (publication.existed) {
          renameSync(publication.backupPath, publication.destinationPath);
        } else {
          rmSync(publication.destinationPath, { force: true });
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    cleanup(transientPaths);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [publicationError, ...rollbackErrors],
        "Bridge lockfile publication failed and rollback was incomplete.",
      );
    }
    throw publicationError;
  }

  cleanup(transientPaths);
}
