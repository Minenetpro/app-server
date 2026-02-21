# Changelog

All notable changes to this project are documented in this file.

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
