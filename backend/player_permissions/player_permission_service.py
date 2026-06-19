import json
from datetime import datetime

from backend.paths import MC_ROOT
from backend.rcon_service import send_rcon_command
from backend.server_monitor import get_cached_server_status
from backend.server_effective_settings import load_effective_settings_snapshot
from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_account_type,
    get_current_usercache_players,
)

from backend.db import (
    sync_player_op_flags_from_uuid_set,
    sync_player_op_entries_from_ops_entries,
    get_op_players_from_db,
    upsert_player_identity,
    update_player_op_since,
)

from backend.player_permissions.player_access_history_service import (
    record_player_access,
)

OPS_FILE = MC_ROOT / "ops.json"


_recent_ui_op_command: dict | None = None


def mark_recent_ui_op_command(
    action: str,
    player_uuid: str,
    player_name: str,
) -> None:
    global _recent_ui_op_command

    _recent_ui_op_command = {
        "category": "op",
        "action": action,  # add / remove
        "target_uuid": str(player_uuid or "").lower(),
        "target_name": str(player_name or "").lower(),
    }


def pop_recent_ui_op_command_if_match(
    action: str,
    player_uuid: str | None = None,
    player_name: str | None = None,
) -> bool:
    global _recent_ui_op_command

    if not _recent_ui_op_command:
        return False

    expected_action = _recent_ui_op_command.get("action")
    expected_uuid = _recent_ui_op_command.get("target_uuid")
    expected_name = _recent_ui_op_command.get("target_name")

    actual_uuid = str(player_uuid or "").lower()
    actual_name = str(player_name or "").lower()

    matched = (
        expected_action == action
        and (
            (actual_uuid and expected_uuid == actual_uuid)
            or (actual_name and expected_name == actual_name)
        )
    )

    if matched:
        _recent_ui_op_command = None

    return matched


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
    online_mode = get_effective_online_mode()

    if is_server_ready():
        players = get_op_players_from_db()

        result = []

        for player in players:
            player_uuid = str(player.get("player_uuid", "")).strip()
            account_type = player.get("account_type") or get_account_type(player_uuid)

            is_valid_for_current_mode = (
                account_type == "premium"
                if online_mode
                else account_type == "offline"
            )

            result.append({
                **player,
                "op": True,
                "valid_for_current_mode": is_valid_for_current_mode,
            })

        return result

    entries = load_ops_entries()
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

        try:
            op_level = int(entry.get("level", 4))
        except (TypeError, ValueError):
            op_level = 4

        op_level = max(1, min(op_level, 4))

        result.append({
            **known_player,
            "player_uuid": player_uuid,
            "player_name": player_name,
            "account_type": account_type,
            "op": True,
            "op_level": op_level,
            "op_bypasses_player_limit": bool(
                entry.get("bypassesPlayerLimit", False)
            ),
            "valid_for_current_mode": is_valid_for_current_mode,
        })

    return result


def get_effective_online_mode() -> bool:
    snapshot = load_effective_settings_snapshot()
    properties = snapshot.get("properties", {})

    return str(
        properties.get("online-mode", "true")
    ).lower() == "true"


def get_effective_op_permission_level() -> int:
    snapshot = load_effective_settings_snapshot()
    properties = snapshot.get("properties", {})

    try:
        level = int(
            properties.get("op-permission-level", 4)
        )
    except (TypeError, ValueError):
        level = 4

    return max(1, min(level, 4))


def build_op_history_detail(
    op_level: int | None = None,
    op_bypasses_player_limit: bool = False,
) -> str:
    try:
        level = int(op_level or 4)
    except (TypeError, ValueError):
        level = 4

    level = max(1, min(level, 4))

    return json.dumps(
        {
            "op_level": level,
            "op_bypasses_player_limit": bool(
                op_bypasses_player_limit
            ),
        },
        ensure_ascii=False,
    )


def is_server_ready() -> bool:
    status = get_cached_server_status()
    data = status.get("data", {})

    return data.get("state") == "ready" and data.get("online") is True


def can_add_op_by_name() -> bool:
    if not is_server_ready():
        return True

    return get_effective_online_mode()


def sync_ops_json_to_players(source: str = "unknown") -> None:
    sync_player_op_entries_from_ops_entries(
        load_ops_entries()
    )



def sync_ops_json_to_players_if_server_offline(
    source: str = "offline_json"
) -> None:
    if is_server_ready():
        return

    sync_ops_json_to_players(source=source)


def set_player_op(
    player_uuid: str,
    player_name: str,
    op_level: int | None = None,
    op_bypasses_player_limit: bool = False,
) -> dict:

    account_type = get_account_type(player_uuid)

    if is_server_ready():
        effective_op_level = get_effective_op_permission_level()
    else:
        try:
            effective_op_level = int(op_level or 4)
        except (TypeError, ValueError):
            effective_op_level = 4

    effective_op_level = max(1, min(effective_op_level, 4))

    effective_bypasses_player_limit = (
        False
        if is_server_ready()
        else bool(op_bypasses_player_limit)
    )

    if player_uuid.lower() in load_ops_uuid_set():
        return {
            "success": False,
            "message": f"{player_name} 已經是管理員，不能重複加入。",
            "op": True,
        }

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    upsert_player_identity(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
    )

    if is_server_ready():
        mark_recent_ui_op_command(
            action="add",
            player_uuid=player_uuid,
            player_name=player_name,
        )

        result = send_rcon_command(f"op {player_name}")

        sync_ops_json_to_players(source="rcon_ui")

        update_player_op_since(
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=account_type,
            op_since=now,
            op_level=effective_op_level,
            op_bypasses_player_limit=effective_bypasses_player_limit,
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
            "level": effective_op_level,
            "bypassesPlayerLimit": effective_bypasses_player_limit,
        })

        save_ops_entries(entries)

    update_player_op_since(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        op_since=now,
        op_level=effective_op_level,
        op_bypasses_player_limit=effective_bypasses_player_limit,
    )

    record_player_access(
        category="op",
        action="add",
        target_uuid=player_uuid,
        target_name=player_name,
        account_type=account_type,
        operator_name="OxOcraft",
        source="offline_ui_edit",
        detail=build_op_history_detail(
            op_level=effective_op_level,
            op_bypasses_player_limit=effective_bypasses_player_limit,
        ),
    )

    update_player_op_since(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        op_since=now,
        op_level=effective_op_level,
        op_bypasses_player_limit=effective_bypasses_player_limit,
    )

    return {
        "success": True,
        "message": f"已將 {player_name} 加入待生效管理員清單",
        "result": "offline-edit",
        "op": True,
        "op_since": None,
    }


def remove_player_op(player_uuid: str, player_name: str) -> dict:
    ops_entry = get_ops_entry_by_uuid(player_uuid)
    effective_name = str(
        ops_entry.get("name", player_name)
    ).strip() if ops_entry else player_name

    upsert_player_identity(
        player_uuid=player_uuid,
        player_name=effective_name,
        account_type=get_account_type(player_uuid),
    )

    if is_server_ready():
        mark_recent_ui_op_command(
            action="remove",
            player_uuid=player_uuid,
            player_name=effective_name,
        )

        result = send_rcon_command(f"deop {effective_name}")

        sync_ops_json_to_players(source="rcon_ui")

        still_op = player_uuid.lower() in load_ops_uuid_set()

        if still_op:
            return {
                "success": False,
                "message": f"嘗試收回 {effective_name} 的管理員權限，但 ops.json 仍保留該 UUID，請確認玩家名稱大小寫是否正確",
                "result": result,
                "op": True,
            }

        return {
            "success": True,
            "message": f"已收回 {effective_name} 的管理員權限",
            "result": result,
            "op": False,
        }

    remove_ops_entry_by_uuid(player_uuid)

    record_player_access(
        category="op",
        action="remove",
        target_uuid=player_uuid,
        target_name=effective_name,
        account_type=get_account_type(player_uuid),
        operator_name="OxOcraft",
        source="offline_ui_edit",
        detail="{}",
    )

    return {
        "success": True,
        "message": f"已將 {effective_name} 從待生效管理員清單移除",
        "result": "offline-edit",
        "op": False,
    }


def toggle_player_op(
    player_uuid: str,
    player_name: str,
    op_level: int | None = None,
    op_bypasses_player_limit: bool = False,
) -> dict:

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

    return set_player_op(
        player_uuid,
        player_name,
        op_level=op_level,
        op_bypasses_player_limit=op_bypasses_player_limit,
    )


def get_player_permission_candidate_list() -> list[dict]:
    ops_uuid_set = load_ops_uuid_set()
    online_mode = get_effective_online_mode()

    if is_server_ready() and not online_mode:
        players = get_current_usercache_players()
    else:
        players = get_known_players()

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

        if player_uuid in ops_uuid_set:
            continue

        result.append({
            **player,
            "op": False,
        })

    return result


