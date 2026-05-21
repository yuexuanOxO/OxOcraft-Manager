import json
import hashlib
import uuid
import urllib.request

from backend.paths import MC_ROOT,SERVER_PROPERTIES_PATH
from backend.rcon_service import send_rcon_command
from backend.server_monitor import get_cached_server_status


from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_uuid_type,
    upsert_player_to_usercache,
    remove_player_from_usercache,
)

from backend.player_permissions.player_permission_service import (
    get_effective_online_mode,
)


WHITELIST_FILE = MC_ROOT / "whitelist.json"


def load_whitelist_entries() -> list[dict]:
    if not WHITELIST_FILE.exists():
        return []

    with WHITELIST_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_whitelist_entries(entries: list[dict]) -> None:
    with WHITELIST_FILE.open("w", encoding="utf-8") as file:
        json.dump(entries, file, ensure_ascii=False, indent=2)


def load_whitelist_uuid_set() -> set[str]:
    return {
        str(entry.get("uuid", "")).lower()
        for entry in load_whitelist_entries()
        if entry.get("uuid")
    }


def is_server_ready() -> bool:
    status = get_cached_server_status()
    data = status.get("data", {})

    return (
        data.get("state") == "ready"
        and data.get("online") is True
    )


def get_offline_player_uuid(player_name: str) -> str:
    raw = ("OfflinePlayer:" + player_name).encode("utf-8")

    digest = bytearray(hashlib.md5(raw).digest())

    digest[6] &= 0x0F
    digest[6] |= 0x30

    digest[8] &= 0x3F
    digest[8] |= 0x80

    return str(uuid.UUID(bytes=bytes(digest)))


def get_player_whitelist_list() -> list[dict]:
    entries = load_whitelist_entries()
    known_players = get_known_players()
    online_mode = get_effective_online_mode()

    known_by_uuid = {
        str(player.get("player_uuid", "")).lower(): player
        for player in known_players
        if player.get("player_uuid")
    }

    result = []

    for entry in entries:
        player_uuid = str(entry.get("uuid", "")).strip()
        player_name = str(entry.get("name", "")).strip()

        if not player_uuid or not player_name:
            continue

        uuid_type = get_uuid_type(player_uuid)

        if online_mode and uuid_type != "online":
            continue

        if not online_mode and uuid_type != "offline":
            continue

        known_player = known_by_uuid.get(player_uuid.lower(), {})

        result.append({
            **known_player,
            "player_uuid": player_uuid,
            "player_name": player_name,
            "uuid_type": uuid_type,
            "whitelisted": True,
        })

    return result


def add_player_whitelist(
    player_uuid: str,
    player_name: str,
) -> dict:

    if is_server_ready():

        result = send_rcon_command(
            f"whitelist add {player_name}"
        )

        return {
            "success": True,
            "message": (
                f"已將 {player_name} 加入白名單"
            ),
            "result": result,
            "whitelisted": True,
        }

    entries = load_whitelist_entries()

    whitelist_uuid_set = load_whitelist_uuid_set()

    if player_uuid.lower() not in whitelist_uuid_set:

        entries.append({
            "uuid": player_uuid,
            "name": player_name,
        })

        save_whitelist_entries(entries)

    upsert_player_to_usercache(
        player_uuid=player_uuid,
        player_name=player_name,
    )

    return {
        "success": True,
        "message": (
            f"已將 {player_name} 加入白名單"
        ),
        "result": "offline-edit",
        "whitelisted": True,
    }


def remove_player_whitelist(
    player_uuid: str,
    player_name: str,
) -> dict:

    if is_server_ready():

        result = send_rcon_command(
            f"whitelist remove {player_name}"
        )

        return {
            "success": True,
            "message": (
                f"已將 {player_name} 移出白名單"
            ),
            "result": result,
            "whitelisted": False,
        }

    entries = load_whitelist_entries()

    entries = [
        entry
        for entry in entries
        if str(
            entry.get("uuid", "")
        ).lower() != player_uuid.lower()
    ]

    save_whitelist_entries(entries)

    return {
        "success": True,
        "message": (
            f"已將 {player_name} 移出白名單"
        ),
        "result": "offline-edit",
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
        uuid_type = player.get("uuid_type")

        if online_mode and uuid_type != "online":
            continue

        if not online_mode and uuid_type != "offline":
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

    if is_server_ready():
        result = send_rcon_command(
            f"whitelist add {player_name}"
        )

        return {
            "success": True,
            "message": f"已將 {player_name} 加入白名單",
            "result": result,
            "whitelisted": True,
        }

    online_mode = get_effective_online_mode()

    if online_mode:
        player_uuid = get_mojang_uuid(player_name)

        if not player_uuid:
            return {
                "success": False,
                "message": f"無法取得 {player_name} 的正版 UUID，請確認玩家名稱或網路連線",
            }
    else:
        player_uuid = get_offline_player_uuid(player_name)

    return add_player_whitelist(
        player_uuid=player_uuid,
        player_name=player_name,
    )


def delete_whitelist_candidate(
    player_uuid: str,
    player_name: str,
) -> dict:

    remove_player_from_usercache(player_uuid)

    return {
        "success": True,
        "message": (
            f"已刪除 {player_name} 的玩家紀錄"
        ),
    }


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