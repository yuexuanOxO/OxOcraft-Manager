import json
from datetime import datetime

from backend.paths import MC_ROOT
from backend.rcon_service import send_rcon_command
from backend.db import update_player_op_since
from backend.server_monitor import get_cached_server_status
from backend.player_permissions.player_identity_service import get_known_players


OPS_FILE = MC_ROOT / "ops.json"


def load_ops_entries() -> list[dict]:
    if not OPS_FILE.exists():
        return []

    with OPS_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_ops_entries(entries: list[dict]) -> None:
    with OPS_FILE.open("w", encoding="utf-8") as file:
        json.dump(entries, file, ensure_ascii=False, indent=2)


def load_ops_uuid_set() -> set[str]:
    return {
        str(entry.get("uuid", "")).lower()
        for entry in load_ops_entries()
        if entry.get("uuid")
    }


def get_player_permission_list() -> list[dict]:
    players = get_known_players()
    ops_uuid_set = load_ops_uuid_set()

    result = []

    for player in players:
        player_uuid = str(player.get("player_uuid", "")).lower()

        result.append({
            **player,
            "op": player_uuid in ops_uuid_set,
        })

    return result


def is_server_ready() -> bool:
    status = get_cached_server_status()
    data = status.get("data", {})

    return data.get("state") == "ready" and data.get("online") is True


def set_player_op(player_uuid: str, player_name: str) -> dict:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if is_server_ready():
        result = send_rcon_command(f"op {player_name}")

        update_player_op_since(
            player_uuid=player_uuid,
            player_name=player_name,
            op_since=now,
        )

        return {
            "success": True,
            "message": f"已將 {player_name} 設為管理員",
            "result": result,
            "op": True,
        }

    entries = load_ops_entries()
    ops_uuid_set = load_ops_uuid_set()

    if player_uuid.lower() not in ops_uuid_set:
        entries.append({
            "uuid": player_uuid,
            "name": player_name,
            "level": 4,
            "bypassesPlayerLimit": False,
        })

        save_ops_entries(entries)

    update_player_op_since(
        player_uuid=player_uuid,
        player_name=player_name,
        op_since=now,
    )

    return {
        "success": True,
        "message": f"已將 {player_name} 設為管理員",
        "result": "offline-edit",
        "op": True,
    }


def remove_player_op(player_uuid: str, player_name: str) -> dict:
    if is_server_ready():
        result = send_rcon_command(f"deop {player_name}")

        return {
            "success": True,
            "message": f"已收回 {player_name} 的管理員權限",
            "result": result,
            "op": False,
        }

    entries = load_ops_entries()

    entries = [
        entry
        for entry in entries
        if str(entry.get("uuid", "")).lower() != player_uuid.lower()
    ]

    save_ops_entries(entries)

    return {
        "success": True,
        "message": f"已收回 {player_name} 的管理員權限",
        "result": "offline-edit",
        "op": False,
    }


def toggle_player_op(player_uuid: str, player_name: str) -> dict:
    ops_uuid_set = load_ops_uuid_set()

    if player_uuid.lower() in ops_uuid_set:
        return remove_player_op(player_uuid, player_name)

    return set_player_op(player_uuid, player_name)