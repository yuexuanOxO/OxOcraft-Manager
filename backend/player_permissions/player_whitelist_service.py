import json
from datetime import datetime, timedelta

from backend.paths import MC_ROOT,SERVER_PROPERTIES_PATH
from backend.rcon_service import send_rcon_command
from backend.server_monitor import get_cached_server_status
from backend.notification_service import create_notification

from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_account_type,
    resolve_player_identity_by_name,
)

from backend.player_permissions.player_permission_service import (
    get_effective_online_mode,
    get_online_uuid_set,
)

from backend.player_permissions.player_access_history_service import (
    record_player_access,
)

from backend.player_permissions.player_json_validator import (
    validate_cached_player_json_identity,
    split_duplicate_valid_player_entries,
)

from backend.server_effective_settings import (
    load_effective_settings_snapshot,
    get_effective_online_mode_from_snapshot,
)

from backend.player_permissions.player_json_file_service import (
    load_player_json_file,
)

from backend.db import (
    get_connection,
    update_player_whitelist_since,
    update_player_whitelist_status,
    get_whitelisted_players_from_db,
    sync_player_whitelist_flags_from_uuid_set,
    upsert_player_identity,
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


def validate_whitelist_entries(
    entries: list[dict],
    online_mode: bool,
) -> dict:
    valid_entries = []
    invalid_entries = []
    unavailable_entries = []

    for entry_index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            invalid_entries.append({
                "entry_index": entry_index,
                "entry": entry,
                "validation": {
                    "valid": False,
                    "status": "invalid",
                    "error_code": "invalid_entry",
                    "message": "白名單玩家資料格式錯誤",
                },
            })
            continue

        player_uuid = str(
            entry.get("uuid") or ""
        ).strip()

        player_name = str(
            entry.get("name") or ""
        ).strip()

        validation = (
            validate_cached_player_json_identity(
                player_uuid=player_uuid,
                player_name=player_name,
                online_mode=online_mode,
                source="whitelist",
            )
        )

        item = {
            "entry_index": entry_index,
            "entry": entry,
            "validation": validation,
        }

        if validation["status"] == "valid":
            valid_entries.append(item)

        elif validation["status"] == "invalid":
            invalid_entries.append(item)

        elif (
            validation["status"]
            == "verification_unavailable"
        ):
            unavailable_entries.append(item)

    return {
        "valid": valid_entries,
        "invalid": invalid_entries,
        "verification_unavailable":
            unavailable_entries,
    }


def get_validated_whitelist_uuid_sets(
    entries: list[dict],
    online_mode: bool,
) -> dict:
    validation_result = (
        validate_whitelist_entries(
            entries=entries,
            online_mode=online_mode,
        )
    )

    duplicate_result = (
        split_duplicate_valid_player_entries(
            validation_result["valid"]
        )
    )

    valid_entries = (
        duplicate_result["unique_entries"]
    )

    duplicate_entries = (
        duplicate_result["duplicate_entries"]
    )

    valid_uuid_set = {
        str(
            item["validation"]["player_uuid"]
        ).lower()
        for item in valid_entries
        if item["validation"].get(
            "player_uuid"
        )
    }

    unavailable_uuid_set = {
        str(
            item["validation"]["player_uuid"]
        ).lower()
        for item in validation_result[
            "verification_unavailable"
        ]
        if item["validation"].get(
            "player_uuid"
        )
    }

    return {
        "valid_uuid_set": valid_uuid_set,
        "unavailable_uuid_set":unavailable_uuid_set,
        "valid_entries":valid_entries,
        "duplicate_entries":duplicate_entries,
        "invalid_entries":validation_result["invalid"],
        "unavailable_entries":validation_result["verification_unavailable"],
    }


def sync_validated_whitelist_to_players(
    validated: dict,
) -> None:
    for item in validated["valid_entries"]:
        validation = item["validation"]

        upsert_player_identity(
            player_uuid=(
                validation["player_uuid"]
            ),
            player_name=(
                validation["player_name"]
            ),
            account_type=(
                validation["account_type"]
            ),
        )

    sync_player_whitelist_flags_from_uuid_set(
        validated["valid_uuid_set"],
        protected_uuid_set=(
            validated["unavailable_uuid_set"]
        ),
    )


def cleanup_duplicate_whitelist_entries(
    entries: list,
    duplicate_entries: list[dict],
) -> dict:
    if not duplicate_entries:
        return {
            "cleaned": False,
            "entries": entries,
            "removed_count": 0,
        }

    duplicate_indexes = {
        item.get("entry_index")
        for item in duplicate_entries
        if isinstance(
            item.get("entry_index"),
            int,
        )
    }

    cleaned_entries = [
        entry
        for index, entry in enumerate(entries)
        if index not in duplicate_indexes
    ]

    if len(cleaned_entries) == len(entries):
        return {
            "cleaned": False,
            "entries": entries,
            "removed_count": 0,
        }

    save_whitelist_entries(
        cleaned_entries
    )

    duplicate_by_uuid = {}

    for item in duplicate_entries:
        validation = (
            item.get("validation")
            or {}
        )

        player_uuid = str(
            validation.get(
                "player_uuid",
                "",
            )
        ).strip()

        player_name = str(
            validation.get(
                "player_name",
                "",
            )
        ).strip()

        account_type = (
            validation.get(
                "account_type"
            )
        )

        if not player_uuid:
            continue

        key = player_uuid.lower()

        if key not in duplicate_by_uuid:
            duplicate_by_uuid[key] = {
                "player_uuid": player_uuid,
                "player_name": player_name,
                "account_type":
                    account_type,
                "removed_count": 0,
            }

        duplicate_by_uuid[key][
            "removed_count"
        ] += 1

    for item in duplicate_by_uuid.values():
        record_player_access(
            category="whitelist",
            action="duplicate_cleanup",
            target_uuid=(
                item["player_uuid"]
            ),
            target_name=(
                item["player_name"]
                or "未知玩家"
            ),
            account_type=(
                item["account_type"]
            ),
            operator_name="Unknown",
            source="minecraft_json",
            detail=json.dumps(
                {
                    "reason":
                        "duplicate_entry",
                    "removed_count":
                        item["removed_count"],
                },
                ensure_ascii=False,
            ),
        )

    return {
        "cleaned": True,
        "entries": cleaned_entries,
        "removed_count": (
            len(entries)
            - len(cleaned_entries)
        ),
    }


def save_whitelist_entries(entries: list[dict]) -> None:
    with WHITELIST_FILE.open("w", encoding="utf-8") as file:
        json.dump(entries, file, ensure_ascii=False, indent=2)


def load_whitelist_uuid_set() -> set[str]:
    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return set()

    return {
        str(
            entry.get("uuid", "")
        ).lower()

        for entry in file_result["entries"]

        if (
            isinstance(entry, dict)
            and entry.get("uuid")
        )
    }


def sync_whitelist_json_to_players(
    source: str = "unknown",
) -> None:
    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return

    entries = file_result["entries"]

    snapshot = load_effective_settings_snapshot()

    online_mode = (
        get_effective_online_mode_from_snapshot(
            snapshot
        )
    )

    validated = (
        get_validated_whitelist_uuid_sets(
            entries=entries,
            online_mode=online_mode,
        )
    )

    sync_validated_whitelist_to_players(
        validated
    )


def sync_whitelist_json_to_players_with_history(
    operator_name: str,
    source: str,
    detail: str = "",
    validated: dict | None = None,
) -> dict:
    if validated is None:
        file_result = load_whitelist_file()

        if file_result["status"] != "valid":
            return {
                "added_count": 0,
                "removed_count": 0,
                "sync_status": "file_invalid",
                "error_code": file_result.get(
                    "error_code"
                ),
            }

        json_entries = file_result["entries"]

        snapshot = (
            load_effective_settings_snapshot()
        )

        online_mode = (
            get_effective_online_mode_from_snapshot(
                snapshot
            )
        )

        validated = (
            get_validated_whitelist_uuid_sets(
                entries=json_entries,
                online_mode=online_mode,
            )
        )

    valid_uuid_set = (
        validated["valid_uuid_set"]
    )

    unavailable_uuid_set = (
        validated["unavailable_uuid_set"]
    )

    # --------------------------------------------------
    # 4. 取得目前 DB whitelist 狀態
    # --------------------------------------------------

    db_players = (
        get_whitelisted_players_from_db()
    )

    db_uuid_set = {
        str(
            player.get("player_uuid", "")
        ).lower()
        for player in db_players
        if player.get("player_uuid")
    }

    # --------------------------------------------------
    # 5. 計算真正可確認的新增 / 移除
    #
    # unavailable 不得被判定為 removed。
    # --------------------------------------------------

    added_uuid_set = (
        valid_uuid_set
        - db_uuid_set
    )

    removed_uuid_set = (
        db_uuid_set
        - valid_uuid_set
        - unavailable_uuid_set
    )

    # --------------------------------------------------
    # 6. valid identity 先同步進 players
    # --------------------------------------------------

    for item in validated["valid_entries"]:
        validation = item["validation"]

        upsert_player_identity(
            player_uuid=(
                validation["player_uuid"]
            ),
            player_name=(
                validation["player_name"]
            ),
            account_type=(
                validation["account_type"]
            ),
        )

    # --------------------------------------------------
    # 7. 同步 whitelist flag
    #
    # unavailable UUID 保留原 DB 狀態。
    # --------------------------------------------------

    sync_player_whitelist_flags_from_uuid_set(
        valid_uuid_set,
        protected_uuid_set=(
            unavailable_uuid_set
        ),
    )

    # --------------------------------------------------
    # 8. 建立 valid JSON UUID → validation
    #
    # 後面的 history 不再直接信任原始 JSON。
    # --------------------------------------------------

    valid_entry_by_uuid = {
        str(
            item["validation"][
                "player_uuid"
            ]
        ).lower(): item["validation"]

        for item in validated[
            "valid_entries"
        ]

        if item["validation"].get(
            "player_uuid"
        )
    }

    db_player_by_uuid = {
        str(
            player.get(
                "player_uuid",
                "",
            )
        ).lower(): player

        for player in db_players

        if player.get("player_uuid")
    }

    added_count = 0
    removed_count = 0

    # --------------------------------------------------
    # 9. 新增 history
    # --------------------------------------------------

    for player_uuid in added_uuid_set:
        validation = (
            valid_entry_by_uuid.get(
                player_uuid,
                {},
            )
        )

        player_name = str(
            validation.get(
                "player_name"
            )
            or "未知玩家"
        ).strip()

        account_type = (
            validation.get(
                "account_type"
            )
            or get_account_type(
                player_uuid
            )
        )

        update_player_whitelist_since(
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=account_type,
            whitelisted_since=(
                datetime.now().strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
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

    # --------------------------------------------------
    # 10. 移除 history
    # --------------------------------------------------

    for player_uuid in removed_uuid_set:
        player = (
            db_player_by_uuid.get(
                player_uuid,
                {},
            )
        )

        player_name = str(
            player.get("player_name")
            or "未知玩家"
        ).strip()

        account_type = (
            player.get("account_type")
            or get_account_type(
                player_uuid
            )
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

    # --------------------------------------------------
    # 11. Minecraft JSON 外部變更通知
    # --------------------------------------------------

    if (
        source == "minecraft_json"
        and (
            added_count > 0
            or removed_count > 0
        )
    ):
        create_notification(
            title="白名單已同步改動",
            message=(
                f"資料同步重新載入白名單，"
                f"新增 {added_count} 位，"
                f"移除 {removed_count} 位。"
            ),
            type="info",
            source="player_whitelist",
        )

    return {
        "added_count": added_count,
        "removed_count": removed_count,
        "sync_status": "success",
    }


def rebuild_whitelist_json_from_db(
    force: bool = False,
) -> bool:
    if not force and not is_server_ready():
        return False

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

    return True


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


def get_whitelisted_players_from_json() -> dict:
    whitelist_result = (
        load_validated_whitelist()
    )

    if (
        whitelist_result["status"]
        != "valid"
    ):
        return whitelist_result

    sync_whitelist_json_to_players_with_history(
        operator_name="Unknown",
        source="minecraft_json",
        detail="offline whitelist.json sync",
        validated=whitelist_result,
    )

    result = []

    for item in (
        whitelist_result["valid_entries"]
    ):
        entry = item["entry"]
        validation = item["validation"]
        player_uuid = str(validation.get("player_uuid","",)).strip()

        player_name = str(validation.get("player_name","",)).strip()

        if not player_uuid or not player_name:
            continue

        db_record = None

        with get_connection() as conn:
            row = conn.execute("""
                SELECT *
                FROM players
                WHERE lower(player_uuid) = lower(?)
                LIMIT 1
            """, (
                player_uuid,
            )).fetchone()

            db_record = (
                dict(row)
                if row
                else None
            )

        account_type = (
            validation.get("account_type")
            or (
                db_record.get("account_type")
                if db_record
                else None
            )
            or get_account_type(player_uuid)
        )

        is_valid_for_current_mode = bool(
            validation.get(
                "valid_for_current_mode",
                False,
            )
        )

        result.append({
            **(db_record or {}),

            # whitelist.json 才是目前離線狀態的來源
            "player_uuid": player_uuid,
            "player_name": player_name,
            "account_type": account_type,

            "whitelisted": True,

            # JSON 本身沒有加入時間，
            # DB 沒資料時前端顯示「未知」即可
            "whitelisted_since": (
                db_record.get("whitelisted_since")
                if db_record
                else None
            ),

            "valid_for_current_mode":
                is_valid_for_current_mode,
        })

    whitelist_result["players"] = result

    return whitelist_result


def get_player_whitelist_data() -> dict:
    if not is_server_ready():
        return get_whitelisted_players_from_json()

    whitelist_result = (
        load_validated_whitelist()
    )

    if (
        whitelist_result["status"]
        != "valid"
    ):
        return whitelist_result

    whitelist_result["players"] = (
        get_player_whitelist_list()
    )

    return whitelist_result


def get_player_whitelist_list() -> list[dict]:
    online_mode = get_effective_online_mode()

    if not is_server_ready():
        whitelist_result = (
            get_whitelisted_players_from_json()
        )

        if (
            whitelist_result["status"]
            != "valid"
        ):
            return []

        return whitelist_result["players"]

    players = get_whitelisted_players_from_db()

    result = []

    for player in players:
        player_uuid = str(
            player.get("player_uuid", "")
        ).strip()

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
            "valid_for_current_mode":
                is_valid_for_current_mode,
        })

    return result


def add_player_whitelist(
    player_uuid: str,
    player_name: str,
    history_source: str | None = None,
) -> dict:
    mutation_error = (
        get_whitelist_mutation_error()
    )

    if mutation_error:
        return mutation_error

    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "白名單參數檔發生錯誤，"
                "請先修復 whitelist.json"
            ),
            "error_code": (
                file_result.get("error_code")
            ),
            "data_status": "file_invalid",
        }

    whitelist_uuid_set = {
        str(entry.get("uuid", "")).lower()
        for entry in file_result["entries"]
        if (
            isinstance(entry, dict)
            and entry.get("uuid")
        )
    }

    if player_uuid.lower() in whitelist_uuid_set:
        return {
            "success": False,
            "message": f"{player_name} 已經在白名單中，不能重複加入。",
            "whitelisted": True,
        }

    rebuild_whitelist_json_from_db()

    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "白名單參數檔發生錯誤，"
                "請先修復 whitelist.json"
            ),
            "error_code": (
                file_result.get("error_code")
            ),
            "data_status": "file_invalid",
        }

    entries = file_result["entries"]

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
        source=(
            history_source
            or get_whitelist_ui_source()
        ),
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
    history_source: str | None = None,
) -> dict:

    mutation_error = (
        get_whitelist_mutation_error()
    )

    if mutation_error:
        return mutation_error

    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "白名單參數檔發生錯誤，"
                "請先修復 whitelist.json"
            ),
            "error_code": (
                file_result.get("error_code")
            ),
            "data_status": "file_invalid",
        }

    rebuild_whitelist_json_from_db()

    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "白名單參數檔發生錯誤，"
                "請先修復 whitelist.json"
            ),
            "error_code": (
                file_result.get("error_code")
            ),
            "data_status": "file_invalid",
        }

    entries = file_result["entries"]

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
        source=(
            history_source
            or get_whitelist_ui_source()
        ),
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
    history_source: str | None = None,
) -> dict:

    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "白名單參數檔發生錯誤，"
                "請先修復 whitelist.json"
            ),
            "error_code": (
                file_result.get("error_code")
            ),
            "data_status": "file_invalid",
        }

    whitelist_uuid_set = {
        str(entry.get("uuid", "")).lower()
        for entry in file_result["entries"]
        if (
            isinstance(entry, dict)
            and entry.get("uuid")
        )
    }

    if player_uuid.lower() in whitelist_uuid_set:
        return remove_player_whitelist(
            player_uuid,
            player_name,
            history_source=history_source,
        )

    return add_player_whitelist(
        player_uuid,
        player_name,
        history_source=history_source,
    )


def get_player_whitelist_candidate_list() -> list[dict]:
    players = get_known_players()
    whitelist_uuid_set = load_whitelist_uuid_set()
    online_mode = get_effective_online_mode()
    online_uuid_set = get_online_uuid_set()

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
            "online": player_uuid in online_uuid_set,
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


def load_whitelist_file() -> dict:
    return load_player_json_file(
        WHITELIST_FILE
    )


def load_validated_whitelist() -> dict:
    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return {
            "status": "file_invalid",
            "players": [],

            "valid_uuid_set": set(),
            "unavailable_uuid_set": set(),

            "valid_entries": [],
            "invalid_entries": [],
            "unavailable_entries": [],

            "error_code": file_result.get("error_code"),
            "message": file_result.get("message","",),
        }

    snapshot = (
        load_effective_settings_snapshot()
    )

    online_mode = (
        get_effective_online_mode_from_snapshot(
            snapshot
        )
    )

    validated = (
        get_validated_whitelist_uuid_sets(
            entries=file_result["entries"],
            online_mode=online_mode,
        )
    )

    cleanup_result = (
        cleanup_duplicate_whitelist_entries(
            entries=file_result["entries"],
            duplicate_entries=(
                validated[
                    "duplicate_entries"
                ]
            ),
        )
    )

    if cleanup_result["cleaned"]:
        validated = (
            get_validated_whitelist_uuid_sets(
                entries=(
                    cleanup_result["entries"]
                ),
                online_mode=online_mode,
            )
        )

    return {
        "status": "valid",
        "players": [],
        "valid_entries":validated["valid_entries"],
        "invalid_entries":validated["invalid_entries"],
        "unavailable_entries":validated["unavailable_entries"],
        "valid_uuid_set":validated["valid_uuid_set"],
        "unavailable_uuid_set":validated["unavailable_uuid_set"],
        "error_code": None,
        "message": "",
    }


def get_whitelist_mutation_error() -> dict | None:
    whitelist_result = (
        load_validated_whitelist()
    )

    if (
        whitelist_result["status"]
        != "valid"
    ):
        return {
            "success": False,
            "message": (
                "白名單參數檔發生錯誤，"
                "請先修復 whitelist.json"
            ),
            "error_code": (
                whitelist_result.get(
                    "error_code"
                )
            ),
            "data_status": "file_invalid",
        }

    if whitelist_result["invalid_entries"]:
        return {
            "success": False,
            "message": (
                "白名單中有玩家資料驗證失敗，"
                "請先處理錯誤資料"
            ),
            "error_code":
                "invalid_player_entries",
            "data_status": "entry_invalid",
        }

    if whitelist_result["unavailable_entries"]:
        return {
            "success": False,
            "message": (
                "白名單中有玩家資料目前無法驗證，"
                "請稍後重新驗證後再操作"
            ),
            "error_code":
                "player_verification_unavailable",
            "data_status":
                "verification_unavailable",
        }

    return None


def recover_whitelist_json_from_db() -> dict:
    file_result = load_whitelist_file()

    if file_result["status"] == "valid":
        return {
            "success": False,
            "message": (
                "whitelist.json 目前沒有"
                "需要恢復的格式錯誤"
            ),
            "error_code": "file_not_invalid",
        }

    rebuild_whitelist_json_from_db(
        force=True
    )

    restored_result = load_whitelist_file()

    if restored_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "白名單資料恢復失敗，"
                "whitelist.json 仍然無法正常讀取"
            ),
            "error_code": (
                restored_result.get(
                    "error_code"
                )
                or "recovery_failed"
            ),
        }

    return {
        "success": True,
        "message": "白名單舊資料已恢復",
        "restored_count": len(
            restored_result["entries"]
        ),
    }


def remove_invalid_whitelist_entry(
    entry_index: int,
    expected_entry,
) -> dict:
    whitelist_result = (
        load_validated_whitelist()
    )

    if (
        whitelist_result["status"]
        != "valid"
    ):
        return {
            "success": False,
            "message": (
                "whitelist.json 目前無法正常讀取"
            ),
            "error_code": (
                whitelist_result.get(
                    "error_code"
                )
            ),
            "data_status": "file_invalid",
        }

    target_item = None

    for item in (
        whitelist_result["invalid_entries"]
    ):
        if (
            item.get("entry_index")
            == entry_index
            and item.get("entry")
            == expected_entry
        ):
            target_item = item
            break

    if target_item is None:
        return {
            "success": False,
            "message": (
                "白名單資料已發生變更，"
                "請重新整理後再操作"
            ),
            "error_code":
                "whitelist_entry_changed",
        }

    file_result = load_whitelist_file()

    if file_result["status"] != "valid":
        return {
            "success": False,
            "message": (
                "whitelist.json 目前無法正常讀取"
            ),
            "error_code": (
                file_result.get(
                    "error_code"
                )
            ),
            "data_status": "file_invalid",
        }

    entries = file_result["entries"]

    if (
        entry_index < 0
        or entry_index >= len(entries)
        or entries[entry_index] != expected_entry
    ):
        return {
            "success": False,
            "message": (
                "白名單資料已發生變更，"
                "請重新整理後再操作"
            ),
            "error_code":
                "whitelist_entry_changed",
        }

    entries.pop(entry_index)

    save_whitelist_entries(entries)

    refreshed_result = (
        load_validated_whitelist()
    )

    if (
        refreshed_result["status"]
        != "valid"
    ):
        return {
            "success": False,
            "message": (
                "刪除後 whitelist.json "
                "無法正常讀取"
            ),
            "error_code":
                "whitelist_reload_failed",
        }

    sync_validated_whitelist_to_players(
        refreshed_result
    )

    reload_result = (
        reload_whitelist_if_ready()
    )

    return {
        "success": True,
        "message": "已刪除錯誤的白名單資料",
        "result": reload_result,
    }