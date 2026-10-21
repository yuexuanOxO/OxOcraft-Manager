import ipaddress
import json
import os
import tempfile
import threading
from datetime import datetime, timedelta
from pathlib import Path

from backend.paths import MC_ROOT
from backend.rcon_service import send_rcon_command
from backend.server_runtime import is_server_running
from backend.notification_service import create_notification
from backend.routes.player_routes import (
    resolve_player_uuid,
    is_online_mode,
)

from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_current_usercache_players,
    get_account_type as detect_account_type,
    resolve_player_identity_by_name,
)

from backend.db import (
    get_connection,
    update_player_ban_status,
    get_banned_players_from_db,

    update_ip_ban_status,
    get_banned_ips_from_db,
    get_banned_ip_from_db,
    record_ip_ban_history,
    get_ip_player_history,
)

from backend.player_permissions.player_access_history_service import (
    record_player_access,
)

from backend.player_permissions.player_permission_service import (
    get_online_uuid_set,
)

from backend.player_permissions.player_json_file_service import (
    load_player_json_file,
)

from backend.player_permissions.player_json_validator import (
    inspect_player_json_entries,
    validate_ban_entry_schema,
    verify_cached_player_json_items,
)

BANNED_PLAYERS_FILE = MC_ROOT / "banned-players.json"
BANNED_IPS_FILE = MC_ROOT / "banned-ips.json"

_BANNED_PLAYERS_FILE_LOCK = threading.RLock()
_BANNED_IPS_FILE_LOCK = threading.RLock()


class BannedPlayersDataError(ValueError):
    def __init__(self, result: dict):
        super().__init__(result["message"])
        self.result = result


def load_validated_banned_players() -> dict:
    try:
        with _BANNED_PLAYERS_FILE_LOCK:
            file_result = load_player_json_file(BANNED_PLAYERS_FILE)
    except UnicodeError:
        file_result = {
            "status": "invalid",
            "error_code": "invalid_encoding",
            "message": "banned-players.json 必須使用 UTF-8 編碼",
        }

    result = {
        "status": "valid",
        "entries": [],
        "valid_entries": [],
        "invalid_entries": [],
        "unavailable_entries": [],
        "duplicate_entries": [],
        "error_code": None,
        "message": "",
    }

    if file_result["status"] != "valid":
        return {
            **result,
            "status": "file_invalid",
            "error_code": file_result.get("error_code"),
            "message": file_result.get("message", ""),
        }

    inspection = inspect_player_json_entries(
        entries=file_result["entries"],
        schema_type="banned_players",
    )

    verification = verify_cached_player_json_items(
        items=inspection["unique_entries"],
        online_mode=is_online_mode(),
        source="banned_players",
    )

    return {
        **result,
        "entries": file_result["entries"],
        "valid_entries": verification["valid"],
        "invalid_entries": (
            inspection["invalid_entries"] + verification["invalid"]
        ),
        "unavailable_entries": verification["verification_unavailable"],
        "duplicate_entries": inspection["duplicate_entries"],
    }


def get_banned_players_mutation_error(
    validated: dict | None = None,
) -> dict | None:
    if validated is None:
        validated = load_validated_banned_players()

    if validated["status"] != "valid":
        return {
            "success": False,
            "data_status": "file_invalid",
            "error_code": validated.get("error_code"),
            "message": "玩家黑名單參數檔發生錯誤，請先修復 banned-players.json",
        }

    issues = (
        ("invalid_entries", "entry_invalid", "invalid_player_entries",
         "玩家黑名單有資料錯誤，請先修正後再操作"),
        ("unavailable_entries", "verification_unavailable", "player_verification_unavailable",
         "玩家黑名單有資料目前無法驗證，請重新驗證後再操作"),
        ("duplicate_entries", "entry_duplicate", "duplicate_player_entries",
         "玩家黑名單有重複資料，請先處理後再操作"),
    )

    for key, status, code, message in issues:
        if validated[key]:
            return {
                "success": False,
                "data_status": status,
                "error_code": code,
                "message": message,
            }

    return None


def require_valid_banned_player_entries() -> list[dict]:
    validated = load_validated_banned_players()
    error = get_banned_players_mutation_error(validated)

    if error:
        raise BannedPlayersDataError(error)

    if is_server_running():
        raise BannedPlayersDataError({
            "success": False,
            "data_status": "server_state_changed",
            "message": "伺服器狀態已變更，請重新整理後再操作",
        })

    return validated["entries"]


def get_player_ban_data() -> dict:
    # 在線時沿用 DB 與 ban / pardon 指令同步的狀態。
    # 磁碟上的外部修改，留到離線及下次啟動前驗證。
    if is_server_running():
        return {
            "status": "valid",
            "players": get_active_banned_players(),
            "invalid_entries": [],
            "unavailable_entries": [],
            "duplicate_entries": [],
            "error_code": None,
            "message": "",
        }

    validated = load_validated_banned_players()

    if is_server_running():
        return get_player_ban_data()

    # 只有整份資料都通過驗證，才同步 DB 的封鎖旗標。
    sync_banned_players_json_to_db(validated=validated)
    players = get_active_banned_players_from_json([
        item["entry"] for item in validated["valid_entries"]
    ])

    return {**validated, "players": players}


def open_banned_players_file() -> dict:
    if not BANNED_PLAYERS_FILE.is_file():
        return {"success": False, "message": "找不到目前伺服器的 banned-players.json"}

    if not hasattr(os, "startfile"):
        return {"success": False, "message": "開啟本機檔案功能目前僅支援 Windows"}

    os.startfile(BANNED_PLAYERS_FILE.resolve())
    return {"success": True, "message": "已使用預設程式開啟 banned-players.json"}


def recover_banned_players_json_from_db() -> dict:
    if is_server_running():
        return {"success": False, "message": "請先關閉伺服器，再恢復玩家黑名單檔案"}

    with _BANNED_PLAYERS_FILE_LOCK:
        try:
            file_result = load_player_json_file(BANNED_PLAYERS_FILE)
        except UnicodeError:
            file_result = {"status": "invalid"}

        if file_result["status"] == "valid":
            return {
                "success": False,
                "message": "banned-players.json 目前沒有需要恢復的整份檔案錯誤",
                "error_code": "file_not_invalid",
            }

        entries = []

        for player in get_banned_players_from_db():
            created = player.get("banned_since") or now_text()

            try:
                created_at = datetime.strptime(created, "%Y-%m-%d %H:%M:%S")
            except (TypeError, ValueError):
                return {
                    "success": False,
                    "message": "資料庫中的封鎖建立時間異常，無法恢復玩家黑名單",
                    "error_code": "invalid_ban_snapshot",
                }

            operator = get_latest_player_ban_operator(
                player_uuid=player.get("player_uuid"),
                player_name=player.get("player_name", ""),
            )

            entries.append({
                "uuid": player.get("player_uuid"),
                "name": player.get("player_name"),
                "created": created_at.strftime("%Y-%m-%d %H:%M:%S +0800"),
                "source": operator["operator"] or "OxOcraft",
                # 管理工具的解除期限仍保留在 DB，交由原排程處理。
                "expires": "forever",
                "reason": player.get("ban_reason") or "已被管理員封鎖。",
            })

        inspection = inspect_player_json_entries(
            entries=entries,
            schema_type="banned_players",
        )

        if inspection["invalid_entries"] or inspection["duplicate_entries"]:
            return {
                "success": False,
                "message": "資料庫中的封鎖玩家資料異常，無法恢復玩家黑名單",
                "error_code": "invalid_ban_snapshot",
            }

        if is_server_running():
            return {"success": False, "message": "伺服器狀態已變更，請關閉伺服器後再恢復"}

        write_json_list(BANNED_PLAYERS_FILE, entries)

    return {
        "success": True,
        "restored_count": len(entries),
        "message": f"已恢復 {len(entries)} 位封鎖玩家，管理工具的封鎖期限已保留",
    }


def remove_invalid_banned_player_entry(
    entry_index: int,
    expected_entry,
) -> dict:
    if is_server_running():
        return {"success": False, "message": "請先關閉伺服器，再刪除錯誤資料"}

    with _BANNED_PLAYERS_FILE_LOCK:
        file_result = load_player_json_file(BANNED_PLAYERS_FILE)

        if file_result["status"] != "valid":
            return {
                "success": False,
                "data_status": "file_invalid",
                "message": "banned-players.json 目前無法正常讀取",
            }

        entries = file_result["entries"]

        if (
            type(entry_index) is not int
            or entry_index < 0
            or entry_index >= len(entries)
            or json.dumps(entries[entry_index], sort_keys=True)
                != json.dumps(expected_entry, sort_keys=True)
        ):
            return {"success": False, "message": "資料已變更，請重新整理後再操作"}

        original_content = BANNED_PLAYERS_FILE.read_bytes()
        validated = load_validated_banned_players()

        if not any(
            item["entry_index"] == entry_index
            for item in validated["invalid_entries"]
        ):
            return {"success": False, "message": "這筆資料目前不是錯誤資料，請重新整理"}

        if (
            is_server_running()
            or BANNED_PLAYERS_FILE.read_bytes() != original_content
        ):
            return {"success": False, "message": "伺服器或檔案狀態已變更，請重新整理"}

        removed_entry = entries.pop(entry_index)
        write_json_list(BANNED_PLAYERS_FILE, entries)

    raw_entry = removed_entry if isinstance(removed_entry, dict) else {}

    record_player_access(
        category="ban",
        action="invalid_entry_remove",
        target_uuid=str(raw_entry.get("uuid") or "").strip() or None,
        target_name=str(raw_entry.get("name") or "").strip() or "未知玩家",
        account_type="unknown",
        operator_name="OxOcraft",
        source="offline_ui_edit",
        detail=json.dumps({
            "reason": "invalid_player_entry",
            "entry_index": entry_index,
            "removed_entry": removed_entry,
        }, ensure_ascii=False),
        resolve_target_identity=False,
    )

    return {"success": True, "message": "已刪除指定的錯誤封鎖資料"}


def remove_duplicate_banned_player_entry(
    entry_index: int,
    expected_entry,
) -> dict:
    if is_server_running():
        return {"success": False, "message": "請先關閉伺服器，再處理重複檔案資料"}

    with _BANNED_PLAYERS_FILE_LOCK:
        try:
            file_result = load_player_json_file(BANNED_PLAYERS_FILE)
        except UnicodeError:
            file_result = {"status": "invalid"}

        if file_result["status"] != "valid":
            return {
                "success": False,
                "data_status": "file_invalid",
                "message": "banned-players.json 目前無法正常讀取",
            }

        entries = file_result["entries"]

        if (
            type(entry_index) is not int
            or entry_index < 0
            or entry_index >= len(entries)
            or entries[entry_index] != expected_entry
        ):
            return {
                "success": False,
                "message": "玩家黑名單資料已發生變更，請重新檢查後再操作",
                "error_code": "banned_player_entry_changed",
            }

        inspection = inspect_player_json_entries(
            entries=entries,
            schema_type="banned_players",
        )

        if not any(
            item["entry_index"] == entry_index
            for item in inspection["duplicate_entries"]
        ):
            return {
                "success": False,
                "message": "指定資料目前不是重複項目，請重新檢查後再操作",
                "error_code": "banned_player_duplicate_changed",
            }

        if is_server_running():
            return {"success": False, "message": "伺服器狀態已變更，請關閉伺服器後再操作"}

        removed = entries.pop(entry_index)
        write_json_list(BANNED_PLAYERS_FILE, entries)

    record_player_access(
        category="ban",
        action="duplicate_remove",
        target_uuid=removed["uuid"],
        target_name=removed["name"],
        account_type=detect_account_type(removed["uuid"]),
        operator_name="OxOcraft",
        source="offline_ui_edit",
        detail=json.dumps({"removed_entry": removed}, ensure_ascii=False),
    )

    return {"success": True, "message": "已刪除指定的重複資料，玩家封鎖狀態保留"}


class BannedIpsDataError(ValueError):
    def __init__(self, result: dict):
        super().__init__(result["message"])
        self.result = result


def normalize_banned_ip(ip: str) -> str:
    if not isinstance(ip, str) or not ip.strip() or "%" in ip:
        raise ValueError("IP 格式不正確，請填入純 IPv4 或 IPv6 位址")
    return str(ipaddress.ip_address(ip.strip()))


def get_equivalent_banned_ip_from_db(ip: str) -> dict | None:
    record = get_banned_ip_from_db(ip)
    if record:
        return record
    normalized_ip = normalize_banned_ip(ip)
    for record in get_banned_ips_from_db():
        try:
            if normalize_banned_ip(record["ip"]) == normalized_ip:
                return record
        except ValueError:
            continue
    return None


def inspect_banned_ip_entries(entries: list) -> dict:
    valid = []
    invalid = []
    counts = {}
    for index, entry in enumerate(entries):
        message = ""
        normalized_ip = None
        if not isinstance(entry, dict):
            message = "封鎖 IP 資料必須為物件"
        else:
            schema = validate_ban_entry_schema(entry, ("ip",))
            if not schema["valid"]:
                message = schema["message"]
            else:
                try:
                    normalized_ip = normalize_banned_ip(entry["ip"])
                except ValueError:
                    message = "IP 格式不正確，請填入純 IPv4 或 IPv6 位址"
        item = {
            "entry_index": index,
            "entry": entry,
            "validation": {
                "status": "invalid" if message else "valid",
                "message": message,
                "ip": entry.get("ip") if isinstance(entry, dict) else None,
                "normalized_ip": normalized_ip,
            },
        }
        if message:
            invalid.append(item)
        else:
            valid.append(item)
            counts[normalized_ip] = counts.get(normalized_ip, 0) + 1
    return {
        "valid_entries": [item for item in valid if counts[item["validation"]["normalized_ip"]] == 1],
        "invalid_entries": invalid,
        "duplicate_entries": [item for item in valid if counts[item["validation"]["normalized_ip"]] > 1],
    }


def load_validated_banned_ips() -> dict:
    with _BANNED_IPS_FILE_LOCK:
        try:
            file_result = load_player_json_file(BANNED_IPS_FILE)
        except UnicodeError:
            file_result = {
                "status": "invalid",
                "error_code": "invalid_encoding",
                "message": "banned-ips.json 必須使用 UTF-8 編碼",
            }
        result = {
            "status": "valid",
            "entries": [],
            "valid_entries": [],
            "invalid_entries": [],
            "duplicate_entries": [],
            "error_code": None,
            "message": "",
        }
        if file_result["status"] != "valid":
            return {
                **result,
                "status": "file_invalid",
                "error_code": file_result.get("error_code"),
                "message": file_result.get("message", ""),
            }
        entries = file_result["entries"]
        return {**result, "entries": entries, **inspect_banned_ip_entries(entries)}


def get_banned_ips_mutation_error(validated: dict | None = None) -> dict | None:
    if validated is None:
        validated = load_validated_banned_ips()
    if validated["status"] != "valid":
        return {
            "success": False,
            "data_status": "file_invalid",
            "error_code": validated.get("error_code"),
            "message": "IP 黑名單參數檔發生錯誤，請先修復 banned-ips.json",
        }
    for key, status, message in (
        ("invalid_entries", "entry_invalid", "IP 黑名單有資料錯誤，請先修正後再操作"),
        ("duplicate_entries", "entry_duplicate", "IP 黑名單有重複資料，請先處理後再操作"),
    ):
        if validated[key]:
            return {"success": False, "data_status": status, "message": message}
    return None


def require_valid_banned_ip_entries() -> list[dict]:
    validated = load_validated_banned_ips()
    error = get_banned_ips_mutation_error(validated)
    if error:
        raise BannedIpsDataError(error)
    if is_server_running():
        raise BannedIpsDataError({"success": False, "data_status": "server_state_changed", "message": "伺服器狀態已變更，請重新整理後再操作"})
    return validated["entries"]


def get_ip_ban_data() -> dict:
    if is_server_running():
        return {
            "status": "valid", "ips": get_active_banned_ips(),
            "invalid_entries": [], "duplicate_entries": [],
            "error_code": None, "message": "",
        }
    with _BANNED_IPS_FILE_LOCK:
        validated = load_validated_banned_ips()
        if is_server_running():
            return get_ip_ban_data()
        sync_banned_ips_json_to_db(validated)
        entries = [item["entry"] for item in validated["valid_entries"]]
        return {**validated, "ips": get_active_banned_ips_from_json(entries)}


def open_banned_ips_file() -> dict:
    if not BANNED_IPS_FILE.is_file():
        return {"success": False, "message": "找不到目前伺服器的 banned-ips.json"}
    if not hasattr(os, "startfile"):
        return {"success": False, "message": "開啟本機檔案功能目前僅支援 Windows"}
    os.startfile(BANNED_IPS_FILE.resolve())
    return {"success": True, "message": "已使用預設程式開啟 banned-ips.json"}


def recover_banned_ips_json_from_db() -> dict:
    with _BANNED_IPS_FILE_LOCK:
        if is_server_running():
            return {"success": False, "message": "請先關閉伺服器，再恢復 IP 黑名單檔案"}
        original = BANNED_IPS_FILE.read_bytes() if BANNED_IPS_FILE.exists() else None
        validated = load_validated_banned_ips()
        if validated["status"] != "file_invalid":
            return {"success": False, "message": "banned-ips.json 目前沒有需要恢復的整份檔案錯誤"}
        entries = []
        for record in get_banned_ips_from_db():
            try:
                created = datetime.strptime(record.get("banned_since") or now_text(), "%Y-%m-%d %H:%M:%S")
            except (TypeError, ValueError):
                return {"success": False, "message": "資料庫中的封鎖建立時間異常，無法恢復 IP 黑名單"}
            operator = get_latest_ip_ban_operator(record["ip"])
            entries.append({
                "ip": record["ip"],
                "created": created.strftime("%Y-%m-%d %H:%M:%S +0800"),
                "source": operator["operator"] or "OxOcraft",
                "expires": "forever",
                "reason": record.get("ban_reason") or "已被管理員封鎖。",
            })
        inspection = inspect_banned_ip_entries(entries)
        if inspection["invalid_entries"] or inspection["duplicate_entries"]:
            return {"success": False, "message": "資料庫中的封鎖 IP 資料異常或重複，無法恢復 IP 黑名單"}
        if is_server_running() or BANNED_IPS_FILE.read_bytes() != original:
            return {"success": False, "message": "伺服器或檔案狀態已變更，請重新整理"}
        write_json_list(BANNED_IPS_FILE, entries)
    return {"success": True, "restored_count": len(entries), "message": f"已恢復 {len(entries)} 個封鎖 IP，管理工具的封鎖期限已保留"}


def remove_banned_ip_json_entry(entry_index: int, expected_entry, kind: str) -> dict:
    if kind not in ("invalid", "duplicate"):
        return {"success": False, "message": "不支援的資料類型"}
    with _BANNED_IPS_FILE_LOCK:
        if is_server_running():
            return {"success": False, "message": "請先關閉伺服器，再處理 IP 檔案資料"}
        original = BANNED_IPS_FILE.read_bytes() if BANNED_IPS_FILE.exists() else None
        validated = load_validated_banned_ips()
        if validated["status"] != "valid":
            return {"success": False, "data_status": "file_invalid", "message": "banned-ips.json 目前無法正常讀取"}
        entries = validated["entries"]
        if (
            type(entry_index) is not int or entry_index < 0 or entry_index >= len(entries)
            or json.dumps(entries[entry_index], sort_keys=True) != json.dumps(expected_entry, sort_keys=True)
            or not any(item["entry_index"] == entry_index for item in validated[f"{kind}_entries"])
        ):
            return {"success": False, "data_status": "entry_changed", "message": "資料已變更，請重新檢查後再操作"}
        if is_server_running() or BANNED_IPS_FILE.read_bytes() != original:
            return {"success": False, "data_status": "entry_changed", "message": "伺服器或檔案狀態已變更，請重新整理"}
        removed = entries.pop(entry_index)
        write_json_list(BANNED_IPS_FILE, entries)
    raw = removed if isinstance(removed, dict) else {}
    ip = raw.get("ip")
    record_ip_ban_history(
        action="duplicate_remove" if kind == "duplicate" else "invalid_entry_remove",
        ip=ip.strip() if isinstance(ip, str) and ip.strip() else "未知 IP",
        reason="清除重複資料" if kind == "duplicate" else "刪除錯誤資料",
        operator_name="OxOcraft", source="offline_ui_edit",
        detail=json.dumps({"entry_index": entry_index, "removed_entry": removed}, ensure_ascii=False),
    )
    return {"success": True, "message": "已刪除指定的 IP 檔案資料"}


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


_RECENT_UI_BAN_COMMANDS: list[dict] = []


OXOCRAFT_OPERATOR_NAME = "OxOcraft"

OXOCRAFT_DISPLAY_SOURCES = {
    "ui",
    "offline_ui_edit",
    "minecraft_json",
    "scheduler",
    "system",
}

SYSTEM_OPERATOR_NAMES = {
    "",
    "OxOcraft",
    "Rcon",
    "Minecraft",
}


def should_display_as_oxocraft(source: str, operator_name: str) -> bool:
    source = str(source or "").strip()
    operator_name = str(operator_name or "").strip()

    if source in OXOCRAFT_DISPLAY_SOURCES:
        return True

    if operator_name in SYSTEM_OPERATOR_NAMES:
        return True

    return False


def get_latest_player_ban_operator(
    player_uuid: str | None,
    player_name: str,
) -> dict:
    player_uuid = str(player_uuid or "").strip()
    player_name = str(player_name or "").strip()

    with get_connection() as conn:
        if player_uuid:
            row = conn.execute("""
                SELECT operator_name, operator_uuid, source
                FROM player_access_history
                WHERE category = 'ban'
                  AND action IN ('add', 'sync_add')
                  AND lower(target_uuid) = lower(?)
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            """, (player_uuid,)).fetchone()
        else:
            row = conn.execute("""
                SELECT operator_name, operator_uuid, source
                FROM player_access_history
                WHERE category = 'ban'
                  AND action IN ('add', 'sync_add')
                  AND lower(target_name) = lower(?)
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            """, (player_name,)).fetchone()

    if not row:
        return {
            "operator": OXOCRAFT_OPERATOR_NAME,
            "operator_uuid": None,
            "operator_account_type": None,
        }

    data = dict(row)
    operator_name = data.get("operator_name") or OXOCRAFT_OPERATOR_NAME
    operator_uuid = data.get("operator_uuid")
    source = data.get("source") or ""

    if should_display_as_oxocraft(source, operator_name):
        return {
            "operator": OXOCRAFT_OPERATOR_NAME,
            "operator_uuid": None,
            "operator_account_type": None,
        }

    return {
        "operator": operator_name,
        "operator_uuid": operator_uuid,
        "operator_account_type": (
            detect_account_type(operator_uuid)
            if operator_uuid
            else None
        ),
    }


def get_latest_ip_ban_operator(ip: str) -> dict:
    ip = str(ip or "").strip()

    with get_connection() as conn:
        row = conn.execute("""
            SELECT operator_name, operator_uuid, source
            FROM ip_ban_history
            WHERE action IN ('add', 'sync_add')
              AND ip = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        """, (ip,)).fetchone()

    if not row:
        return {
            "operator": OXOCRAFT_OPERATOR_NAME,
            "operator_uuid": None,
            "operator_account_type": None,
        }

    data = dict(row)
    operator_name = data.get("operator_name") or OXOCRAFT_OPERATOR_NAME
    operator_uuid = data.get("operator_uuid")
    source = data.get("source") or ""

    if should_display_as_oxocraft(source, operator_name):
        return {
            "operator": OXOCRAFT_OPERATOR_NAME,
            "operator_uuid": None,
            "operator_account_type": None,
        }

    return {
        "operator": operator_name,
        "operator_uuid": operator_uuid,
        "operator_account_type": (
            detect_account_type(operator_uuid)
            if operator_uuid
            else None
        ),
    }


def push_recent_ui_ban_command(
    action: str,
    player_name: str = "",
    ip: str = "",
) -> None:
    _RECENT_UI_BAN_COMMANDS.append({
        "action": action,
        "player_name": str(player_name or "").strip().lower(),
        "ip": str(ip or "").strip(),
        "created_at": datetime.now(),
    })


def pop_recent_ui_ban_command_if_match(
    action: str,
    player_name: str = "",
    ip: str = "",
    max_age_seconds: int = 5,
) -> bool:
    now = datetime.now()
    normalized_name = str(player_name or "").strip().lower()
    normalized_ip = str(ip or "").strip()

    for index, item in enumerate(list(_RECENT_UI_BAN_COMMANDS)):
        age = (now - item["created_at"]).total_seconds()

        if age > max_age_seconds:
            _RECENT_UI_BAN_COMMANDS.remove(item)
            continue

        if item.get("action") != action:
            continue

        if normalized_ip:
            if item.get("ip") == normalized_ip:
                _RECENT_UI_BAN_COMMANDS.pop(index)
                return True

            continue

        if (
            normalized_name
            and item.get("player_name") == normalized_name
        ):
            _RECENT_UI_BAN_COMMANDS.pop(index)
            return True

    return False



def get_ban_start_blocks() -> list[dict]:
    blocks = []
    for source, label, file, check in (
        ("ban_players", "玩家黑名單", "banned-players.json", get_banned_players_mutation_error),
        ("ban_ips", "IP 黑名單", "banned-ips.json", get_banned_ips_mutation_error),
    ):
        error = check()
        if error:
            blocks.append({"source": source, "label": label, "file": file, "reason": error["message"]})
    return blocks




def read_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []

    try:
        text = path.read_text(encoding="utf-8").strip()

        if not text:
            return []

        data = json.loads(text)

        if isinstance(data, list):
            return data

        return []

    except Exception:
        return []


def write_json_list(path: Path, data: list[dict]) -> None:
    content = json.dumps(data, ensure_ascii=False, indent=4)

    if path not in (BANNED_PLAYERS_FILE, BANNED_IPS_FILE):
        path.write_text(content, encoding="utf-8")
        return

    # 先完整寫入暫存檔，再替換正式檔，避免讀到寫入一半的 JSON。
    lock = _BANNED_IPS_FILE_LOCK if path == BANNED_IPS_FILE else _BANNED_PLAYERS_FILE_LOCK
    with lock:
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=path.parent,
                prefix=f".{path.stem}-", suffix=".tmp", delete=False,
            ) as file:
                temporary_path = Path(file.name)
                file.write(content)
                file.flush()
                os.fsync(file.fileno())

            os.replace(temporary_path, path)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)


def get_current_account_type() -> str:
    return "premium" if is_online_mode() else "offline"


def is_same_player_name(
    first_name: str,
    second_name: str,
) -> bool:
    first_name = str(first_name or "").strip()
    second_name = str(second_name or "").strip()

    if is_online_mode():
        return first_name.lower() == second_name.lower()

    return first_name == second_name


def get_active_banned_players() -> list[dict]:
    current_account_type = get_current_account_type()
    players = get_banned_players_from_db()

    result = []

    for player in players:
        operator_info = get_latest_player_ban_operator(
            player_uuid=player.get("player_uuid"),
            player_name=player.get("player_name"),
        )

        result.append({
            "player_uuid": player.get("player_uuid"),
            "player_name": player.get("player_name"),
            "account_type": player.get("account_type"),

            "target_uuid": player.get("player_uuid"),
            "target_name": player.get("player_name"),

            "reason": player.get("ban_reason") or "",
            "created_at": player.get("banned_since"),
            "expires_at": player.get("ban_expires_at"),
            "permanent": 0 if player.get("ban_expires_at") else 1,

            "operator": operator_info["operator"],
            "operator_uuid": operator_info["operator_uuid"],
            "operator_account_type": operator_info["operator_account_type"],

            "valid_for_current_mode": (
                player.get("account_type") == current_account_type
            ),
        })

    return result


def get_ban_expiry_from_json(
    entry: dict,
    stored_expiry: str | None = None,
) -> str | None:
    # forever 保留管理工具自己的定時期限；外部日期期限轉成 DB 的本機時間。
    if entry["expires"] == "forever":
        return stored_expiry

    return datetime.strptime(
        entry["expires"], "%Y-%m-%d %H:%M:%S %z"
    ).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def get_active_banned_players_from_json(
    entries: list[dict] | None = None,
) -> list[dict]:
    current_account_type = get_current_account_type()
    if entries is None:
        validated = load_validated_banned_players()
        entries = [item["entry"] for item in validated["valid_entries"]]

    items = entries

    result = []

    for item in items:
        player_uuid = str(item.get("uuid", "")).strip()
        player_name = str(item.get("name", "")).strip()

        if not player_uuid or not player_name:
            continue

        db_record = None

        with get_connection() as conn:
            row = conn.execute("""
                SELECT *
                FROM players
                WHERE lower(player_uuid) = lower(?)
                LIMIT 1
            """, (player_uuid,)).fetchone()

            db_record = dict(row) if row else None

        account_type = (
            db_record.get("account_type")
            if db_record
            else detect_account_type(player_uuid)
        )

        if db_record:
            expires_at = db_record.get("ban_expires_at")
            reason = (
                db_record.get("ban_reason")
                or item.get("reason", "")
                or ""
            )
        else:
            expires_at = None
            reason = item.get("reason", "") or ""

        expires_at = get_ban_expiry_from_json(item, expires_at)


        operator_info = get_latest_player_ban_operator(
            player_uuid=player_uuid,
            player_name=player_name,
        )


        result.append({
            "player_uuid": player_uuid,
            "player_name": player_name,
            "account_type": account_type,

            "target_uuid": player_uuid,
            "target_name": player_name,

            "reason": reason,
            "created_at": str(item.get("created", "")).replace(" +0800", ""),
            "expires_at": expires_at,
            "permanent": 0 if expires_at else 1,
            "operator": operator_info["operator"],
            "operator_uuid": operator_info["operator_uuid"],
            "operator_account_type": operator_info["operator_account_type"],

            "valid_for_current_mode": (
                account_type == current_account_type
            ),
        })

    return result


def get_active_banned_ips() -> list[dict]:
    rows = get_banned_ips_from_db()

    result = []

    for row in rows:
        ip = row.get("ip")

        operator_info = get_latest_ip_ban_operator(ip)

        result.append({
            "ip": ip,
            "target_name": ip,

            "reason": row.get("ban_reason") or "",
            "created_at": row.get("banned_since"),
            "expires_at": row.get("ban_expires_at"),
            "permanent": 0 if row.get("ban_expires_at") else 1,
            "operator": operator_info["operator"],
            "operator_uuid": operator_info["operator_uuid"],
            "operator_account_type": operator_info["operator_account_type"],
        })

    return result


def get_active_banned_ips_from_json(entries: list[dict] | None = None) -> list[dict]:
    if entries is None:
        validated = load_validated_banned_ips()
        entries = [item["entry"] for item in validated["valid_entries"]]
    result = []
    for item in entries:
        ip = item["ip"].strip()
        record = get_equivalent_banned_ip_from_db(ip)
        stored_expiry = record.get("ban_expires_at") if record else None
        expires_at = get_ban_expiry_from_json(item, stored_expiry)
        operator = get_latest_ip_ban_operator(record["ip"] if record else ip)
        result.append({
            "ip": ip, "target_name": ip,
            "reason": item["reason"], "created_at": item["created"],
            "expires_at": expires_at, "permanent": 0 if expires_at else 1,
            "operator": operator["operator"],
            "operator_uuid": operator["operator_uuid"],
            "operator_account_type": operator["operator_account_type"],
        })
    return result



def get_banned_player_by_uuid(player_uuid: str) -> dict | None:
    player_uuid = str(player_uuid or "").strip()

    if not player_uuid:
        return None

    with get_connection() as conn:
        row = conn.execute("""
            SELECT *
            FROM players
            WHERE lower(player_uuid) = lower(?)
              AND banned = 1
            LIMIT 1
        """, (player_uuid,)).fetchone()

    return dict(row) if row else None


def get_active_bans(target_type: str) -> list[dict]:
    if target_type == "player":
        if is_server_running():
            return get_active_banned_players()

        return get_active_banned_players_from_json()

    if target_type == "ip":
        if is_server_running():
            return get_active_banned_ips()

        return get_active_banned_ips_from_json()

    return []


def write_player_to_banned_json(
    player_uuid: str,
    player_name: str,
    reason: str,
    operator: str,
) -> None:
    with _BANNED_PLAYERS_FILE_LOCK:
        data = require_valid_banned_player_entries()

        normalized_uuid = str(player_uuid or "").strip().lower()

        data = [
            item
            for item in data
            if str(
                item.get("uuid", "")
            ).strip().lower() != normalized_uuid
        ]

        data.append({
            "uuid": player_uuid,
            "name": player_name,
            "created": datetime.now().strftime(
                "%Y-%m-%d %H:%M:%S +0800"
            ),
            "source": operator or "OxOcraft-Manager",
            "expires": "forever",
            "reason": (
                reason
                or "Banned by OxOcraft-Manager"
            ),
        })

        write_json_list(BANNED_PLAYERS_FILE, data)


def ban_player(
    player_name: str,
    reason: str = "",
    operator: str = "OxOcraft",
    expires_at: str | None = None,
    permanent: bool = True,
    selected_from_candidate: bool = False,
    candidate_uuid: str | None = None,
    candidate_account_type: str | None = None,
    history_source: str | None = None,
) -> dict:
    player_name = str(player_name or "").strip()

    if not is_server_running():
        error = get_banned_players_mutation_error()
        if error:
            return error

    reason = str(reason or "").strip()
    if not reason:
        reason = "已被管理員封鎖。"

    operator = str(operator or "OxOcraft").strip()

    if not player_name:
        return {
            "success": False,
            "message": "請輸入玩家名稱",
        }

    if (
        not can_add_ban_player_by_name()
        and not selected_from_candidate
    ):
        return {
            "success": False,
            "message": (
                "離線模式且伺服器在線時，"
                "不能手動輸入玩家名稱新增黑名單。"
                "請先讓玩家進入伺服器一次，再從"
                "「之前加入過的玩家」清單加入。"
            ),
        }

    if selected_from_candidate and candidate_uuid:
        player_uuid = str(candidate_uuid).strip()
        account_type = str(
            candidate_account_type
            or detect_account_type(player_uuid)
        ).strip()
    else:
        identity = resolve_player_identity_by_name(player_name)

        if not identity["success"]:
            return {
                "success": False,
                "message": identity["message"],
            }

        player_uuid = identity["player_uuid"]
        player_name = identity["player_name"]
        account_type = identity["account_type"] or detect_account_type(player_uuid)


    existing_ban = get_banned_player_by_uuid(player_uuid)

    if existing_ban:
        return {
            "success": False,
            "message": f"{player_name} 已經在玩家黑名單中，不能重複加入。",
        }

    if is_server_running():
        push_recent_ui_ban_command(
            action="add",
            player_name=player_name,
        )

        command = f"ban {player_name} {reason}".strip()
        result = send_rcon_command(command)
    else:
        write_player_to_banned_json(
            player_uuid=player_uuid,
            player_name=player_name,
            reason=reason,
            operator=operator,
        )

        result = "已寫入 banned-players.json"

    update_player_ban_status(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        banned=True,
        reason=reason,
        expires_at=expires_at,
    )

    record_player_access(
        category="ban",
        action="add",
        target_uuid=player_uuid,
        target_name=player_name,
        account_type=account_type,
        operator_name=operator,
        source=history_source or (
            "ui"
            if is_server_running()
            else "offline_ui_edit"
        ),
        detail=result,
        expires_at=expires_at,
    )

    return {
        "success": True,
        "message": f"已封鎖玩家 {player_name}",
        "result": result,
    }


def remove_player_from_banned_json(
    player_uuid: str | None,
    player_name: str,
) -> bool:
    with _BANNED_PLAYERS_FILE_LOCK:
        data = require_valid_banned_player_entries()

        original_count = len(data)

        normalized_uuid = str(
            player_uuid or ""
        ).strip().lower()

        def should_remove(item: dict) -> bool:
            item_uuid = str(
                item.get("uuid", "")
            ).strip().lower()

            item_name = str(
                item.get("name", "")
            ).strip()

            if normalized_uuid:
                return item_uuid == normalized_uuid

            return is_same_player_name(
                item_name,
                player_name,
            )

        data = [
            item
            for item in data
            if not should_remove(item)
        ]

        if len(data) == original_count:
            return False

        write_json_list(BANNED_PLAYERS_FILE, data)
        return True


def unban_player_by_uuid(
    player_uuid: str,
    operator: str = "OxOcraft",
) -> dict:
    if not is_server_running():
        error = get_banned_players_mutation_error()
        if error:
            return error

    player = get_banned_player_by_uuid(player_uuid)

    if not player:
        return {
            "success": False,
            "message": "找不到此玩家封鎖狀態",
        }

    player_name = player.get("player_name") or ""
    account_type = player.get("account_type") or detect_account_type(player_uuid)

    if is_server_running():
        push_recent_ui_ban_command(
            action="remove",
            player_name=player_name,
        )

        result = send_rcon_command(f"pardon {player_name}")
    else:
        removed = remove_player_from_banned_json(
            player_uuid=player_uuid,
            player_name=player_name,
        )

        result = (
            "已從 banned-players.json 移除"
            if removed
            else "banned-players.json 中已不存在此玩家"
        )

    update_player_ban_status(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        banned=False,
        reason="",
        expires_at=None,
    )

    record_player_access(
        category="ban",
        action="remove",
        target_uuid=player_uuid,
        target_name=player_name,
        account_type=account_type,
        operator_name=operator,
        source=(
            "ui"
            if is_server_running()
            else "offline_ui_edit"
        ),
        detail=result,
    )

    return {
        "success": True,
        "message": f"已解除玩家 {player_name} 的封鎖",
        "result": result,
    }


def sync_ban_player_from_log(
    player_name: str,
    operator_name: str = "未知",
    source: str = "player_command",
    detail: str = "",
    write_history: bool = True,
    expires_at: str | None = None,
) -> None:
    player_name = str(player_name or "").strip()

    if not player_name:
        return

    player_uuid = ""
    reason = ""

    for item in read_json_list(BANNED_PLAYERS_FILE):
        if not isinstance(item, dict):
            continue

        json_name = str(
            item.get("name", "")
        ).strip()

        if not is_same_player_name(
            json_name,
            player_name,
        ):
            continue

        player_uuid = str(item.get("uuid", "")).strip()
        player_name = json_name or player_name
        reason = str(item.get("reason", "") or "").strip()
        break

    if not player_uuid:
        player_uuid = resolve_player_uuid(player_name)

        if not player_uuid:
            print("[PlayerBan] cannot resolve banned player uuid:", player_name)
            return

    account_type = detect_account_type(player_uuid)

    update_player_ban_status(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        banned=True,
        reason=reason,
        expires_at=expires_at,
    )

    if write_history:
        record_player_access(
            category="ban",
            action="add",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=account_type,
            operator_name=operator_name,
            source=source,
            detail=detail,
        )


def sync_unban_player_from_log(
    player_name: str,
    operator_name: str = "未知",
    source: str = "player_command",
    detail: str = "",
    write_history: bool = True,
) -> None:
    player_name = str(player_name or "").strip()

    if not player_name:
        return

    player_uuid = resolve_player_uuid(player_name)

    if not player_uuid:
        print("[PlayerBan] cannot resolve unbanned player uuid:", player_name)
        return

    account_type = detect_account_type(player_uuid)

    update_player_ban_status(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        banned=False,
        reason="",
        expires_at=None,
    )

    if write_history:
        record_player_access(
            category="ban",
            action="remove",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=account_type,
            operator_name=operator_name,
            source=source,
            detail=detail,
        )


def sync_ban_ip_from_log(
    ip: str,
    operator_name: str = "未知",
    operator_uuid: str | None = None,
    source: str = "player_command",
    detail: str = "",
) -> None:
    ip = str(ip or "").strip()

    if not ip:
        return

    reason = ""

    for item in read_json_list(BANNED_IPS_FILE):
        if str(item.get("ip", "")).strip() == ip:
            reason = str(item.get("reason", "") or "").strip()
            break

    update_ip_ban_status(
        ip=ip,
        banned=True,
        reason=reason,
        operator_name=operator_name,
        operator_uuid=operator_uuid,
        expires_at=None,
    )

    record_ip_ban_history(
        action="add",
        ip=ip,
        reason=reason,
        operator_name=operator_name,
        operator_uuid=operator_uuid,
        source=source,
        detail=detail,
    )


def sync_unban_ip_from_log(
    ip: str,
    operator_name: str = "未知",
    operator_uuid: str | None = None,
    source: str = "player_command",
    detail: str = "",
) -> None:
    ip = str(ip or "").strip()

    if not ip:
        return

    update_ip_ban_status(
        ip=ip,
        banned=False,
        reason="",
        operator_name=operator_name,
        operator_uuid=operator_uuid,
        expires_at=None,
    )

    record_ip_ban_history(
        action="remove",
        ip=ip,
        reason="",
        operator_name=operator_name,
        operator_uuid=operator_uuid,
        source=source,
        detail=detail,
    )


def validate_ip(ip: str) -> tuple[bool, str]:
    try:
        normalize_banned_ip(ip)
        return True, ""
    except ValueError:
        return False, "IP 格式不正確，請填入純 IPv4 或 IPv6 位址"



def ip_exists_in_banned_json(ip: str) -> bool:
    validated = load_validated_banned_ips()
    error = get_banned_ips_mutation_error(validated)
    if error:
        raise BannedIpsDataError(error)
    normalized_ip = normalize_banned_ip(ip)
    return any(normalize_banned_ip(item["ip"]) == normalized_ip for item in validated["entries"])



def write_ip_to_banned_json(ip: str, reason: str, operator: str) -> None:
    with _BANNED_IPS_FILE_LOCK:
        data = require_valid_banned_ip_entries()
        normalized_ip = normalize_banned_ip(ip)
        if any(normalize_banned_ip(item["ip"]) == normalized_ip for item in data):
            raise BannedIpsDataError({"success": False, "data_status": "entry_changed", "message": "此 IP 已經在黑名單中，請重新整理"})
        data.append({
            "ip": normalized_ip,
            "created": datetime.now().strftime("%Y-%m-%d %H:%M:%S +0800"),
            "source": operator or "OxOcraft-Manager",
            "expires": "forever", "reason": reason or "Banned by OxOcraft-Manager",
        })
        write_json_list(BANNED_IPS_FILE, data)



def ban_ip(
    ip: str,
    reason: str = "",
    operator: str = "OxOcraft",
    expires_at: str | None = None,
    permanent: bool = True,
) -> dict:
    ip = str(ip or "").strip()

    reason = str(reason or "").strip()
    if not reason:
        reason = "已被管理員封鎖。"

    operator = str(operator or "OxOcraft").strip()

    valid, message = validate_ip(ip)

    if not valid:
        return {
            "success": False,
            "message": message,
        }
    

    if not is_server_running():
        error = get_banned_ips_mutation_error()
        if error:
            return error

    existing_ip_ban = get_equivalent_banned_ip_from_db(ip)

    if existing_ip_ban:
        return {
            "success": False,
            "message": f"IP {ip} 已經在黑名單中，不能重複加入。",
        }


    if is_server_running():
        push_recent_ui_ban_command(
            action="add",
            ip=ip,
        )

        command = f"ban-ip {ip} {reason}".strip()
        result = send_rcon_command(command)
        source = "ui"
    else:
        write_ip_to_banned_json(
            ip=ip,
            reason=reason,
            operator=operator,
        )

        result = "已寫入 banned-ips.json"
        source = "offline_ui_edit"

    update_ip_ban_status(
        ip=ip,
        banned=True,
        reason=reason,
        operator_name=operator,
        operator_uuid=None,
        expires_at=expires_at,
    )

    record_ip_ban_history(
        action="add",
        ip=ip,
        reason=reason,
        operator_name=operator,
        operator_uuid=None,
        source=source,
        detail=result,
        expires_at=expires_at,
    )

    return {
        "success": True,
        "message": f"已封鎖 IP {ip}",
        "result": result,
    }


def remove_ip_from_banned_json(ip: str) -> bool:
    with _BANNED_IPS_FILE_LOCK:
        data = require_valid_banned_ip_entries()
        normalized_ip = normalize_banned_ip(ip)
        remaining = [item for item in data if normalize_banned_ip(item["ip"]) != normalized_ip]
        if len(remaining) == len(data):
            return False
        write_json_list(BANNED_IPS_FILE, remaining)
        return True



def unban_ip(
    ip: str,
    operator: str = "OxOcraft",
) -> dict:
    ip = str(ip or "").strip()
    operator = str(operator or "OxOcraft").strip()

    if not ip:
        return {
            "success": False,
            "message": "缺少 IP",
        }

    valid, message = validate_ip(ip)
    if not valid:
        return {"success": False, "message": message}
    if not is_server_running():
        error = get_banned_ips_mutation_error()
        if error:
            return error
    record = get_equivalent_banned_ip_from_db(ip)
    # 沿用既有 DB 的 IP 字串，保留舊 IPv6 寫法所對應的紀錄。
    if record:
        ip = record["ip"]

    if is_server_running():

        if not record:
            return {
                "success": False,
                "message": "找不到此IP封鎖狀態",
            }

        push_recent_ui_ban_command(
            action="remove",
            ip=ip,
        )

        result = send_rcon_command(f"pardon-ip {ip}")

        update_ip_ban_status(
            ip=ip,
            banned=False,
            reason="",
            operator_name=operator,
            operator_uuid=None,
            expires_at=None,
        )

        record_ip_ban_history(
            action="remove",
            ip=ip,
            reason="手動解除IP封鎖",
            operator_name=operator,
            operator_uuid=None,
            source="ui",
            detail=result,
        )

    else:
        removed = remove_ip_from_banned_json(ip)

        result = (
            "已從 banned-ips.json 移除"
            if removed
            else "banned-ips.json 中已不存在此 IP"
        )

        update_ip_ban_status(
            ip=ip,
            banned=False,
            reason="",
            operator_name=operator,
            operator_uuid=None,
            expires_at=None,
        )

        record_ip_ban_history(
            action="remove",
            ip=ip,
            reason="手動解除IP封鎖",
            operator_name=operator,
            operator_uuid=None,
            source="offline_ui_edit",
            detail=result,
        )

    return {
        "success": True,
        "message": f"已解除 IP {ip} 的封鎖",
        "result": result,
    }


def parse_expire_payload(data: dict) -> tuple[bool, str | None, bool, str]:
    """
    回傳：
    success, expires_at, permanent, message

    data 可接受：
    {
        "expire_type": "forever"
    }

    {
        "expire_type": "duration",
        "days": 1,
        "hours": 2,
        "minutes": 30
    }

    {
        "expire_type": "datetime",
        "expires_at": "2026-06-03 20:06:50"
    }
    """

    expire_type = str(data.get("expire_type", "forever")).strip()

    if expire_type == "forever":
        return True, None, True, ""

    if expire_type == "duration":
        try:
            days = int(data.get("days", 0) or 0)
            hours = int(data.get("hours", 0) or 0)
            minutes = int(data.get("minutes", 0) or 0)
        except ValueError:
            return False, None, False, "封鎖時間格式錯誤"

        if days <= 0 and hours <= 0 and minutes <= 0:
            return False, None, False, "請輸入封鎖時間"

        expires_at = datetime.now() + timedelta(
            days=days,
            hours=hours,
            minutes=minutes,
        )

        return (
            True,
            expires_at.strftime("%Y-%m-%d %H:%M:%S"),
            False,
            ""
        )

    if expire_type == "datetime":
        expires_at_text = str(data.get("expires_at", "")).strip()

        if not expires_at_text:
            return False, None, False, "請選擇解除時間"

        try:
            expires_at = datetime.strptime(
                expires_at_text,
                "%Y-%m-%d %H:%M:%S"
            )
        except ValueError:
            try:
                expires_at = datetime.strptime(
                    expires_at_text,
                    "%Y-%m-%d %H:%M"
                )
            except ValueError:
                return False, None, False, "解除時間格式錯誤"

        if expires_at <= datetime.now():
            return False, None, False, "解除時間必須晚於現在"

        return (
            True,
            expires_at.strftime("%Y-%m-%d %H:%M:%S"),
            False,
            ""
        )

    return False, None, False, "未知的封鎖期限類型"


def ip_ban_exists_in_json(record: dict) -> bool:
    if record.get("target_type") != "ip":
        return False

    return ip_exists_in_banned_json(
        record.get("target_name") or ""
    )


def get_expired_active_bans() -> list[dict]:
    now = now_text()

    expired = []

    with get_connection() as conn:
        player_rows = conn.execute("""
            SELECT
                'player' AS target_type,
                player_uuid AS target_uuid,
                player_name AS target_name,
                account_type,
                ban_reason AS reason,
                ban_expires_at AS expires_at
            FROM players
            WHERE banned = 1
              AND ban_expires_at IS NOT NULL
              AND ban_expires_at <= ?
        """, (now,)).fetchall()

        ip_rows = conn.execute("""
            SELECT
                'ip' AS target_type,
                NULL AS target_uuid,
                ip AS target_name,
                NULL AS account_type,
                ban_reason AS reason,
                ban_expires_at AS expires_at
            FROM ip_records
            WHERE banned = 1
              AND ban_expires_at IS NOT NULL
              AND ban_expires_at <= ?
        """, (now,)).fetchall()

    expired.extend(dict(row) for row in player_rows)
    expired.extend(dict(row) for row in ip_rows)

    return expired


def process_expired_ban(record: dict) -> dict:
    target_type = record.get("target_type")
    target_name = record.get("target_name") or ""
    target_uuid = record.get("target_uuid")
    account_type = record.get("account_type")
    reason = record.get("reason") or "封鎖期限到期"

    if target_type == "player":
        if is_server_running():
            result = send_rcon_command(f"pardon {target_name}")
        else:
            removed = remove_player_from_banned_json(
                player_uuid=target_uuid,
                player_name=target_name,
            )

            result = (
                "已從 banned-players.json 移除"
                if removed
                else "banned-players.json 中已不存在此玩家"
            )

        update_player_ban_status(
            player_uuid=target_uuid,
            player_name=target_name,
            account_type=account_type or detect_account_type(target_uuid),
            banned=False,
            reason="",
            expires_at=None,
        )

        record_player_access(
            category="ban",
            action="expired_remove",
            target_uuid=target_uuid,
            target_name=target_name,
            account_type=account_type,
            operator_name="OxOcraft",
            source="scheduler",
            detail=result,
        )

        create_notification(
            title="黑名單已自動解除",
            message=f"玩家{target_name}的封鎖期限已到，系統已自動解除封鎖。",
            type="success",
            source="player_ban_scheduler",
        )

        return {
            "success": True,
            "action": "expired_unban_player",
            "target": target_name,
            "result": result,
        }

    if target_type == "ip":
        if is_server_running():
            result = send_rcon_command(f"pardon-ip {target_name}")
        else:
            removed = remove_ip_from_banned_json(target_name)

            result = (
                "已從 banned-ips.json 移除"
                if removed
                else "banned-ips.json 中已不存在此 IP"
            )

        update_ip_ban_status(
            ip=target_name,
            banned=False,
            reason="",
            operator_name="OxOcraft",
            operator_uuid=None,
            expires_at=None,
        )

        record_ip_ban_history(
            action="expired_remove",
            ip=target_name,
            reason=reason,
            operator_name="OxOcraft",
            operator_uuid=None,
            source="scheduler",
            detail=result,
        )

        create_notification(
            title="IP 黑名單已自動解除",
            message=f"IP：{target_name}的封鎖期限已到，系統已自動解除封鎖。",
            type="success",
            source="player_ban_scheduler",
        )

        return {
            "success": True,
            "action": "expired_unban_ip",
            "target": target_name,
            "result": result,
        }

    return {
        "success": False,
        "message": "未知的封鎖類型",
        "target": target_name,
    }


def process_expired_bans() -> list[dict]:
    records = get_expired_active_bans()
    results = []

    for record in records:
        try:
            results.append(
                process_expired_ban(record)
            )
        except Exception as error:
            results.append({
                "success": False,
                "record_id": record.get("id"),
                "message": str(error),
            })

    return results


def sync_banned_players_json_to_db(
    validated: dict | None = None,
) -> dict:
    synced_players = 0
    removed_players = 0

    if validated is None:
        validated = load_validated_banned_players()

    error = get_banned_players_mutation_error(validated)

    if error:
        return {
            "synced_players": 0,
            "removed_players": 0,
            "player_sync_status": error["data_status"],
            "player_error_code": error.get("error_code"),
        }

    players = [item["entry"] for item in validated["valid_entries"]]

    active_uuid_set = {
        str(item.get("uuid", "")).strip().lower()
        for item in players
        if item.get("uuid")
    }

    with get_connection() as conn:
        for item in players:
            player_name = str(item.get("name", "")).strip()
            player_uuid = str(item.get("uuid", "")).strip()
            reason = str(item.get("reason", "") or "").strip()
            operator = "banned-players.json 同步"
            account_type = detect_account_type(player_uuid)

            if not player_name or not player_uuid:
                continue

            existing = conn.execute("""
                SELECT banned, ban_expires_at
                FROM players
                WHERE lower(player_uuid) = lower(?)
                LIMIT 1
            """, (
                player_uuid,
            )).fetchone()

            was_banned = bool(
                existing and int(existing["banned"] or 0) == 1
            )

            expires_at = (
                existing["ban_expires_at"]
                if existing
                else None
            )

            expires_at = get_ban_expiry_from_json(item, expires_at)

            print("[BanSync] sync player:", {
                "player_uuid": player_uuid,
                "player_name": player_name,
                "operator": operator,
                "reason": reason,
            })

            update_player_ban_status(
                player_uuid=player_uuid,
                player_name=player_name,
                account_type=account_type,
                banned=True,
                reason=reason,
                expires_at=expires_at,
            )

            if not was_banned:
                record_player_access(
                    category="ban",
                    action="sync_add",
                    target_uuid=player_uuid,
                    target_name=player_name,
                    account_type=account_type,
                    operator_name=operator,
                    source="minecraft_json",
                    detail="從banned-players.json同步",
                )

                synced_players += 1

        rows = conn.execute("""
            SELECT player_uuid, player_name, account_type
            FROM players
            WHERE banned = 1
        """).fetchall()

        records = [dict(row) for row in rows]

    for record in records:
        player_uuid = str(record.get("player_uuid", "")).strip()
        player_name = str(record.get("player_name", "")).strip()
        account_type = record.get("account_type")

        if not player_uuid:
            continue

        if player_uuid.lower() in active_uuid_set:
            continue

        update_player_ban_status(
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=account_type or detect_account_type(player_uuid),
            banned=False,
            reason="",
            expires_at=None,
        )

        record_player_access(
            category="ban",
            action="sync_remove",
            target_uuid=player_uuid,
            target_name=player_name,
            account_type=account_type,
            operator_name="banned-players.json 同步",
            source="minecraft_json",
            detail="從 banned-players.json 同步解除",
        )

        removed_players += 1

    return {
        "synced_players": synced_players,
        "removed_players": removed_players,
        "player_sync_status": "success",
        "player_error_code": None,
    }


def sync_banned_ips_json_to_db(validated: dict | None = None) -> dict:
    if validated is None:
        validated = load_validated_banned_ips()
    error = get_banned_ips_mutation_error(validated)
    if error:
        return {"synced_ips": 0, "removed_ips": 0, "ip_sync_status": error["data_status"]}
    entries = [item["entry"] for item in validated["valid_entries"]]
    active_ip_set = {normalize_banned_ip(item["ip"]) for item in entries}
    synced_ips = 0
    removed_ips = 0
    for item in entries:
        normalized_ip = normalize_banned_ip(item["ip"])
        existing = get_equivalent_banned_ip_from_db(normalized_ip)
        ip = existing["ip"] if existing else normalized_ip
        stored_expiry = existing.get("ban_expires_at") if existing else None
        expires_at = get_ban_expiry_from_json(item, stored_expiry)
        update_ip_ban_status(
            ip=ip, banned=True, reason=item["reason"],
            operator_name="banned-ips.json 同步", expires_at=expires_at,
        )
        if not existing:
            record_ip_ban_history(
                action="sync_add", ip=ip, reason=item["reason"],
                operator_name="banned-ips.json 同步", source="minecraft_json",
                detail="從 banned-ips.json 同步",
            )
            synced_ips += 1
    for record in get_banned_ips_from_db():
        ip = record["ip"]
        try:
            if normalize_banned_ip(ip) in active_ip_set:
                continue
        except ValueError:
            # 舊 DB 中若有異常 IP，留給恢復檔案時提示，不在此自動解除。
            continue
        update_ip_ban_status(ip=ip, banned=False, operator_name="banned-ips.json 同步")
        record_ip_ban_history(
            action="sync_remove", ip=ip, reason="從 banned-ips.json 同步解除",
            operator_name="banned-ips.json 同步", source="minecraft_json",
            detail="從 banned-ips.json 同步解除",
        )
        removed_ips += 1
    return {"synced_ips": synced_ips, "removed_ips": removed_ips, "ip_sync_status": "success"}



def sync_banned_json_to_db() -> dict:
    player_result = sync_banned_players_json_to_db()
    ip_result = sync_banned_ips_json_to_db()

    synced_players = player_result["synced_players"]
    removed_players = player_result["removed_players"]

    synced_ips = ip_result["synced_ips"]
    removed_ips = ip_result["removed_ips"]

    if synced_players > 0 or removed_players > 0:
        create_notification(
            title="玩家黑名單已同步改動",
            message=(
                f"資料同步重新載入玩家黑名單，"
                f"新增 {synced_players} 位，"
                f"移除 {removed_players} 位。"
            ),
            type="info",
            source="player_ban",
        )

    if synced_ips > 0 or removed_ips > 0:
        create_notification(
            title="IP 黑名單已同步改動",
            message=(
                f"資料同步重新載入 IP 黑名單，"
                f"新增 {synced_ips} 筆，"
                f"移除 {removed_ips} 筆。"
            ),
            type="info",
            source="player_ban",
        )

    return {
        **player_result,
        **ip_result,
    }


def deactivate_all_active_bans_by_mode_change() -> dict:
    now = now_text()

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ip_records
            WHERE banned = 1
        """).fetchall()

    records = [dict(row) for row in rows]

    for record in records:
        ip = str(record.get("ip", "")).strip()

        if not ip:
            continue

        update_ip_ban_status(
            ip=ip,
            banned=False,
            reason="",
            operator_name="OxOcraft",
            operator_uuid=None,
            expires_at=None,
        )

        record_ip_ban_history(
            action="mode_changed_clear_ip_ban",
            ip=ip,
            reason="切換正版驗證 / 離線模式，清除舊IP黑名單資料",
            operator_name="OxOcraft",
            operator_uuid=None,
            source="system",
            detail="online-mode changed",
            created_at=now,
        )

    return {
        "cleared": len(records),
    }


def can_add_ban_player_by_name() -> bool:
    if not is_server_running():
        return True

    return is_online_mode()


def get_player_ban_candidate_list() -> list[dict]:
    active_bans = get_active_bans("player")
    online_uuid_set = get_online_uuid_set()

    banned_uuid_set = {
        str(item.get("target_uuid", "")).lower()
        for item in active_bans
        if item.get("target_uuid")
    }

    if is_server_running() and not is_online_mode():
        players = get_current_usercache_players()
    else:
        players = get_known_players()

    current_account_type = get_current_account_type()

    result = []

    for player in players:
        if int(player.get("show_in_player_candidates", 1) or 0) != 1:
            continue

        player_uuid = str(player.get("player_uuid", "")).lower()
        account_type = player.get("account_type")

        if account_type != current_account_type:
            continue

        if player_uuid in banned_uuid_set:
            continue

        result.append({
            **player,
            "banned": False,
            "online": player_uuid in online_uuid_set,
        })

    return result


def get_ip_ban_candidate_list() -> list[dict]:
    active_bans = get_active_bans("ip")

    banned_ip_set = {
        str(
            item.get("target_name", "")
        ).strip()
        for item in active_bans
        if item.get("target_name")
    }

    records = get_ip_player_history()

    result = []

    for record in records:
        ip = str(
            record.get("ip", "")
        ).strip()

        if not ip:
            continue

        if ip in banned_ip_set:
            continue

        result.append({
            **record,
            "banned": False,
        })

    return result


def sync_removed_bans_from_json() -> dict:
    validated = load_validated_banned_ips()
    error = get_banned_ips_mutation_error(validated)
    if error:
        return {"removed_players": 0, "removed_ips": 0, "ip_sync_status": error["data_status"]}
    ip_set = {normalize_banned_ip(item["entry"]["ip"]) for item in validated["valid_entries"]}

    removed_ips = 0

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT ip
            FROM ip_records
            WHERE banned = 1
        """).fetchall()

    for row in rows:
        ip = str(row["ip"]).strip()

        try:
            if normalize_banned_ip(ip) in ip_set:
                continue
        except ValueError:
            continue

        update_ip_ban_status(
            ip=ip,
            banned=False,
            reason="",
            operator_name="banned-ips.json 同步",
            operator_uuid=None,
            expires_at=None,
        )

        record_ip_ban_history(
            action="sync_remove",
            ip=ip,
            reason="從 banned-ips.json 同步解除",
            operator_name="banned-ips.json 同步",
            operator_uuid=None,
            source="minecraft_json",
            detail="從 banned-ips.json 同步解除",
        )

        removed_ips += 1

    return {
        "removed_players": 0,
        "removed_ips": removed_ips,
    }
