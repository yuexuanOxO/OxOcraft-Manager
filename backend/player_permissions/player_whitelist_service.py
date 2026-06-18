import json
import hashlib
import uuid
import urllib.request
from datetime import datetime, timedelta

from backend.paths import MC_ROOT,SERVER_PROPERTIES_PATH
from backend.rcon_service import send_rcon_command
from backend.server_monitor import get_cached_server_status

from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_account_type,
    resolve_player_identity_by_name,
)

from backend.player_permissions.player_permission_service import (
    get_effective_online_mode,
)

from backend.player_permissions.player_access_history_service import (
    record_player_access,
)

from backend.db import (
    update_player_whitelist_since,
    update_player_whitelist_status,
    get_whitelisted_players_from_db,
    sync_player_whitelist_flags_from_uuid_set,
)


WHITELIST_FILE = MC_ROOT / "whitelist.json"

_RECENT_UI_WHITELIST_RELOADS: list[datetime] = []


def push_recent_ui_whitelist_reload() -> None:
    _RECENT_UI_WHITELIST_RELOADS.append(
        datetime.now()
    )


def pop_recent_ui_whitelist_reload_if_match(
    max_age_seconds: int = 5,
) -> bool:
    now = datetime.now()

    for index, created_at in enumerate(
        list(_RECENT_UI_WHITELIST_RELOADS)
    ):
        age = (now - created_at).total_seconds()

        if age > max_age_seconds:
            _RECENT_UI_WHITELIST_RELOADS.remove(
                created_at
            )
            continue

        _RECENT_UI_WHITELIST_RELOADS.pop(index)
        return True

    return False


def load_whitelist_entries() -> list[dict]:
    if not WHITELIST_FILE.exists():
        return []

    try:
        with WHITELIST_FILE.open("r", encoding="utf-8") as file:
            content = file.read().strip()

        if not content:
            return []

        data = json.loads(content)

        if not isinstance(data, list):
            return []

        return data

    except json.JSONDecodeError:
        return []


def save_whitelist_entries(entries: list[dict]) -> None:
    with WHITELIST_FILE.open("w", encoding="utf-8") as file:
        json.dump(entries, file, ensure_ascii=False, indent=2)


def load_whitelist_uuid_set() -> set[str]:
    return {
        str(entry.get("uuid", "")).lower()
        for entry in load_whitelist_entries()
        if entry.get("uuid")
    }


def sync_whitelist_json_to_players(
    source: str = "unknown",
) -> None:
    sync_player_whitelist_flags_from_uuid_set(
        load_whitelist_uuid_set()
    )


def sync_whitelist_reload_from_log(
    operator_name: str,
    source: str,
    detail: str = "",
) -> dict:
    before_uuid_set = load_whitelist_uuid_set()

    # 目前 DB 狀態
    db_players = get_whitelisted_players_from_db()
    db_uuid_set = {
        str(player.get("player_uuid", "")).lower()
        for player in db_players
        if player.get("player_uuid")
    }

    # whitelist.json 狀態
    json_entries = load_whitelist_entries()
    json_uuid_set = {
        str(entry.get("uuid", "")).lower()
        for entry in json_entries
        if entry.get("uuid")
    }

    added_uuid_set = json_uuid_set - db_uuid_set
    removed_uuid_set = db_uuid_set - json_uuid_set

    sync_player_whitelist_flags_from_uuid_set(
        json_uuid_set
    )

    entry_by_uuid = {
        str(entry.get("uuid", "")).lower(): entry
        for entry in json_entries
        if entry.get("uuid")
    }

    db_player_by_uuid = {
        str(player.get("player_uuid", "")).lower(): player
        for player in db_players
        if player.get("player_uuid")
    }

    added_count = 0
    removed_count = 0

    for player_uuid in added_uuid_set:
        entry = entry_by_uuid.get(player_uuid, {})
        player_name = str(
            entry.get("name") or "未知玩家"
        ).strip()

        account_type = get_account_type(player_uuid)

        update_player_whitelist_since(
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=account_type,
            whitelisted_since=datetime.now().strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
        )

        record_player_access(
            category="whitelist",
            action="reload_add",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=account_type,
            operator_name=operator_name,
            source=source,
            detail=detail,
        )

        added_count += 1

    for player_uuid in removed_uuid_set:
        player = db_player_by_uuid.get(player_uuid, {})
        player_name = str(
            player.get("player_name") or "未知玩家"
        ).strip()

        account_type = (
            player.get("account_type")
            or get_account_type(player_uuid)
        )

        update_player_whitelist_status(
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=account_type,
            whitelisted=False,
        )

        record_player_access(
            category="whitelist",
            action="reload_remove",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=account_type,
            operator_name=operator_name,
            source=source,
            detail=detail,
        )

        removed_count += 1

    return {
        "added_count": added_count,
        "removed_count": removed_count,
    }


def rebuild_whitelist_json_from_db() -> None:
    if not is_server_ready():
        return

    players = get_whitelisted_players_from_db()

    entries = []

    for player in players:
        player_uuid = str(player.get("player_uuid", "")).strip()
        player_name = str(player.get("player_name", "")).strip()

        if not player_uuid or not player_name:
            continue

        entries.append({
            "uuid": player_uuid,
            "name": player_name,
        })

    save_whitelist_entries(entries)


def is_server_ready() -> bool:
    status = get_cached_server_status()
    data = status.get("data", {})

    return (
        data.get("state") == "ready"
        and data.get("online") is True
    )


def reload_whitelist_if_ready() -> str:
    if not is_server_ready():
        return "offline-edit"

    push_recent_ui_whitelist_reload()

    return send_rcon_command("whitelist reload")


def get_whitelist_ui_source() -> str:
    return "ui_reload" if is_server_ready() else "offline_ui_edit"


def get_offline_player_uuid(player_name: str) -> str:
    raw = ("OfflinePlayer:" + player_name).encode("utf-8")

    digest = bytearray(hashlib.md5(raw).digest())

    digest[6] &= 0x0F
    digest[6] |= 0x30

    digest[8] &= 0x3F
    digest[8] |= 0x80

    return str(uuid.UUID(bytes=bytes(digest)))


def get_player_whitelist_list() -> list[dict]:
    online_mode = get_effective_online_mode()

    if is_server_ready():
        players = get_whitelisted_players_from_db()

        result = []

        for player in players:
            player_uuid = str(player.get("player_uuid", "")).strip()
            account_type = (
                player.get("account_type")
                or get_account_type(player_uuid)
            )

            is_valid_for_current_mode = (
                account_type == "premium"
                if online_mode
                else account_type == "offline"
            )

            result.append({
                **player,
                "player_uuid": player_uuid,
                "player_name": player.get("player_name"),
                "account_type": account_type,
                "whitelisted": True,
                "valid_for_current_mode": is_valid_for_current_mode,
            })

        return result

    sync_whitelist_json_to_players(
        source="offline_refresh"
    )

    players = get_whitelisted_players_from_db()
    result = []

    for player in players:
        player_uuid = str(player.get("player_uuid", "")).strip()
        account_type = (
            player.get("account_type")
            or get_account_type(player_uuid)
        )

        is_valid_for_current_mode = (
            account_type == "premium"
            if online_mode
            else account_type == "offline"
        )

        result.append({
            **player,
            "player_uuid": player_uuid,
            "player_name": player.get("player_name"),
            "account_type": account_type,
            "whitelisted": True,
            "valid_for_current_mode": is_valid_for_current_mode,
        })

    return result


def add_player_whitelist(
    player_uuid: str,
    player_name: str,
) -> dict:

    whitelist_uuid_set = load_whitelist_uuid_set()

    if player_uuid.lower() in whitelist_uuid_set:
        return {
            "success": False,
            "message": f"{player_name} 已經在白名單中，不能重複加入。",
            "whitelisted": True,
        }

    rebuild_whitelist_json_from_db()

    entries = load_whitelist_entries()
    whitelist_uuid_set = load_whitelist_uuid_set()

    entries.append({
        "uuid": player_uuid,
        "name": player_name,
    })

    save_whitelist_entries(entries)

    result = reload_whitelist_if_ready()

    if is_server_ready():
        sync_whitelist_json_to_players(source="ui_reload")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    account_type = get_account_type(player_uuid)

    update_player_whitelist_since(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        whitelisted_since=now,
    )

    record_player_access(
        category="whitelist",
        action="add",
        target_uuid=player_uuid,
        target_name=player_name,
        account_type=account_type,
        operator_name="OxOcraft",
        source=get_whitelist_ui_source(),
        detail=result,
    )

    return {
        "success": True,
        "message": (
            f"已將 {player_name} 加入白名單"
        ),
        "result": result,
        "whitelisted": True,
    }


def remove_player_whitelist(
    player_uuid: str,
    player_name: str,
) -> dict:
    
    rebuild_whitelist_json_from_db()

    entries = load_whitelist_entries()

    entries = [
        entry
        for entry in entries
        if str(
            entry.get("uuid", "")
        ).lower() != player_uuid.lower()
    ]

    save_whitelist_entries(entries)

    result = reload_whitelist_if_ready()

    if is_server_ready():
        sync_whitelist_json_to_players(source="ui_reload")

    account_type = get_account_type(player_uuid)

    update_player_whitelist_status(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        whitelisted=False,
    )

    record_player_access(
        category="whitelist",
        action="remove",
        target_uuid=player_uuid,
        target_name=player_name,
        account_type=account_type,
        operator_name="OxOcraft",
        source=get_whitelist_ui_source(),
        detail=result,
    )

    return {
        "success": True,
        "message": (
            f"已將 {player_name} 移出白名單"
        ),
        "result": result,
        "whitelisted": False,
    }


def toggle_player_whitelist(
    player_uuid: str,
    player_name: str,
) -> dict:

    whitelist_uuid_set = (
        load_whitelist_uuid_set()
    )

    if player_uuid.lower() in whitelist_uuid_set:

        return remove_player_whitelist(
            player_uuid,
            player_name,
        )

    return add_player_whitelist(
        player_uuid,
        player_name,
    )


def get_mojang_uuid(player_name: str) -> str | None:
    url = f"https://api.mojang.com/users/profiles/minecraft/{player_name}"

    try:
        request_obj = urllib.request.Request(
            url,
            headers={"User-Agent": "OxOcraft-Manager"}
        )

        with urllib.request.urlopen(request_obj, timeout=5) as response:
            if response.status == 204:
                return None

            data = json.loads(response.read().decode("utf-8"))

        raw_uuid = data.get("id")

        if not raw_uuid:
            return None

        return str(uuid.UUID(raw_uuid))

    except Exception:
        return None


def get_player_whitelist_candidate_list() -> list[dict]:
    players = get_known_players()
    whitelist_uuid_set = load_whitelist_uuid_set()
    online_mode = get_effective_online_mode()

    result = []

    for player in players:
        if int(player.get("show_in_player_candidates", 1) or 0) != 1:
            continue

        account_type = player.get("account_type")

        if online_mode and account_type != "premium":
            continue

        if not online_mode and account_type != "offline":
            continue

        player_uuid = str(player.get("player_uuid", "")).lower()

        if player_uuid in whitelist_uuid_set:
            continue

        result.append({
            **player,
            "whitelisted": False,
        })

    return result


def add_player_whitelist_by_name(player_name: str) -> dict:
    player_name = player_name.strip()

    if not player_name:
        return {
            "success": False,
            "message": "請輸入玩家名稱",
        }

    identity = resolve_player_identity_by_name(player_name)

    if not identity["success"]:
        return {
            "success": False,
            "message": identity["message"],
        }

    return add_player_whitelist(
        player_uuid=identity["player_uuid"],
        player_name=identity["player_name"],
    )


def read_server_property(key: str, default: str = "false") -> str:
    if not SERVER_PROPERTIES_PATH.exists():
        return default

    with SERVER_PROPERTIES_PATH.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()

            if not line or line.startswith("#") or "=" not in line:
                continue

            prop_key, prop_value = line.split("=", 1)

            if prop_key.strip() == key:
                return prop_value.strip()

    return default


def write_server_property(key: str, value: str) -> None:
    lines = []

    if SERVER_PROPERTIES_PATH.exists():
        with SERVER_PROPERTIES_PATH.open("r", encoding="utf-8") as file:
            lines = file.readlines()

    found = False
    new_lines = []

    for line in lines:
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            prop_key, _ = line.split("=", 1)

            if prop_key.strip() == key:
                new_lines.append(f"{key}={value}\n")
                found = True
                continue

        new_lines.append(line)

    if not found:
        new_lines.append(f"{key}={value}\n")

    with SERVER_PROPERTIES_PATH.open("w", encoding="utf-8") as file:
        file.writelines(new_lines)


def get_whitelist_settings() -> dict:
    status = get_cached_server_status()
    data = status.get("data", {})
    server_state = data.get("state", "offline")

    return {
        "white_list": read_server_property("white-list", "false").lower() == "true",
        "enforce_whitelist": read_server_property("enforce-whitelist", "false").lower() == "true",
        "server_ready": is_server_ready(),
        "server_state": server_state,
        "server_busy": server_state in ["starting", "stopping", "backuping"],
    }


def set_white_list_enabled(enabled: bool) -> dict:
    value = "true" if enabled else "false"

    if is_server_ready():
        command = "whitelist on" if enabled else "whitelist off"
        result = send_rcon_command(command)

        write_server_property("white-list", value)

        return {
            "success": True,
            "key": "white-list",
            "value": enabled,
            "result": result,
            "message": f"已{'開啟' if enabled else '關閉'}白名單",
        }

    write_server_property("white-list", value)

    return {
        "success": True,
        "key": "white-list",
        "value": enabled,
        "result": "offline-edit",
        "message": f"已{'開啟' if enabled else '關閉'}白名單",
    }


def set_enforce_whitelist_enabled(enabled: bool) -> dict:

    settings = get_whitelist_settings()

    if settings["server_ready"]:
        return {
            "success": False,
            "message": "白名單已在線啟用，請先關閉白名單或重啟後再修改 enforce-whitelist",
        }

    value = "true" if enabled else "false"

    write_server_property("enforce-whitelist", value)

    return {
        "success": True,
        "key": "enforce-whitelist",
        "value": enabled,
        "result": "server-properties-edit",
        "message": f"已{'開啟' if enabled else '關閉'}強制執行白名單，重啟後生效",
    }


def toggle_whitelist_setting(key: str) -> dict:
    settings = get_whitelist_settings()

    if key == "white-list":
        return set_white_list_enabled(not settings["white_list"])

    if key == "enforce-whitelist":
        return set_enforce_whitelist_enabled(not settings["enforce_whitelist"])

    return {
        "success": False,
        "message": "不支援的白名單設定",
    }


def add_player_whitelist_direct(
    player_uuid: str,
    player_name: str,
) -> dict:

    if not player_uuid or not player_name:
        return {
            "success": False,
            "message": "缺少玩家 UUID 或名稱",
        }

    return add_player_whitelist(
        player_uuid=player_uuid,
        player_name=player_name,
    )