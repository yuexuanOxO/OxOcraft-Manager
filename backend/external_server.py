"""Detect a Minecraft listener that is not owned by this Manager instance."""
import socket
import threading
import time

from mcstatus import JavaServer

_lock = threading.Lock()
_active = False
_misses = 0
_checked = -10.0
_address = None


def port_is_open(host, port):
    host = "127.0.0.1" if host in ("", "0.0.0.0", "*") else host
    try:
        with socket.create_connection((host, port), timeout=0.4):
            return True
    except OSError:
        return False


def detect_external_server(host, port, managed=False):
    global _active, _misses, _checked, _address
    host = "127.0.0.1" if host in ("", "0.0.0.0", "*") else host
    with _lock:
        if managed:
            _active, _misses, _address = False, 0, None
            return False
        address = (host, port)
        now = time.monotonic()
        if address == _address and now - _checked < 0.9:
            return _active
        if address != _address:
            _active, _misses = False, 0
        _address, _checked = address, now
        if _active:
            # Keep external state through a slow Minecraft tick; require two
            # consecutive closed TCP probes before reporting a shutdown.
            if port_is_open(host, port):
                _misses = 0
            else:
                _misses += 1
                if _misses >= 2:
                    _active, _misses = False, 0
            return _active
        try:
            from backend.management_api.state import get_management_state
            management = get_management_state()
            if management.connected and management.server_started and port_is_open(host, port):
                _active, _misses = True, 0
                return True
        except Exception:
            pass
        try:
            # A generic TCP listener (e.g. Python HTTP) is not Minecraft.
            JavaServer(host, port, timeout=0.5).status()
            _active, _misses = True, 0
        except Exception:
            pass
        return _active
