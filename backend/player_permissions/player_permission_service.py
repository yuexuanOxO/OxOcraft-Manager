import json
from datetime import datetime

from backend.paths import MC_ROOT
from backend.server_monitor import get_cached_server_status
from backend.notification_service import create_notification
from backend.server_effective_settings import load_effective_settings_snapshot
from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_account_type,
    resolve_player_identity_by_name,
)

from backend.db import (
    sync_player_op_entries_from_ops_entries,
    upsert_player_identity,
    update_player_op_since,
    get_op_players_from_db,
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

from backend.player_permissions.player_json_file_service import (
    load_player_json_file,
)

from backend.player_permissions.player_json_validator import (
    validate_cached_player_json_entries,
    split_duplicate_valid_player_entries,
)


OPS_FILE = MC_ROOT / "ops.json"


def load_ops_file() -> dict:
    return load_player_json_file(
        OPS_FILE
    )


def validate_ops_entries(
    entries: list,
    online_mode: bool,
) -> dict:
    validation_result = (
        validate_cached_player_json_entries(
            entries=entries,
            online_mode=online_mode,
            source="ops",
            schema_type="ops",
        )
    )

    duplicate_result = (
        split_duplicate_valid_player_entries(
            validation_result["valid"]
        )
    )

    duplicate_uuid_set = {
        str(
            item["validation"].get(
                "player_uuid",
                "",
            )
        ).strip().lower()

        for item in duplicate_result[
            "duplicate_entries"
        ]

        if item["validation"].get(
            "player_uuid"
        )
    }

    duplicate_entries = [
        item
        for item in validation_result[
            "valid"
        ]
        if (
            str(
                item["validation"].get(
                    "player_uuid",
                    "",
                )
            ).strip().lower()
            in duplicate_uuid_set
        )
    ]

    valid_entries = [
        item
        for item in duplicate_result[
            "unique_entries"
        ]
        if (
            str(
                item["validation"].get(
                    "player_uuid",
                    "",
                )
            ).strip().lower()
            not in duplicate_uuid_set
        )
    ]

    return {
        "valid_entries":valid_entries,
        "duplicate_entries":duplicate_entries,
        "duplicate_uuid_set":duplicate_uuid_set,
        "invalid_entries":validation_result["invalid"],
        "unavailable_entries":validation_result["verification_unavailable"],
    }


def load_validated_ops() -> dict:
    file_result = load_ops_file()

    if file_result["status"] != "valid":
        return {
            "status": "file_invalid",

            "valid_uuid_set": set(),
            "unavailable_uuid_set": set(),
            "duplicate_uuid_set": set(),

            "valid_entries": [],
            "invalid_entries": [],
            "unavailable_entries": [],
            "duplicate_entries": [],

            "error_code":
                file_result.get(
                    "error_code"
                ),

            "message":
                file_result.get(
                    "message",
                    ""
                ),
        }

    online_mode = (
        get_effective_online_mode()
    )

    validated = validate_ops_entries(
        entries=file_result["entries"],
        online_mode=online_mode,
    )

    valid_uuid_set = {
        str(
            item["validation"].get(
                "player_uuid",
                ""
            )
        ).strip().lower()

        for item in validated[
            "valid_entries"
        ]

        if item["validation"].get(
            "player_uuid"
        )
    }

    unavailable_uuid_set = {
        str(
            item["validation"].get(
                "player_uuid",
                ""
            )
        ).strip().lower()

        for item in validated[
            "unavailable_entries"
        ]

        if item["validation"].get(
            "player_uuid"
        )
    }

    return {
        "status": "valid",

        "valid_uuid_set":
            valid_uuid_set,

        "unavailable_uuid_set":
            unavailable_uuid_set,

        "duplicate_uuid_set":
            validated["duplicate_uuid_set"],

        "valid_entries":
            validated["valid_entries"],

        "invalid_entries":
            validated["invalid_entries"],

        "unavailable_entries":
            validated[
                "unavailable_entries"
            ],

        "duplicate_entries":
            validated[
                "duplicate_entries"
            ],

        "error_code": None,
        "message": "",
    }


def get_ops_mutation_error(
    ops_result: dict | None = None,
) -> dict | None:
    if ops_result is None:
        ops_result = (
            load_validated_ops()
        )

    if ops_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "管理員參數檔發生錯誤，"
                "請先修復 ops.json"
            ),
            "error_code":
                ops_result.get(
                    "error_code"
                ),
            "data_status":
                "file_invalid",
        }

    if ops_result["invalid_entries"]:
        return {
            "success": False,
            "message": (
                "管理員清單中有玩家資料驗證失敗，"
                "請先處理錯誤資料"
            ),
            "error_code":
                "invalid_player_entries",
            "data_status":
                "entry_invalid",
        }

    if ops_result["unavailable_entries"]:
        return {
            "success": False,
            "message": (
                "管理員清單中有玩家資料目前無法驗證，"
                "請稍後重新驗證後再操作"
            ),
            "error_code":
                "player_verification_unavailable",
            "data_status":
                "verification_unavailable",
        }

    if ops_result["duplicate_entries"]:
        return {
            "success": False,
            "message": (
                "管理員清單中有重複玩家資料，"
                "請先處理重複資料"
            ),
            "error_code":
                "duplicate_player_entries",
            "data_status":
                "entry_duplicate",
        }

    return None


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


def build_management_operator_uuid_set(
    operators: list[dict],
) -> set[str]:
    return {
        str(
            item.get(
                "player",
                {},
            ).get(
                "id",
                "",
            )
        ).strip().lower()

        for item in operators

        if (
            isinstance(item, dict)
            and isinstance(
                item.get("player"),
                dict,
            )
            and item.get(
                "player",
                {},
            ).get("id")
        )
    }


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


def build_permission_list_from_ops_entries(
    entries: list[dict],
) -> list[dict]:
    online_mode = get_effective_online_mode()
    known_players = get_known_players()
    online_uuid_set = get_online_uuid_set()

    known_by_uuid = {
        str(
            player.get(
                "player_uuid",
                "",
            )
        ).lower(): player
        for player in known_players
        if player.get("player_uuid")
    }

    result = []

    for entry in entries:
        player_uuid = str(
            entry.get("uuid", "")
        ).strip()

        player_name = str(
            entry.get("name", "")
        ).strip()

        if not player_uuid or not player_name:
            continue

        account_type = (
            get_account_type(
                player_uuid
            )
        )

        is_valid_for_current_mode = (
            account_type == "premium"
            if online_mode
            else account_type == "offline"
        )

        known_player = (
            known_by_uuid.get(
                player_uuid.lower(),
                {},
            )
        )

        try:
            op_level = int(
                entry.get(
                    "level",
                    4,
                )
            )
        except (TypeError, ValueError):
            op_level = 4

        op_level = max(
            1,
            min(op_level, 4),
        )

        merged_player = {
            **known_player,
            "player_uuid":
                player_uuid,
            "player_name":
                player_name,
            "account_type":
                account_type,
            "op": True,
            "op_level":
                op_level,
            "op_bypasses_player_limit":
                bool(
                    entry.get(
                        "bypassesPlayerLimit",
                        False,
                    )
                ),
            "valid_for_current_mode":
                is_valid_for_current_mode,
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
    if is_server_ready():
        client = (
            get_management_client()
        )

        operators = (
            management_list_operators(
                client
            )
        )

        return (
            build_permission_list_from_management_operators(
                operators
            )
        )

    return (
        build_permission_list_from_ops_entries(
            load_ops_entries()
        )
    )


def get_player_permission_data() -> dict:
    validated = (
        load_validated_ops()
    )

    if validated["status"] != "valid":
        return {
            **validated,
            "players": [],
        }

    if is_server_ready():
        players = (
            get_player_permission_list()
        )

        duplicate_uuid_set = (
            validated[
                "duplicate_uuid_set"
            ]
        )

        if duplicate_uuid_set:
            players = [
                player
                for player in players
                if (
                    str(
                        player.get(
                            "player_uuid",
                            "",
                        )
                    ).strip().lower()
                    not in duplicate_uuid_set
                )
            ]

    else:
        entries = [
            item["entry"]
            for item in validated[
                "valid_entries"
            ]
        ]

        players = (
            build_permission_list_from_ops_entries(
                entries
            )
        )

    return {
        **validated,
        "players": players,
    }


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


def normalize_op_level(value) -> int:
    try:
        level = int(value or 4)
    except (TypeError, ValueError):
        level = 4

    return max(1, min(level, 4))


def build_op_update_history_detail(
    old_op_level: int,
    new_op_level: int,
    old_bypasses_player_limit: bool,
    new_bypasses_player_limit: bool,
) -> str:
    return json.dumps(
        {
            "old_op_level": normalize_op_level(old_op_level),
            "new_op_level": normalize_op_level(new_op_level),
            "old_op_bypasses_player_limit": bool(
                old_bypasses_player_limit
            ),
            "new_op_bypasses_player_limit": bool(
                new_bypasses_player_limit
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


def sync_ops_json_to_players(
    operator_name: str = "Unknown",
    source: str = "minecraft_json",
    detail: str = "ops.json sync",
    validated: dict | None = None,
) -> dict:
    if validated is None:
        validated = (
            load_validated_ops()
        )

    if validated["status"] != "valid":
        return {
            "added_count": 0,
            "removed_count": 0,
            "updated_count": 0,
            "sync_status":
                "file_invalid",
            "error_code":
                validated.get(
                    "error_code"
                ),
        }

    if validated["invalid_entries"]:
        return {
            "added_count": 0,
            "removed_count": 0,
            "updated_count": 0,
            "sync_status":
                "validation_blocked",
            "error_code":
                "invalid_player_entries",
        }

    if validated["unavailable_entries"]:
        return {
            "added_count": 0,
            "removed_count": 0,
            "updated_count": 0,
            "sync_status":
                "validation_blocked",
            "error_code":
                "player_verification_unavailable",
        }

    if validated["duplicate_entries"]:
        return {
            "added_count": 0,
            "removed_count": 0,
            "updated_count": 0,
            "sync_status":
                "validation_blocked",
            "error_code":
                "duplicate_player_entries",
        }

    before_players = (
        get_op_players_from_db()
    )

    after_entries = [
        item["entry"]
        for item in validated[
            "valid_entries"
        ]
    ]

    before_by_uuid = {
        str(player.get("player_uuid", "")).lower(): player
        for player in before_players
        if player.get("player_uuid")
    }

    after_by_uuid = {
        str(entry.get("uuid", "")).lower(): entry
        for entry in after_entries
        if entry.get("uuid")
    }

    before_uuid_set = set(before_by_uuid.keys())
    after_uuid_set = set(after_by_uuid.keys())

    added_uuid_set = after_uuid_set - before_uuid_set
    removed_uuid_set = before_uuid_set - after_uuid_set
    common_uuid_set = before_uuid_set & after_uuid_set

    added_count = 0
    removed_count = 0
    updated_count = 0

    for player_uuid in added_uuid_set:
        entry = after_by_uuid[player_uuid]

        op_level = normalize_op_level(
            entry.get("level", 4)
        )

        bypasses_player_limit = bool(
            entry.get("bypassesPlayerLimit", False)
        )

        record_player_access(
            category="op",
            action="add",
            target_uuid=entry.get("uuid"),
            target_name=entry.get("name", "未知玩家"),
            account_type=get_account_type(entry.get("uuid")),
            operator_name=operator_name,
            source=source,
            detail=build_op_history_detail(
                op_level=op_level,
                op_bypasses_player_limit=bypasses_player_limit,
            ),
        )

        added_count += 1

    for player_uuid in removed_uuid_set:
        player = before_by_uuid[player_uuid]

        record_player_access(
            category="op",
            action="remove",
            target_uuid=player.get("player_uuid"),
            target_name=player.get("player_name", "未知玩家"),
            account_type=player.get("account_type"),
            operator_name=operator_name,
            source=source,
            detail="{}",
        )

        removed_count += 1

    for player_uuid in common_uuid_set:
        before = before_by_uuid[player_uuid]
        after = after_by_uuid[player_uuid]

        old_level = normalize_op_level(
            before.get("op_level", 4)
        )

        new_level = normalize_op_level(
            after.get("level", 4)
        )

        old_bypass = bool(
            int(before.get("op_bypasses_player_limit", 0) or 0)
        )

        new_bypass = bool(
            after.get("bypassesPlayerLimit", False)
        )

        if old_level == new_level and old_bypass == new_bypass:
            continue

        record_player_access(
            category="op",
            action="update",
            target_uuid=after.get("uuid"),
            target_name=after.get(
                "name",
                before.get("player_name", "未知玩家")
            ),
            account_type=before.get("account_type")
                or get_account_type(after.get("uuid")),
            operator_name=operator_name,
            source=source,
            detail=build_op_update_history_detail(
                old_op_level=old_level,
                new_op_level=new_level,
                old_bypasses_player_limit=old_bypass,
                new_bypasses_player_limit=new_bypass,
            ),
        )

        updated_count += 1

    sync_player_op_entries_from_ops_entries(
        after_entries
    )

    if (
        source == "minecraft_json"
        and (
            added_count > 0
            or removed_count > 0
        )
    ):
        create_notification(
            title="管理員資料同步改動",
            message=(
                f"資料同步重新載入管理員資料，"
                f"新增 {added_count} 位，"
                f"移除 {removed_count} 位。"
            ),
            type="info",
            source="player_permission",
        )

    return {
        "added_count": added_count,
        "removed_count": removed_count,
        "updated_count": updated_count,
        "sync_status": "success",
        "error_code": None,
    }

def sync_ops_json_to_players_if_server_offline() -> None:
    if is_server_ready():
        return

    sync_ops_json_to_players(
        operator_name="Unknown",
        source="minecraft_json",
        detail="offline ops.json sync",
    )


def set_player_op(
    player_uuid: str,
    player_name: str,
    op_level: int | None = None,
    op_bypasses_player_limit: bool = False,
    history_source: str | None = None,
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

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    upsert_player_identity(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
    )

    if is_server_ready():
        client = (get_management_client())

        operators = (management_list_operators(client))

        online_op_uuid_set = (
            build_management_operator_uuid_set(
                operators
            )
        )

        if (
            player_uuid.lower()
            in online_op_uuid_set
        ):
            return {
                "success": False,
                "message": (
                    f"{player_name} 已經是管理員，"
                    "不能重複加入。"
                ),
                "op": True,
            }

        record_player_access(
            category="op",
            action="add",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=account_type,
            operator_name="OxOcraft",
            source=(
                history_source
                or "online_ui_manage"
            ),
            detail=build_op_history_detail(
                op_level=effective_op_level,
                op_bypasses_player_limit=
                    effective_bypasses_player_limit,
            ),
        )

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

    ops_result = (
        load_validated_ops()
    )

    mutation_error = (
        get_ops_mutation_error(
            ops_result
        )
    )

    if mutation_error:
        return mutation_error

    if (
        player_uuid.lower()
        in ops_result["valid_uuid_set"]
    ):
        return {
            "success": False,
            "message": (
                f"{player_name} 已經是管理員，"
                "不能重複加入。"
            ),
            "op": True,
        }

    entries = [
        item["entry"]
        for item in ops_result[
            "valid_entries"
        ]
    ]

    # UI 寫入前，先將原本已存在的
    # ops.json 外部變更同步進 DB / History。
    sync_ops_json_to_players(
        operator_name="Unknown",
        source="minecraft_json",
        detail=(
            "ops.json sync before "
            "UI add operation"
        ),
        validated=ops_result,
    )

    entries.append({
        "uuid": player_uuid,
        "name": player_name,
        "level":
            effective_op_level,
        "bypassesPlayerLimit":
            effective_bypasses_player_limit,
    })

    save_ops_entries(entries)

    # UI 寫完後直接更新 DB 狀態，
    # History 仍由下面 UI 操作另外記錄。
    sync_player_op_entries_from_ops_entries(
        entries
    )

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


def remove_player_op(
    player_uuid: str,
    player_name: str,
    history_source: str | None = None,
) -> dict:

    effective_name = str(
        player_name or ""
    ).strip()

    # ==================================================
    # Server Ready
    # Management API 才是目前 OP 狀態來源
    # ==================================================

    if is_server_ready():
        upsert_player_identity(
            player_uuid=player_uuid,
            player_name=effective_name,
            account_type=get_account_type(
                player_uuid
            ),
        )

        record_player_access(
            category="op",
            action="remove",
            target_uuid=player_uuid,
            target_name=effective_name,
            account_type=get_account_type(
                player_uuid
            ),
            operator_name="OxOcraft",
            source=(
                history_source
                or "online_ui_manage"
            ),
            detail="{}",
        )

        client = (
            get_management_client()
        )

        result = (
            management_remove_operator(
                client=client,
                player_uuid=player_uuid,
                player_name=effective_name,
            )
        )

        sync_management_operators_to_players(
            result
        )

        return {
            "success": True,
            "message": (
                f"已收回 {effective_name} "
                "的管理員權限"
            ),
            "result": result,
            "op": False,
        }

    # ==================================================
    # Server Offline
    # ops.json 才是目前 OP 狀態來源
    # ==================================================

    ops_result = (
        load_validated_ops()
    )

    mutation_error = (
        get_ops_mutation_error(
            ops_result
        )
    )

    if mutation_error:
        return mutation_error

    # --------------------------------------------------
    # 從「已驗證的這一份 ops.json」
    # 尋找真正要移除的 OP
    # --------------------------------------------------

    target_entry = None

    for item in ops_result[
        "valid_entries"
    ]:
        entry = item["entry"]

        if (
            str(
                entry.get(
                    "uuid",
                    "",
                )
            ).strip().lower()
            == player_uuid.lower()
        ):
            target_entry = entry
            break

    # ops.json 中已經沒有這個玩家
    if target_entry is None:
        return {
            "success": False,
            "message": (
                f"{player_name} "
                "目前不是管理員"
            ),
            "op": False,
        }

    # 以 ops.json 目前真正的名稱為準
    effective_name = str(
        target_entry.get(
            "name",
            player_name,
        )
    ).strip()

    if not can_edit_op_online(
        player_uuid
    ):
        return {
            "success": False,
            "message": (
                f"{effective_name} "
                "不在目前 Minecraft usercache 中，"
                "離線模式下無法在 Server 在線時"
                "移除此玩家 OP，"
                "請關閉伺服器後使用離線設定模式。"
            ),
            "op": True,
        }

    upsert_player_identity(
        player_uuid=player_uuid,
        player_name=effective_name,
        account_type=get_account_type(
            player_uuid
        ),
    )

    # --------------------------------------------------
    # 取得這次已驗證 snapshot 的完整資料
    # --------------------------------------------------

    entries = [
        item["entry"]
        for item in ops_result[
            "valid_entries"
        ]
    ]

    # --------------------------------------------------
    # 在 UI 動手前，
    # 先把使用者先前直接修改 ops.json 的變更
    # 同步進 DB / History
    # --------------------------------------------------

    sync_ops_json_to_players(
        operator_name="Unknown",
        source="minecraft_json",
        detail=(
            "ops.json sync before "
            "UI remove operation"
        ),
        validated=ops_result,
    )

    # --------------------------------------------------
    # 再從同一份最新資料移除目標玩家
    # --------------------------------------------------

    entries = [
        entry
        for entry in entries
        if (
            str(
                entry.get(
                    "uuid",
                    "",
                )
            ).strip().lower()
            != player_uuid.lower()
        )
    ]

    save_ops_entries(
        entries
    )

    # 將 UI 修改後的新結果同步進 DB
    sync_player_op_entries_from_ops_entries(
        entries
    )

    # --------------------------------------------------
    # 這一筆才是「UI 自己做的移除」
    # --------------------------------------------------

    record_player_access(
        category="op",
        action="remove",
        target_uuid=player_uuid,
        target_name=effective_name,
        account_type=get_account_type(
            player_uuid
        ),
        operator_name="OxOcraft",
        source="offline_ui_edit",
        detail="{}",
    )

    return {
        "success": True,
        "message": (
            f"已將 {effective_name} "
            "從待生效管理員清單移除"
        ),
        "result": "offline-edit",
        "op": False,
    }


def toggle_player_op(
    player_uuid: str,
    player_name: str,
    op_level: int | None = None,
    op_bypasses_player_limit: bool = False,
    history_source: str | None = None,
) -> dict:

    # ==================================================
    # Server Ready
    # Management API 是目前 OP 狀態來源
    # ==================================================

    if is_server_ready():
        client = (
            get_management_client()
        )

        operators = (
            management_list_operators(
                client
            )
        )

        op_uuid_set = (
            build_management_operator_uuid_set(
                operators
            )
        )

    # ==================================================
    # Server Offline
    # ops.json 是目前 OP 狀態來源
    # ==================================================

    else:
        ops_result = (
            load_validated_ops()
        )

        mutation_error = (
            get_ops_mutation_error(
                ops_result
            )
        )

        if mutation_error:
            return mutation_error

        op_uuid_set = (
            ops_result[
                "valid_uuid_set"
            ]
        )

    # ==================================================
    # 依目前真正狀態決定 add / remove
    # ==================================================

    if (
        player_uuid.lower()
        in op_uuid_set
    ):
        return remove_player_op(
            player_uuid,
            player_name,
            history_source=
                history_source,
        )

    return set_player_op(
        player_uuid,
        player_name,
        op_level=op_level,
        op_bypasses_player_limit=
            op_bypasses_player_limit,
        history_source=
            history_source,
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

        op_uuid_set = (
            build_management_operator_uuid_set(
                operators
            )
        )

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

    online_mode = get_effective_online_mode()

    if is_server_ready() and not online_mode:
        return {
            "success": False,
            "message": "離線版在線管理只能選擇 usercache 中的玩家",
        }

    identity = resolve_player_identity_by_name(player_name)

    if not identity.get("success"):
        return {
            "success": False,
            "message": identity.get("message") or "玩家解析失敗",
        }

    player_uuid = identity.get("player_uuid")
    resolved_name = identity.get("player_name") or player_name
    account_type = identity.get("account_type")

    known_players = get_known_players()

    known_player = None

    for player in known_players:
        if (
            str(player.get("player_uuid", "")).lower()
            == str(player_uuid).lower()
        ):
            known_player = player
            break

    player = {
        **(known_player or {}),
        "player_uuid": player_uuid,
        "player_name": resolved_name,
        "account_type": account_type,
        "show_in_player_candidates": 1,
        "op": False,
        "in_usercache": (known_player or {}).get("in_usercache", 0),
        "is_online": False,
    }

    return {
        "success": True,
        "message": "",
        "already_exists": known_player is not None,
        "player": build_permission_player_state(
            player,
            online_mode=online_mode,
            online_uuid_set=get_online_uuid_set(),
        ),
    }


def remove_duplicate_ops_entry(
    entry_index: int,
    expected_entry,
) -> dict:
    ops_result = (
        load_validated_ops()
    )

    if ops_result["status"] != "valid":
        return {
            "success": False,
            "message":
                "ops.json 目前無法正常讀取",
            "error_code":
                ops_result.get(
                    "error_code"
                ),
            "data_status":
                "file_invalid",
        }

    target_item = None

    for item in ops_result[
        "duplicate_entries"
    ]:
        if (
            item.get(
                "entry_index"
            ) == entry_index
            and item.get(
                "entry"
            ) == expected_entry
        ):
            target_item = item
            break

    if target_item is None:
        return {
            "success": False,
            "message": (
                "管理員資料已發生變更，"
                "請重新整理後再操作"
            ),
            "error_code":
                "ops_entry_changed",
        }

    # 再讀一次最新檔案，
    # 避免驗證後到實際刪除前檔案被改掉。
    file_result = (
        load_ops_file()
    )

    if file_result["status"] != "valid":
        return {
            "success": False,
            "message":
                "ops.json 目前無法正常讀取",
            "error_code":
                file_result.get(
                    "error_code"
                ),
            "data_status":
                "file_invalid",
        }

    entries = (
        file_result["entries"]
    )

    if (
        entry_index < 0
        or entry_index >= len(entries)
        or entries[
            entry_index
        ] != expected_entry
    ):
        return {
            "success": False,
            "message": (
                "管理員資料已發生變更，"
                "請重新整理後再操作"
            ),
            "error_code":
                "ops_entry_changed",
        }

    removed_entry = (
        entries.pop(
            entry_index
        )
    )

    save_ops_entries(
        entries
    )

    refreshed_result = (
        load_validated_ops()
    )

    if (
        refreshed_result["status"]
        != "valid"
    ):
        return {
            "success": False,
            "message": (
                "刪除後 ops.json "
                "無法正常讀取"
            ),
            "error_code":
                "ops_reload_failed",
        }

    # 如果已經沒有其他資料問題，
    # 才把使用者選擇後的結果同步進 DB。
    if (
        not refreshed_result[
            "invalid_entries"
        ]
        and not refreshed_result[
            "unavailable_entries"
        ]
        and not refreshed_result[
            "duplicate_entries"
        ]
    ):
        sync_ops_json_to_players(
            operator_name="Unknown",
            source="minecraft_json",
            detail=(
                "ops.json sync after "
                "duplicate resolution"
            ),
            validated=
                refreshed_result,
        )

    player_uuid = str(
        removed_entry.get(
            "uuid",
            "",
        )
    ).strip()

    player_name = str(
        removed_entry.get(
            "name",
            "",
        )
        or "未知玩家"
    ).strip()

    record_player_access(
        category="op",
        action="duplicate_remove",
        target_uuid=(
            player_uuid
            or None
        ),
        target_name=
            player_name,
        account_type=(
            get_account_type(
                player_uuid
            )
            if player_uuid
            else "unknown"
        ),
        operator_name="OxOcraft",
        source="ui",
        detail=json.dumps(
            {
                "reason":
                    "duplicate_entry",

                "removed_level":
                    removed_entry.get(
                        "level"
                    ),

                "removed_bypasses_player_limit":
                    removed_entry.get(
                        "bypassesPlayerLimit"
                    ),
            },
            ensure_ascii=False,
        ),
    )

    return {
        "success": True,
        "message":
            "已刪除指定的重複管理員資料",
    }


def get_ops_start_block() -> dict | None:
    ops_result = (
        load_validated_ops()
    )

    duplicate_entries = (
        ops_result.get(
            "duplicate_entries",
            [],
        )
    )

    if not duplicate_entries:
        return None

    duplicate_uuid_set = {
        str(
            item["validation"].get(
                "player_uuid",
                "",
            )
        ).strip().lower()

        for item in duplicate_entries

        if item.get(
            "validation"
        )
    }

    return {
        "error_code":
            "duplicate_player_entries",

        "message": (
            "ops.json 中存在"
            f"{len(duplicate_uuid_set)}組"
            "重複的管理員資料。\n"
            "由於重複資料的權限等級或玩家上限設定可能不同，請先到「權限管理」刪除不需要的重複資料後再開啟伺服器。"
        ),
    }