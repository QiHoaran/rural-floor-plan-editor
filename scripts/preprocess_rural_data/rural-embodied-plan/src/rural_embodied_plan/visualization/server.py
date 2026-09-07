"""Read-only local HTTP server for the exploration visualizer."""

from __future__ import annotations

import json
import threading
import webbrowser
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path
from typing import Any

from .session import build_playback_session

_STATIC_TYPES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}


def _handler_factory(session: dict[str, Any]) -> Callable[..., BaseHTTPRequestHandler]:
    session_bytes = json.dumps(session, ensure_ascii=False, separators=(",", ":")).encode()
    static_root = files("rural_embodied_plan.visualization").joinpath("static")

    class VisualizationHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/api/session":
                self._send(200, "application/json; charset=utf-8", session_bytes)
                return
            static = _STATIC_TYPES.get(path)
            if static is None:
                self._send(404, "text/plain; charset=utf-8", b"Not found\n")
                return
            name, content_type = static
            self._send(200, content_type, static_root.joinpath(name).read_bytes())

        def _send(self, status: int, content_type: str, body: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
            )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            return

    return VisualizationHandler


def serve_visualization(
    output_dir: Path,
    host: str = "127.0.0.1",
    port: int = 8765,
    open_browser: bool = True,
) -> None:
    """Validate artifacts, then serve the visualizer until interrupted."""

    session = build_playback_session(output_dir)
    try:
        server = ThreadingHTTPServer((host, port), _handler_factory(session))
    except OSError as error:
        raise OSError(f"Could not start visualization server on {host}:{port}: {error}") from error
    url = f"http://{host}:{server.server_port}/"
    print(f"Robot token visualization: {url}")
    if open_browser:
        threading.Timer(0.2, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
