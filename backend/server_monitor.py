import json
import queue
import threading
import time
from typing import Optional

from backend.server_status import get_server_query_status


_status_cache = {
    "revision": 0,
    "data": {
        "online": False,
        "state": "offline",
        "message": "尚未初始化",
    },
    "last_update": 0,
}

_event_queues: list[queue.Queue] = []
_monitor_thread: Optional[threading.Thread] = None
_monitor_started = False
_lock = threading.Lock()

_log_cache: list[str] = []
LOG_CACHE_MAX_LINES = 500


def append_log_line(line: str) -> None:
    if not line:
        return

    with _lock:
        _log_cache.append(line)

        if len(_log_cache) > LOG_CACHE_MAX_LINES:
            del _log_cache[:-LOG_CACHE_MAX_LINES]

    publish_event("log_append", {
        "line": line
    })


def get_cached_logs() -> list[str]:
    with _lock:
        return list(_log_cache)


def clear_log_cache() -> None:
    with _lock:
        _log_cache.clear()

    publish_event("log_clear", {})


def get_cached_server_status() -> dict:
    with _lock:
        return {
            "revision": _status_cache["revision"],
            "data": _status_cache["data"],
            "last_update": _status_cache["last_update"],
        }


def subscribe_events() -> queue.Queue:
    q = queue.Queue()
    with _lock:
        _event_queues.append(q)
    return q


def unsubscribe_events(q: queue.Queue) -> None:
    with _lock:
        if q in _event_queues:
            _event_queues.remove(q)


def publish_event(event_type: str, data: dict) -> None:
    payload = {
        "type": event_type,
        "data": data,
    }

    with _lock:
        queues = list(_event_queues)

    for q in queues:
        q.put(payload)


def get_poll_interval(state: str) -> float:
    if state == "ready":
        return 2.0

    if state in ("starting", "stopping"):
        return 0.5

    return 5.0


def monitor_loop() -> None:
    global _status_cache

    while True:
        new_data = get_server_query_status()
        now = time.time()

        should_publish = False
        event_data = None

        with _lock:
            old_data = _status_cache["data"]

            if old_data != new_data:
                _status_cache["revision"] += 1
                _status_cache["data"] = new_data
                should_publish = True

            _status_cache["last_update"] = now

            event_data = {
                "revision": _status_cache["revision"],
                "data": _status_cache["data"],
                "last_update": _status_cache["last_update"],
            }

        if should_publish:
            publish_event("server_status_changed", event_data)

        time.sleep(get_poll_interval(new_data.get("state", "offline")))


def start_server_monitor() -> None:
    global _monitor_thread, _monitor_started

    if _monitor_started:
        return

    _monitor_started = True
    _monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
    _monitor_thread.start()


def format_sse(event_name: str, data: dict) -> str:
    return f"event: {event_name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"