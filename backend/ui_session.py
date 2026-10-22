"""單一 Flask 程序的分頁操作權；不使用 Cookie 或 sessionStorage 識別分頁。"""
from __future__ import annotations

import re
import secrets
import threading
import time

from flask import g, jsonify, render_template, request


LEASE_SECONDS = 90
HEADER_NAME = "X-OxO-UI-Lease"
TOKEN_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


class UiSessionLease:
    def __init__(self, ttl=LEASE_SECONDS, clock=time.monotonic):
        self.ttl = ttl
        self.clock = clock
        self.lock = threading.Lock()
        self.token = None
        self.expires_at = 0.0
        self.active_writes = 0
        self.releasing = False

    def _expire(self):
        if self.token and not self.active_writes and (
            self.releasing or self.clock() >= self.expires_at
        ):
            self.token = None
            self.releasing = False

    def _matches(self, token):
        return bool(
            self.token and isinstance(token, str) and TOKEN_PATTERN.fullmatch(token)
            and secrets.compare_digest(self.token, token)
        )

    def acquire(self, token):
        with self.lock:
            self._expire()
            if self.token and (not self._matches(token) or self.releasing):
                return False
            self.token = token
            self.expires_at = self.clock() + self.ttl
            return True

    def authorize(self, token, writing=False):
        with self.lock:
            self._expire()
            if not self._matches(token) or self.releasing or self.clock() >= self.expires_at:
                return False
            if writing:
                self.active_writes += 1
            return True

    def heartbeat(self, token):
        with self.lock:
            self._expire()
            if not self._matches(token) or self.releasing or self.clock() >= self.expires_at:
                return False
            self.expires_at = self.clock() + self.ttl
            return True

    def release(self, token):
        with self.lock:
            if self._matches(token):
                self.releasing = True
                self._expire()

    def finish_write(self):
        with self.lock:
            self.active_writes -= 1
            self._expire()


def register_ui_session(app):
    lease = UiSessionLease()
    app.extensions["oxo_ui_session"] = lease

    def denied():
        return jsonify(
            success=False,
            error_code="ui_session_required",
            message="此系統只支援單個分頁操作，請使用已開啟的管理分頁。",
        ), 409

    def posted_token():
        data = request.get_json(silent=True)
        token = data.get("token") if isinstance(data, dict) else None
        return token if isinstance(token, str) and TOKEN_PATTERN.fullmatch(token) else None

    @app.post("/api/ui-session/acquire")
    def ui_session_acquire():
        token = posted_token()
        if token is None:
            return jsonify(success=False, message="無效的分頁憑證"), 400
        if not lease.acquire(token):
            return denied()
        return jsonify(success=True, lease_seconds=lease.ttl)

    @app.post("/api/ui-session/heartbeat")
    def ui_session_heartbeat():
        if not lease.heartbeat(request.headers.get(HEADER_NAME, "")):
            return denied()
        return jsonify(success=True)

    @app.post("/api/ui-session/release")
    def ui_session_release():
        lease.release(posted_token())
        return "", 204

    @app.get("/single-tab")
    def ui_session_blocked():
        return render_template("single_tab.html")

    @app.before_request
    def require_ui_session():
        if not request.path.startswith("/api/"):
            return None

        # 租約端點和 Google OAuth 回呼本身無法附帶分頁 Header。
        if request.endpoint in {
            "ui_session_acquire", "ui_session_heartbeat", "ui_session_release",
            "cloud.api_google_callback",
        }:
            return None

        # <img> 無法附帶自訂 Header，僅豁免圖片資源。
        if request.method in {"GET", "HEAD"} and request.endpoint in {
            "settings.api_server_icon_preview", "world.api_world_icon",
        }:
            return None

        token = request.headers.get(HEADER_NAME, "")
        if request.path in {
            "/api/events", "/api/notifications/events", "/api/cloud/google/login",
        }:
            token = token or request.args.get("ui_lease", "")

        writing = request.method not in {"GET", "HEAD", "OPTIONS"}
        if not lease.authorize(token, writing=writing):
            return denied()
        g.ui_session_token = token
        g.ui_session_write = writing
        return None

    @app.after_request
    def guard_event_stream(response):
        token = getattr(g, "ui_session_token", None)
        if token and response.mimetype == "text/event-stream":
            original = response.response

            def guarded():
                try:
                    for chunk in original:
                        if not lease.authorize(token):
                            break
                        yield chunk
                finally:
                    close = getattr(original, "close", None)
                    if close:
                        close()

            response.response = guarded()
        return response

    @app.teardown_request
    def finish_ui_session_request(error):
        if getattr(g, "ui_session_write", False):
            g.ui_session_write = False
            lease.finish_write()
