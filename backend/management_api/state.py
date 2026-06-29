# backend/management_api/state.py

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


@dataclass
class ManagementState:
    connected: bool = False
    server_started: bool = False
    error: str | None = None
    version_name: str | None = None
    version_protocol: int | None = None
    last_method: str | None = None
    last_update: float = field(default_factory=time.time)


_state = ManagementState()
_lock = threading.Lock()


def get_management_state() -> ManagementState:
    with _lock:
        return ManagementState(
            connected=_state.connected,
            server_started=_state.server_started,
            error=_state.error,
            version_name=_state.version_name,
            version_protocol=_state.version_protocol,
            last_method=_state.last_method,
            last_update=_state.last_update,
        )


def mark_connected() -> None:
    with _lock:
        _state.connected = True
        _state.server_started = False
        _state.error = None
        _state.last_method = None
        _state.version_name = None
        _state.version_protocol = None
        _state.last_update = time.time()


def mark_disconnected(error: str | None = None) -> None:
    with _lock:
        _state.connected = False
        _state.server_started = False
        _state.error = error
        _state.version_name = None
        _state.version_protocol = None
        _state.last_update = time.time()


def mark_server_started(
    version_name: str | None = None,
    version_protocol: int | None = None,
) -> None:
    with _lock:
        _state.connected = True
        _state.server_started = True
        _state.error = None
        _state.version_name = version_name
        _state.version_protocol = version_protocol
        _state.last_update = time.time()


def mark_notification(method: str) -> None:
    with _lock:
        _state.last_method = method
        _state.last_update = time.time()

