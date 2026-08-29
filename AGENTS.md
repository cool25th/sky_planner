# Repository Guidelines

## Project Structure & Module Organization
This is a Next.js 15 App Router application (`app/`) with a same-origin BFF under `app/api/`. Shared server utilities live in `lib/`: `lib/mock-market.ts` (deterministic mock market, query parsing, response envelope), `lib/data-source.ts` (response orchestration facade), and `lib/read-model/` (PostgreSQL queries, zod row mappers, source readiness context, diagnostics). React client components live in `components/`. Operational scripts (batch, collector ingest, preflight/smoke/audit) live in `scripts/`. The Python fare collector package lives in `sky_collector/` (src layout, pydantic models, pytest). PostgreSQL DDL and role separation live in `sql/init/`. Tests live in `tests/` (`*.mjs` contract tests for Node, `test_backend.py` for the legacy prototype). Product and implementation notes live in `require/`, operational procedures in `docs/operations.md`. **`require/`(런타임 의존 `ops.md` 제외)·`PROJECT_REQUIREMENTS_AND_ACCEPTANCE.md`·`docs/continuous-improvement/`는 2026-08-29부터 git 미추적(로컬 전용)** — 디스크에는 존재하므로 로컬 작업·자동 루프는 영향 없으나, 커밋 대상에 넣지 않는다.

Data backend rule of thumb: **PostgreSQL is the canonical read model; Firestore is an audit sink** written by batch scripts only — never add Firestore reads to the app runtime.

## Build, Test, and Development Commands

- `npm run dev`: start the Next.js dev server at `http://localhost:3000`.
- `npm run build && npm run start`: production build and serve.
- `npm test`: run all Node contract tests via the built-in runner with TS module-loader hooks.
- `npm run lint`: Biome lint over `lib/`, `app/`, `components/`, `tests/` (must pass with zero diagnostics).
- `npx tsc --noEmit`: TypeScript check (strict mode).
- `python3 -m unittest discover -s tests`: legacy Python prototype test suite.
- `python3 server.py`: legacy static server at `http://127.0.0.1:8000`.

If `python3` is managed by `asdf` and no version is selected, either update `.tool-versions` or use `/usr/bin/python3`. Node scripts importing `.ts` files use `--experimental-strip-types`; keep this flag consistent when adding new npm scripts.

## Coding Style & Testing Conventions
TypeScript is strict; do not suppress errors (`as any`, `@ts-ignore`) and do not write explicit `any` — Biome enforces `noExplicitAny: error`. SQL row shapes must go through the zod schemas in `lib/read-model/row-mappers.ts`. Keep route handlers thin: parse the query, delegate to a `resolve*Response` function in `lib/data-source.ts`, return through `apiStatusForResponse`/`apiHeadersForResponse`. Server-only modules import `"server-only"`. Add contract tests under `tests/` named `*-contract.mjs` using `node:test`; prefer deterministic fixtures from `tests/fixtures/`. Python code uses 4-space indentation, type hints, `snake_case`; frontend code uses 2-space indentation and `camelCase`; CSS classes are kebab-case. Keep Korean UI copy UTF-8 encoded.

When touching API response shape, sorting, filtering, or the readiness logic, extend the matching contract test — CI runs `npm test`, lint, tsc, Python unittest, and `npm run build` on every PR.

## Commit & Pull Request Guidelines
Use short imperative commit subjects such as `Add business fare filter` (under 72 characters) and separate backend, frontend, docs, and ops-script changes when practical. PRs should include a concise summary, affected endpoints or screens, linked requirement IDs (`require/*.md` decision IDs), and screenshots for visible UI changes.

## Configuration Notes
Runtime secrets come from `.env.local` / Vercel env — see `.env.example` for the full list and `docs/operations.md` for preflight semantics. Never commit `.env*` files, `runtime/*.json` artifacts, or cache directories. `next.config.ts` includes repo source files into the serverless bundle for runtime readiness checks (`READINESS_STATIC_FILES`); if you change which files those checks read, keep that list in sync.
