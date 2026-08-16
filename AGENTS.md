# Repository Guidelines

## Project Structure & Module Organization
`backend.py` holds the deterministic mock flight market data, filtering logic, and API payload builders. `server.py` is the legacy Python runtime entry point; it serves both the JSON endpoints and the legacy static UI. Legacy frontend files live in `legacy_static/` (`index.html`, `app.js`, `styles.css`). The current Next.js app lives under `app/` and shared server utilities live under `lib/`. Tests live in `tests/`, and product or implementation notes live in `require/`.

## Build, Test, and Development Commands
There is no build step and no external package install for the app itself.

- `python3 server.py`: start the local server at `http://127.0.0.1:8000`.
- `python3 -m unittest discover -s tests`: run the backend test suite.
- `open http://127.0.0.1:8000`: open the prototype in a browser on macOS.

If `python3` is managed by `asdf` and no Python version is selected, either add Python to `.tool-versions` or use `/usr/bin/python3`.

## Coding Style & Naming Conventions
Use 4-space indentation in Python and keep type hints in place. Follow existing Python naming: `snake_case` for functions and variables, `UPPER_SNAKE_CASE` for constants, and small focused helpers instead of large handlers. In frontend files, use 2-space indentation, `camelCase` for JavaScript identifiers, and kebab-case for CSS classes and DOM IDs. Keep Korean UI copy UTF-8 encoded and preserve the current static, framework-free structure.

## Testing Guidelines
Tests use the standard library `unittest` runner. Add new tests under `tests/` with `test_*.py` names and `test_*` methods. Prefer deterministic assertions against stable mock inputs such as `2026-W13`, fixed origins, and known cabin filters. Cover response shape, sorting, and filter behavior whenever `backend.py` or API query handling changes.

## Commit & Pull Request Guidelines
This checkout does not include `.git` history, so no local commit pattern can be derived directly. Use short imperative commit subjects such as `Add business fare filter`, keep them under 72 characters, and separate backend, frontend, and docs changes when practical. PRs should include a concise summary, affected endpoints or screens, linked issues or requirements, and screenshots for visible UI changes.

## Configuration Notes
Keep the project dependency-light: preserve the existing Python standard library prototype while iterating on the Next.js app. When editing `server.py`, preserve the current path-safety checks for files under `legacy_static/`.
