# Lockfile publication path safety

Bridge generates the development/build and minimal signaling-runtime lockfiles in an isolated temporary workspace, validates both graphs, and only then publishes the pair into the repository.

## Repository-side publication checks

- [x] Reject staged inputs and existing destinations that are not regular files.
- [x] Require two distinct staged paths and two distinct destination paths, with no staged/destination overlap after path normalization.
- [x] Reject hard-link aliases among all existing staged inputs and destinations by comparing filesystem device/inode identity before publication.
- [x] Prepare both replacement files before either repository destination is changed.
- [x] Restore the old pair if replacement of either destination fails.
- [x] Bind publication to the SHA-256 digest of the exact bytes that passed lockfile policy validation.
- [x] Reopen staged inputs and existing destinations with descriptor-based regular-file checks and `O_NOFOLLOW` where the reviewed platform supports it.
- [x] Reject a staged lockfile whose bytes changed after policy validation and clean all transient publication files.

The publication boundary fails closed on filesystem indirection. Every staged lockfile must already exist as a regular file, and every existing repository destination must also be a regular file. Symbolic links, directories, devices, sockets, and other non-regular filesystem entries are rejected before any backup or destination write begins. In particular, a symlink at `bridge/package-lock.json` or `bridge/server/package-lock.json` must never be followed to an external target.

The pair is also structurally constrained before publication starts. After normalizing the supplied paths, all four path roles must be distinct: the two staged inputs cannot alias one another, the two repository destinations cannot alias one another, and no staged input may overlap a destination. Existing files are additionally compared by filesystem device/inode identity so distinct pathnames that are hard links to the same file fail closed. This prevents a future generator refactor from accidentally collapsing the two-lockfile transaction onto one underlying file even when lexical path checks alone would not detect it.

Policy validation is also bound to the exact staged bytes. Each lockfile is read once for JSON/policy validation and SHA-256 fingerprinting. Publication requires that fingerprint, reopens the staged file with no-follow semantics where the platform exposes `O_NOFOLLOW`, verifies the opened descriptor is still a regular file, hashes the bytes read for publication, and refuses to publish if the digest differs. This prevents a staged lockfile changed after policy validation from being silently committed as though it had passed provenance/integrity review.

Existing destination backups use the same descriptor-based regular-file read instead of a later path-following copy. After those reads, publication prepares unique sibling files before touching either repository destination. Existing lockfiles are written to UUID-scoped backup paths with exclusive-create semantics, and each validated staged lockfile is written to its own UUID-scoped publication path with the same collision-safe rule. The prepared files are then renamed over the two destination pathnames. This keeps the actual replacement operation from writing through a destination symlink that appears after preflight, and a pre-existing backup/publication pathname causes a fail-closed preparation error rather than being overwritten.

Publication retains paired rollback behavior: if either destination replacement fails, existing destinations are restored from their prepared backups and initially absent destinations are removed. Temporary backup/publication files are removed after success, after preparation failure, and after rollback. This is stronger than direct path-based copy replacement, while still remaining a filesystem-level best-effort transaction rather than a crash-consistent database transaction.

Focused dependency-free `node:test` coverage verifies normal pair publication and cleanup, missing-staged-file preflight, no partial destination creation, rejection of a symlinked staged lockfile, rejection of a symlinked destination without modifying the symlink target, rejection when staged bytes no longer match the digest produced at policy validation time, duplicate destination aliases, staged/destination overlap, hard-linked staged inputs, and hard-linked existing destinations.

This is a repository-side defense in depth measure. `O_NOFOLLOW` is platform-dependent; release automation is expected to run on the reviewed Linux/Node 22 path, while preflight regular-file checks and digest binding remain in place elsewhere. Path uniqueness is checked after lexical normalization with Node's `path.resolve`; the reviewed Linux runner has case-sensitive path semantics. Hard-link identity checks use `dev`/`ino` metadata for files that exist at preflight time. The guard does not claim protection against a privileged process that can replace ancestor directories, mutate filesystem identity after preflight, or otherwise rewrite and execute arbitrary checkout code. Release runners should use a private checkout/workspace with normal filesystem ownership controls.
