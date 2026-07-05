import json
from datetime import datetime

from backend.paths import MC_ROOT
from backend.server_monitor import get_cached_server_status
from backend.server_effective_settings import load_effective_settings_snapshot
from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_account_type,
    get_mojang_player_profile,
)

from backend.db import (
    sync_player_op_entries_from_ops_entries,
    upsert_player_identity,
    update_player_op_since,
)

from backend.player_permissions.player_access_history_service import (
    record_player_access,
)

from backend.management_api.state import get_management_state
from backend.management_api.monitor import get_management_client
from backend.management_api.operators import (
    management_add_operator,
    management_remove_operator,
    management_list_operators,
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


def build_permission_list_from_management_operators(
    operators: list[dict],
) -> list[dict]:
    online_mode = get_effective_online_mode()
    known_players = get_known_players()
    online_uuid_set = get_online_uuid_set()

    known_by_uuid = {
        str(player.get("player_uuid", "")).lower(): player
        for player in known_players
        if player.get("player_uuid")
    }

    result = []

    for item in operators:
        if not isinstance(item, dict):
            continue

        player = item.get("player")

        if not isinstance(player, dict):
            continue

        player_uuid = str(player.get("id", "")).strip()
        player_name = str(player.get("name", "")).strip()

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
            op_level = int(
                item.get("permissionLevel", 4)
            )
        except (TypeError, ValueError):
            op_level = 4

        op_level = max(1, min(op_level, 4))

        merged_player = {
            **known_player,
            "player_uuid": player_uuid,
            "player_name": player_name,
            "account_type": account_type,
            "op": True,
            "op_level": op_level,
            "op_bypasses_player_limit": bool(
                item.get("bypassesPlayerLimit", False)
            ),
            "valid_for_current_mode": is_valid_for_current_mode,
        }

        result.append(
            build_permission_player_state(
                merged_player,
                online_mode,
                online_uuid_set,
            )
        )

    return result


def get_player_permission_list() -> list[dict]:
    online_mode = get_effective_online_mode()

    if is_server_ready():
        client = get_management_client()
        operators = management_list_operators(client)

        return build_permission_list_from_management_operators(
            operators
        )

    entries = load_ops_entries()
    known_players = get_known_players()
    online_uuid_set = get_online_uuid_set()

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

        merged_player = {
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
        }

        result.append(
            build_permission_player_state(
                merged_player,
                online_mode,
                online_uuid_set,
            )
        )

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


def build_permission_player_state(
    player: dict,
    online_mode: bool,
    online_uuid_set: set[str] | None = None,
) -> dict:
    online_uuid_set = online_uuid_set or set()

    player_uuid = str(
        player.get("player_uuid", "")
    ).lower()

    is_online = player_uuid in online_uuid_set

    in_usercache = bool(
        int(player.get("in_usercache", 0) or 0)
    )

    if is_online:
        permission_state = "online"
        permission_online_editable = True
    elif online_mode:
        permission_state = "offline"
        permission_online_editable = True
    elif in_usercache:
        permission_state = "offline_usercache"
        permission_online_editable = True
    else:
        permission_state = "offline_only"
        permission_online_editable = False

    return {
        **player,
        "in_usercache": in_usercache,
        "permission_state": permission_state,
        "permission_online_editable": permission_online_editable,
    }


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


def get_online_uuid_set() -> set[str]:
    if not is_server_ready():
        return set()

    state = get_management_state()

    return {
        str(player.id or "").lower()
        for player in state.players
        if player and player.id
    }


def sync_ops_json_to_players() -> None:
    sync_player_op_entries_from_ops_entries(
        load_ops_entries()
    )


def sync_ops_json_to_players_if_server_offline() -> None:
    if is_server_ready():
        return

    sync_ops_json_to_players()


def set_player_op(
    player_uuid: str,
    player_name: str,
    op_level: int | None = None,
    op_bypasses_player_limit: bool = False,
) -> dict:

    account_type = get_account_type(player_uuid)

    try:
        effective_op_level = int(op_level or 4)
    except (TypeError, ValueError):
        effective_op_level = 4

    effective_op_level = max(1, min(effective_op_level, 4))

    effective_bypasses_player_limit = bool(
        op_bypasses_player_limit
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
        record_player_access(
            category="op",
            action="add",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=account_type,
            operator_name="OxOcraft",
            source="online_ui_manage",
            detail=build_op_history_detail(
                op_level=effective_op_level,
                op_bypasses_player_limit=
                    effective_bypasses_player_limit,
            ),
        )

        client = get_management_client()

        result = management_add_operator(
            client=client,
            player_uuid=player_uuid,
            player_name=player_name,
            permission_level=effective_op_level,
            bypasses_player_limit=effective_bypasses_player_limit,
        )

        sync_management_operators_to_players(result)

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
    
    if not can_edit_op_online(player_uuid):
        return {
            "success": False,
            "message": (
                f"{player_name} 不在目前 Minecraft usercache 中，"
                "離線模式下無法在 Server 在線時修改此玩家 OP，"
                "請關閉伺服器後使用離線設定模式。"
            ),
            "op": False,
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


def can_edit_op_online(
    player_uuid: str,
) -> bool:
    if not is_server_ready():
        return True

    online_mode = get_effective_online_mode()

    if online_mode:
        return True

    known_players = get_known_players()

    for player in known_players:
        if str(player.get("player_uuid", "")).lower() == player_uuid.lower():
            return bool(int(player.get("in_usercache", 0) or 0))

    return False


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
        record_player_access(
            category="op",
            action="remove",
            target_uuid=player_uuid,
            target_name=effective_name,
            account_type=get_account_type(player_uuid),
            operator_name="OxOcraft",
            source="online_ui_manage",
            detail="{}",
        )

        client = get_management_client()

        result = management_remove_operator(
            client=client,
            player_uuid=player_uuid,
            player_name=effective_name,
        )

        sync_management_operators_to_players(result)

        return {
            "success": True,
            "message": f"已收回 {effective_name} 的管理員權限",
            "result": result,
            "op": False,
        }

    if not can_edit_op_online(player_uuid):
        return {
            "success": False,
            "message": (
                f"{effective_name} 不在目前 Minecraft usercache 中，"
                "離線模式下無法在 Server 在線時移除此玩家 OP，"
                "請關閉伺服器後使用離線設定模式。"
            ),
            "op": True,
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

    ops_uuid_set = load_ops_uuid_set()

    if player_uuid.lower() in ops_uuid_set:
        return remove_player_op(player_uuid, player_name)

    return set_player_op(
        player_uuid,
        player_name,
        op_level=op_level,
        op_bypasses_player_limit=op_bypasses_player_limit,
    )


def get_online_player_permission_candidates() -> list[dict]:
    state = get_management_state()

    result = []

    for player in state.players:
        player_uuid = str(player.id or "").strip()
        player_name = str(player.name or "").strip()

        if not player_uuid or not player_name:
            continue

        result.append({
            "player_uuid": player_uuid,
            "player_name": player_name,
            "account_type": get_account_type(player_uuid),
            "show_in_player_candidates": 1,
            "online": True,
            "op": False,
        })

    return result


def get_player_permission_candidate_list() -> list[dict]:
    online_mode = get_effective_online_mode()
    online_uuid_set = get_online_uuid_set()

    if is_server_ready():
        client = get_management_client()
        operators = management_list_operators(client)

        op_uuid_set = {
            str(item.get("player", {}).get("id", "")).lower()
            for item in operators
            if isinstance(item, dict)
        }

        players = get_known_players()

    else:
        op_uuid_set = load_ops_uuid_set()
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

        if is_server_ready() and not online_mode:
            if int(player.get("in_usercache", 0) or 0) != 1:
                continue

        player_uuid = str(player.get("player_uuid", "")).lower()

        if player_uuid in op_uuid_set:
            continue

        result.append(
            build_permission_player_state(
                {
                    **player,
                    "op": False,
                },
                online_mode,
                online_uuid_set,
            )
        )

    return result


def sync_management_operators_to_players(
    operators: list[dict],
) -> None:
    entries = []

    for item in operators:
        if not isinstance(item, dict):
            continue

        player = item.get("player")

        if not isinstance(player, dict):
            continue

        player_uuid = str(player.get("id", "")).strip()
        player_name = str(player.get("name", "")).strip()

        if not player_uuid or not player_name:
            continue

        entries.append({
            "uuid": player_uuid,
            "name": player_name,
            "level": item.get("permissionLevel", 4),
            "bypassesPlayerLimit": bool(
                item.get("bypassesPlayerLimit", False)
            ),
        })

    sync_player_op_entries_from_ops_entries(entries)


def resolve_op_candidate_by_name(
    player_name: str,
) -> dict:
    player_name = str(player_name or "").strip()

    if not player_name:
        return {
            "success": False,
            "message": "請輸入玩家名稱",
        }


    if not get_effective_online_mode():
        return {
            "success": False,
            "message": "離線版在線管理只能選擇 usercache 中的玩家",
        }

    known_players = get_known_players()

    for player in known_players:
        if (
            str(player.get("account_type", "")) == "premium"
            and str(player.get("player_name", "")).lower()
            == player_name.lower()
        ):
            return {
                "success": True,
                "message": "",
                "already_exists": True,
                "player": build_permission_player_state(
                    player,
                    online_mode=True,
                ),
            }

    try:
        profile = get_mojang_player_profile(player_name)

        if profile:
            player_uuid = profile["uuid"]
            player_name = profile["name"]
        else:
            player_uuid = None

    except Exception as error:
        print("[Permission] resolve op candidate failed:", error)
        player_uuid = None

    if not player_uuid:
        return {
            "success": False,
            "message": f"找不到正版玩家 {player_name}",
        }

    upsert_player_identity(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type="premium",
    )

    player = {
        "player_uuid": player_uuid,
        "player_name": player_name,
        "account_type": "premium",
        "show_in_player_candidates": 1,
        "op": False,
        "in_usercache": 0,
        "is_online": False,
    }

    return {
        "success": True,
        "message": "",
        "already_exists": True,
        "player": build_permission_player_state(
            player,
            online_mode=True,
            online_uuid_set=get_online_uuid_set(),
        ),
    }