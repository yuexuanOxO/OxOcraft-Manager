import json
import queue
import threading
import time
import re
from typing import Callable, Optional

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
_event_handlers: list[Callable[[str, dict], None]] = []
_monitor_thread: Optional[threading.Thread] = None
_monitor_started = False
_lock = threading.Lock()

_log_cache: list[str] = []
LOG_CACHE_MAX_LINES = 500

_pending_login_uuids: dict[str, str] = {}


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

    maybe_record_player_login_from_log(line)
    maybe_record_player_logout_from_log(line)

    maybe_refresh_player_ban_from_log(line)
    maybe_refresh_player_permission_from_log(line)
    maybe_refresh_player_whitelist_from_log(line)


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


def register_event_handler(handler: Callable[[str, dict], None]) -> None:
    with _lock:
        if handler not in _event_handlers:
            _event_handlers.append(handler)


def unregister_event_handler(handler: Callable[[str, dict], None]) -> None:
    with _lock:
        if handler in _event_handlers:
            _event_handlers.remove(handler)


def publish_event(event_type: str, data: dict) -> None:
    payload = {
        "type": event_type,
        "data": data,
    }

    with _lock:
        queues = list(_event_queues)
        handlers = list(_event_handlers)

    for q in queues:
        q.put(payload)

    for handler in handlers:
        try:
            handler(event_type, data)
        except Exception as error:
            print(f"[ServerMonitor] event handler failed: {error}")


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

def refresh_server_status_now() -> dict:
    global _status_cache

    new_data = get_server_query_status()
    now = time.time()

    with _lock:
        old_data = _status_cache["data"]

        if old_data != new_data:
            _status_cache["revision"] += 1
            _status_cache["data"] = new_data

        _status_cache["last_update"] = now

        event_data = {
            "revision": _status_cache["revision"],
            "data": _status_cache["data"],
            "last_update": _status_cache["last_update"],
        }

    publish_event("server_status_changed", event_data)

    return event_data


def maybe_record_player_login_from_log(line: str) -> None:
    uuid_match = re.search(
        r"UUID of player\s+(.+?)\s+is\s+([0-9a-fA-F-]{36})",
        line,
    )

    if uuid_match:
        player_name = uuid_match.group(1).strip()
        player_uuid = uuid_match.group(2).strip()

        _pending_login_uuids[
            player_name.lower()
        ] = player_uuid

        print(
            "[PlayerIdentity] UUID cached:",
            player_name,
            player_uuid,
        )

        return

    login_match = re.search(
        r"\]:\s*(.+?)\[/([0-9a-fA-F:.]+):(\d+)\]\s+logged in with entity id",
        line,
    )

    if not login_match:
        return

    player_name = login_match.group(1).strip()
    ip = login_match.group(2).strip()
    port = login_match.group(3).strip()

    player_uuid = _pending_login_uuids.pop(
        player_name.lower(),
        "",
    )

    if not player_uuid:
        try:
            from backend.routes.player_routes import (
                is_online_mode,
                get_mojang_uuid,
                get_offline_player_uuid,
            )

            if is_online_mode():
                player_uuid = get_mojang_uuid(player_name)
            else:
                player_uuid = get_offline_player_uuid(player_name)

            print(
                "[PlayerIdentity] UUID resolved by current mode:",
                player_name,
                player_uuid,
            )

        except Exception as error:
            print(
                "[PlayerIdentity] UUID fallback failed:",
                player_name,
                error,
            )
            return

    if not player_uuid:
        return

    try:
        from backend.player_permissions.player_identity_service import (
            record_player_login_from_log,
        )

        identity = record_player_login_from_log(
            player_name=player_name,
            player_uuid=player_uuid,
            ip=ip,
            port=port,
        )

        print(
            "[PlayerIdentity] login recorded:",
            identity,
        )

    except Exception as error:
        print(
            "[PlayerIdentity] record failed:",
            error,
        )


def maybe_record_player_logout_from_log(line: str) -> None:
    left_match = re.search(
        r"\]:\s*(.+?)\s+left the game$",
        line,
    )

    if not left_match:
        return

    player_name = left_match.group(1).strip()

    if not player_name:
        return

    try:
        from backend.player_permissions.player_identity_service import (
            record_player_logout_from_log,
        )

        record_player_logout_from_log(player_name)

        print(
            "[PlayerIdentity] logout recorded:",
            player_name,
        )

    except Exception as error:
        print(
            "[PlayerIdentity] logout record failed:",
            error,
        )


def maybe_refresh_player_ban_from_log(line: str) -> None:
    patterns = [
        r"\bBanned\s+.+",
        r"\bUnbanned\s+.+",
        r"\bPardoned\s+.+",
        r"\bBanned\s+IP\s+.+",
        r"\bUnbanned\s+IP\s+.+",
        r"\bPardoned\s+IP\s+.+",
        r"Removed\s+.+\s+from\s+the\s+banlist",
    ]

    if not any(
        re.search(pattern, line, re.IGNORECASE)
        for pattern in patterns
    ):
        return

    print("[PlayerBan] detected ban log:", line)

    try:
        from backend.player_ban.player_ban_service import (
            sync_banned_json_to_db
        )

        from backend.player_ban.player_ban_service import (
            sync_banned_json_to_db,
            sync_removed_bans_from_json,
        )

        sync_banned_json_to_db()
        sync_removed_bans_from_json()

        publish_event("player_ban_should_refresh", {
            "reason": "minecraft_ban_log",
            "line": line,
        })

        print("[PlayerBan] refresh event published")

    except Exception as error:
        print("[PlayerBan] refresh from log failed:", error)


def maybe_refresh_player_permission_from_log(line: str) -> None:
    remove_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Made\s+(?P<target>.+?)\s+no\s+longer\s+a\s+server\s+operator\]",
        line,
        re.IGNORECASE,
    )

    add_match = None

    if not remove_match:
        add_match = re.search(
            r"\[(?P<operator>[^:\]]+):\s*Made\s+(?P<target>.+?)\s+a\s+server\s+operator\]",
            line,
            re.IGNORECASE,
        )

    if not add_match and not remove_match:
        return

    matched = remove_match or add_match

    action = "remove" if remove_match else "add"
    target_name = matched.group("target").strip()
    log_operator = matched.group("operator").strip()

    

    is_rcon = log_operator.lower() == "rcon"

    try:
        from backend.player_permissions.player_permission_service import (
            sync_ops_json_to_players,
            pop_recent_ui_op_command_if_match,
        )

        from backend.player_permissions.player_identity_service import (
            resolve_player_identity,
        )

        from backend.player_permissions.player_access_history_service import (
            record_player_access,
        )


        if is_rcon and pop_recent_ui_op_command_if_match(
            action=action,
            player_name=target_name,
        ):
            source = "ui"
            operator_name = "OxOcraft"
        elif is_rcon:
            source = "console_rcon"
            operator_name = "Rcon"
        else:
            source = "player_command"
            operator_name = log_operator



        sync_ops_json_to_players(source=source)

        record_player_access(
            category="op",
            action=action,
            target_name=target_name,
            operator_name=operator_name,
            source=source,
            detail=line,
        )

        publish_event("player_permission_should_refresh", {
            "reason": "minecraft_op_log",
            "line": line,
            "source": source,
        })

        print("[PlayerPermission] refresh event published")

    except Exception as error:
        print("[PlayerPermission] refresh from log failed:", error)


def maybe_refresh_player_whitelist_from_log(line: str) -> None:
    remove_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Removed\s+(?P<target>.+?)\s+from\s+the\s+whitelist\]",
        line,
        re.IGNORECASE,
    )

    add_match = None

    if not remove_match:
        add_match = re.search(
            r"\[(?P<operator>[^:\]]+):\s*Added\s+(?P<target>.+?)\s+to\s+the\s+whitelist\]",
            line,
            re.IGNORECASE,
        )

    reload_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Reloaded\s+the\s+whitelist\]",
        line,
        re.IGNORECASE,
    )

    if reload_match:
        publish_event("player_whitelist_should_refresh", {
            "reason": "minecraft_whitelist_reload_log",
            "line": line,
        })

        return

    if not add_match and not remove_match:
        return

    matched = remove_match or add_match

    action = "remove" if remove_match else "add"
    target_name = matched.group("target").strip()
    log_operator = matched.group("operator").strip()

    is_rcon = log_operator.lower() == "rcon"

    if is_rcon:
        source = "console_rcon"
        operator_name = "Rcon"
    else:
        source = "player_command"
        operator_name = log_operator

    try:
        from backend.player_permissions.player_access_history_service import (
            record_player_access,
        )

        record_player_access(
            category="whitelist",
            action=action,
            target_name=target_name,
            operator_name=operator_name,
            source=source,
            detail=line,
        )

        publish_event("player_whitelist_should_refresh", {
            "reason": "minecraft_whitelist_log",
            "line": line,
            "source": source,
        })

        print("[PlayerWhitelist] refresh event published")

    except Exception as error:
        print("[PlayerWhitelist] refresh from log failed:", error)
