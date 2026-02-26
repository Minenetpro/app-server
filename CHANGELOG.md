# Changelog

All notable changes to this project are documented in this file.

## v1.0.5 - 2026-02-26

### Added
- Workspace push now tracks top-level workspace config directories and reconciles remote deployment configurations accordingly:
  - create remote configurations for new local `<directory>/config.yml`
  - update existing mapped configurations
  - delete remote configurations when mapped local directories are removed
- Added deployments API client methods/types for creating and deleting configurations.

### Changed
- Push target resolution now combines manifest-backed entries with local directory discovery so newly created config folders are included without a prior pull.
- Push responses now include `created`, `deleted`, and `failed` sections in addition to existing update/conflict/skipped data.
- Updated `dev` script to run `bun run index.ts --watch` for faster local iteration.

### Fixed
- Captured API failure metadata during push operations and propagated per-item failure reasons/codes instead of collapsing errors.
- Added parsing for validation issue arrays (`issues[]`) from API error details so CLI can render field-level validation messages.

### Agent Notes
- Keep workspace reconciliation behavior aligned with directory-level ownership model (`<workspace>/<directory>/config.yml`).
- Preserve non-destructive conflict behavior: return structured conflicts/failures and allow caller UX to decide retry/force strategy.
- If deployments configuration API contracts change, update all three together:
  - `src/api.ts` client methods
  - `src/types.ts` response/failure types
  - `src/workspace.ts` push reconciliation + error mapping

## v1.0.4 - 2026-02-21

### Fixed
- Migrated deployment API client calls to the new `deployments` namespace:
  - `/api/client/v1/deployments/configurations`
  - `/api/client/v1/deployments/apply`
  - `/api/client/v1/deployments/runs/{runId}`
- Switched deployment configuration update from `PUT` to `PATCH`.
- Removed deprecated `prune` field from apply requests and daemon deploy handler.
- Updated workspace conflict/hash tracking to use `spec_hash` (with fallback support for legacy `config_hash`).

### Changed
- Expanded deployment run typing to current lifecycle/status/stage/event payloads.
- Added optional `idempotency_key` support in apply client request shape.

### Agent Notes
- Keep app-server client API paths aligned with `minenet-pro` route namespace changes (`deployment` -> `deployments`).
- Treat `spec_hash` as canonical; keep `config_hash` fallback only for backward compatibility.
- If deploy apply contract changes, update both:
  - `src/api.ts` request body for `applyConfiguration`
  - `src/server.ts` + `src/workspace.ts` deploy input plumbing

## v1.0.3 - 2026-02-21

### Changed
- Switched default daemon API base URL to the main app domain:
  - from `https://prod.minenetpro.app`
  - to `https://www.minenet.pro`

### Agent Notes
- Keep `DEFAULT_API_BASE_URL` aligned with the primary app domain that serves `/api/cli/v1/*` and `/api/client/v1/*`.
- Keep `MINENET_API_BASE_URL` as the runtime override for non-production environments.

## v1.0.2 - 2026-02-21

### Fixed
- Corrected Unix filename validation in CI/release workflows to avoid false positives on macOS runners.
- Replaced glob range check (`*[A-Z]*`) with deterministic lowercase comparison on each built filename.

### Agent Notes
- Keep using basename lowercase comparison for Unix checks; avoid locale-sensitive range globs for casing checks.
- If filename policy changes, update both workflow files together:
  - `.github/workflows/build-binaries.yml`
  - `.github/workflows/release.yml`

## v1.0.1 - 2026-02-21

### Added
- GitHub Actions workflow to build platform-specific binaries on push/PR.
- GitHub Actions workflow to publish release binaries when pushing semver tags matching `v*.*.*`.
- Package script `build:bin` to compile a standalone app-server binary:
  - `bun run build:bin`

### Changed
- Release trigger switched from release branches to release tags.
- Build and release workflows now enforce lowercase-only binary filenames.
- README includes explicit binary build instructions.

### Agent Notes
- Release workflow trigger is tag-based only (`on.push.tags: ['v*.*.*']`).
- Binary artifact names must remain lowercase; workflow intentionally fails if uppercase letters are present.
- If you change binary naming, update both workflows together:
  - `.github/workflows/build-binaries.yml`
  - `.github/workflows/release.yml`
- Keep `build:bin` in sync with workflow `bun build --compile` command.
