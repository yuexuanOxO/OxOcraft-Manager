import json
from datetime import datetime

from backend.paths import MC_ROOT
from backend.rcon_service import send_rcon_command
from backend.server_monitor import get_cached_server_status
from backend.player_permissions.player_identity_service import get_known_players
from backend.server_effective_settings import load_effective_settings_snapshot
from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_account_type,
    get_current_usercache_players,
)

from backend.db import (
    update_player_op_since,
    delete_player_by_uuid,
    add_player_access_history,
)


OPS_FILE = MC_ROOT / "ops.json"


def load_ops_entries() -> list[dict]:
    if not OPS_FILE.exists():
        return []

    try:
        with OPS_FILE.open("r", encoding="utf-8") as file:
            content = file.read().strip()

        if not content:
            return []

        data = json.loads(content)

        if not isinstance(data, list):
            return []

        return data

    except json.JSONDecodeError:
        return []


def save_ops_entries(entries: list[dict]) -> None:
    with OPS_FILE.open("w", encoding="utf-8") as file:
        json.dump(entries, file, ensure_ascii=False, indent=2)


def load_ops_uuid_set() -> set[str]:
    return {
        str(entry.get("uuid", "")).lower()
        for entry in load_ops_entries()
        if entry.get("uuid")
    }


def remove_ops_entry_by_uuid(player_uuid: str) -> None:
    entries = load_ops_entries()

    entries = [
        entry
        for entry in entries
        if str(entry.get("uuid", "")).lower()
        != player_uuid.lower()
    ]

    save_ops_entries(entries)


def get_ops_entry_by_uuid(player_uuid: str) -> dict | None:
    for entry in load_ops_entries():
        if str(entry.get("uuid", "")).lower() == player_uuid.lower():
            return entry

    return None


def get_player_permission_list() -> list[dict]:
    entries = load_ops_entries()
    online_mode = get_effective_online_mode()

    if is_server_ready() and not online_mode:
        get_current_usercache_players()

    known_players = get_known_players()

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

        account_type = get_account_type(player_uuid)

        is_valid_for_current_mode = (
            account_type == "premium"
            if online_mode
            else account_type == "offline"
        )

        known_player = known_by_uuid.get(
            player_uuid.lower(),
            {}
        )

        result.append({
            **known_player,
            "player_uuid": player_uuid,
            "player_name": player_name,
            "account_type": account_type,
            "op": True,
            "valid_for_current_mode": is_valid_for_current_mode,
        })

    return result


def get_effective_online_mode() -> bool:
    snapshot = load_effective_settings_snapshot()
    properties = snapshot.get("properties", {})

    return str(
        properties.get("online-mode", "true")
    ).lower() == "true"


def is_server_ready() -> bool:
    status = get_cached_server_status()
    data = status.get("data", {})

    return data.get("state") == "ready" and data.get("online") is True


def can_add_op_by_name() -> bool:
    if not is_server_ready():
        return True

    return get_effective_online_mode()


def set_player_op(player_uuid: str, player_name: str) -> dict:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if is_server_ready():
        result = send_rcon_command(f"op {player_name}")

        update_player_op_since(
            player_uuid=player_uuid,
            player_name=player_name,
            op_since=now,
        )

        add_player_access_history(
            category="op",
            action="add",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=None,
            operator_name="OxOcraft",
            source="oxocraft_ui",
            detail=result,
        )

        return {
            "success": True,
            "message": f"已將 {player_name} 設為管理員",
            "result": result,
            "op": True,
            "op_since": now,
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

    add_player_access_history(
        category="op",
        action="add",
        target_uuid=player_uuid,
        target_name=player_name,
        account_type=None,
        operator_name="OxOcraft",
        source="oxocraft_ui",
        detail="offline-edit"
    )

    return {
        "success": True,
        "message": f"已將 {player_name} 設為管理員",
        "result": "offline-edit",
        "op": True,
        "op_since": now,
    }


def remove_player_op(player_uuid: str, player_name: str) -> dict:
    ops_entry = get_ops_entry_by_uuid(player_uuid)
    effective_name = str(
        ops_entry.get("name", player_name)
    ).strip() if ops_entry else player_name

    if is_server_ready():
        result = send_rcon_command(f"deop {effective_name}")

        still_op = player_uuid.lower() in load_ops_uuid_set()

        if still_op:
            return {
                "success": False,
                "message": f"嘗試收回 {effective_name} 的管理員權限，但 ops.json 仍保留該 UUID，請確認玩家名稱大小寫是否正確",
                "result": result,
                "op": True,
            }
        
        add_player_access_history(
            category="op",
            action="remove",
            target_uuid=player_uuid,
            target_name=effective_name,
            account_type=None,
            operator_name="OxOcraft",
            source="oxocraft_ui",
            detail=result,
        )

        return {
            "success": True,
            "message": f"已收回 {effective_name} 的管理員權限",
            "result": result,
            "op": False,
        }

    remove_ops_entry_by_uuid(player_uuid)

    add_player_access_history(
        category="op",
        action="remove",
        target_uuid=player_uuid,
        target_name=effective_name,
        account_type=None,
        operator_name="OxOcraft",
        source="oxocraft_ui",
        detail="offline-edit",
    )

    return {
        "success": True,
        "message": f"已收回 {effective_name} 的管理員權限",
        "result": "offline-edit",
        "op": False,
    }


def toggle_player_op(player_uuid: str, player_name: str) -> dict:

    online_mode = get_effective_online_mode()

    if (
        is_server_ready()
        and not online_mode
    ):

        known_players = get_known_players()

        known_uuid_set = {
            str(player.get("player_uuid", "")).lower()
            for player in known_players
        }

        if player_uuid.lower() not in known_uuid_set:
            return {
                "success": False,
                "message": (
                    "離線模式且伺服器在線時，"
                    "只能對已加入過伺服器的玩家設定 OP"
                ),
            }


    ops_uuid_set = load_ops_uuid_set()

    if player_uuid.lower() in ops_uuid_set:
        return remove_player_op(player_uuid, player_name)

    return set_player_op(player_uuid, player_name)


def get_player_permission_candidate_list() -> list[dict]:
    ops_uuid_set = load_ops_uuid_set()
    online_mode = get_effective_online_mode()

    if is_server_ready() and not online_mode:
        players = get_current_usercache_players()
    else:
        players = get_known_players()

    result = []

    for player in players:
        account_type = player.get("account_type")

        if online_mode and account_type != "premium":
            continue

        if not online_mode and account_type != "offline":
            continue

        player_uuid = str(player.get("player_uuid", "")).lower()

        if player_uuid in ops_uuid_set:
            continue

        result.append({
            **player,
            "op": False,
        })

    return result


def delete_permission_candidate(
    player_uuid: str,
    player_name: str,
) -> dict:

    delete_player_by_uuid(player_uuid)

    return {
        "success": True,
        "message": f"已刪除 {player_name} 的玩家紀錄",
    }

