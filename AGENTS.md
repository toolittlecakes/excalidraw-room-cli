# Repository Instructions

## Scope

This file is for coding agents working on the `excalidraw-room-cli` repository. User-facing CLI documentation belongs in `README.md`.

## Project

- Package: `excalidraw-room-cli`
- CLI binary: `excalidraw-room`
- Runtime: Bun
- Main entrypoint: `src/index.ts`
- Browser export entrypoint: `src/browser-export.ts`
- Shell binary wrapper: `bin/excalidraw-room`
- Agent discovery stub: `skills/excalidraw-room/SKILL.md`
- Full agent workflow text shipped by the CLI: `skill-data/core/SKILL.md`

## Tooling

- Use `bun`, not npm/yarn, for local development.
- Do not migrate package managers.
- Keep `bun.lock` committed when dependencies change.
- Avoid adding build tooling unless the task explicitly requires it.

## Development Checks

Run relevant smoke checks before finalizing changes:

```bash
bun run src/index.ts help
bun run src/index.ts version
bun run src/index.ts skill >/dev/null
```

For changes touching export behavior, also verify a real room export with `export-image` when a room URL is available.

## CLI Design

- Keep the primary write path explicit: `apply-json`.
- Prefer one JSON payload per logical room change.
- Do not add fallback write paths, backup parsers, or silent degraded modes without explicit approval.
- Visible failure is preferred over hidden recovery.
- Preserve backwards-compatible aliases only when already present or explicitly requested.

## Agent Skill Contract

When changing CLI behavior that agents rely on, update both:

- `README.md` for user-facing usage
- `skill-data/core/SKILL.md` for agent-facing workflow

The `skill` and `skills get core` commands print `skill-data/core/SKILL.md`. Keep that file concise and operational.

## Release

Publishing is handled by `.github/workflows/publish.yml`.

- Release tags must match `v*`.
- The workflow uses npm trusted publishing through GitHub Actions OIDC.
- Do not add `NPM_TOKEN` unless explicitly requested.
- Ask before pushing tags or force-pushing.

Manual release flow, after npm trusted publisher is configured:

```bash
bun install --frozen-lockfile
bun run src/index.ts help >/dev/null
bun run src/index.ts skill >/dev/null
git tag vX.Y.Z
git push origin main --tags
```

## Repo Hygiene

- Keep diffs minimal.
- Do not commit generated exports or snapshots unless the task specifically asks for them.
- Do not commit secrets or room URLs containing private keys.
- Commit messages use Conventional Commits in English.
