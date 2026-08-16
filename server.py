from __future__ import annotations

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from backend import get_calendar, get_map_deals, get_meta, get_offers

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "legacy_static"


class AppHandler(BaseHTTPRequestHandler):
    server_version = "SkyPlanner/0.1"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}

        if path == "/api/meta":
            return self._json(get_meta())
        if path == "/api/deals/map":
            return self._json(get_map_deals(query))
        if path == "/api/deals/calendar":
            return self._json(get_calendar(query))
        if path == "/api/offers":
            return self._json(get_offers(query))

        if path == "/":
            return self._serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")

        if path.startswith("/static/"):
            return self._serve_asset(path.removeprefix("/static/"))

        fallback = STATIC_DIR / path.lstrip("/")
        if fallback.exists() and fallback.is_file():
            return self._serve_file(fallback, self._content_type(fallback.suffix))

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return None

    def _json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _serve_asset(self, relative_path: str) -> None:
        file_path = (STATIC_DIR / relative_path).resolve()
        if not str(file_path).startswith(str(STATIC_DIR.resolve())) or not file_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        self._serve_file(file_path, self._content_type(file_path.suffix))

    def _serve_file(self, file_path: Path, content_type: str) -> None:
        if not file_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        content = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    @staticmethod
    def _content_type(suffix: str) -> str:
        return {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(suffix, "application/octet-stream")


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = HTTPServer((host, port), AppHandler)
    print(f"Sky Planner available at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
