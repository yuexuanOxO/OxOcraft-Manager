import json
import hashlib
import uuid
import urllib.request

from backend.paths import MC_ROOT
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