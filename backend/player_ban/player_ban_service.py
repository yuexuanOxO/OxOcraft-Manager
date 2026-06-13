import ipaddress
import json
from datetime import datetime, timedelta
from pathlib import Path

from backend.paths import MC_ROOT
from backend.rcon_service import send_rcon_command
from backend.server_runtime import is_server_running
from backend.routes.player_routes import (
    resolve_player_uuid,
    is_online_mode,
)

from backend.player_permissions.player_identity_service import (
    get_known_players,
    get_current_usercache_players,
    get_account_type as detect_account_type,
)

from backend.db import (
    get_connection,
    update_player_ban_status,
    get_banned_players_from_db,

    update_ip_ban_status,
    get_banned_ips_from_db,
    get_banned_ip_from_db,
    record_ip_ban_history,
)

from backend.player_permissions.player_access_history_service import (
    record_player_access,
)


BANNED_PLAYERS_FILE = MC_ROOT / "banned-players.json"
BANNED_IPS_FILE = MC_ROOT / "banned-ips.json"


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
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=4),
        encoding="utf-8"
    )


def get_current_account_type() -> str:
    return "premium" if is_online_mode() else "offline"


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


def get_active_banned_players_from_json() -> list[dict]:
    current_account_type = get_current_account_type()
    items = read_json_list(BANNED_PLAYERS_FILE)

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


def get_active_banned_ips_from_json() -> list[dict]:
    items = read_json_list(BANNED_IPS_FILE)

    result = []

    for item in items:
        ip = str(item.get("ip", "")).strip()

        if not ip:
            continue

        db_record = None

        with get_connection() as conn:
            row = conn.execute("""
                SELECT *
                FROM ip_records
                WHERE ip = ?
                LIMIT 1
            """, (ip,)).fetchone()

            db_record = dict(row) if row else None

        if db_record:
            expires_at = db_record.get("ban_expires_at")
            reason = db_record.get("ban_reason") or item.get("reason", "") or ""
        else:
            expires_at = None
            reason = item.get("reason", "") or ""

        operator_info = get_latest_ip_ban_operator(ip)

        result.append({
            "ip": ip,
            "target_name": ip,
            "reason": reason,
            "created_at": str(item.get("created", "")).replace(" +0800", ""),
            "expires_at": expires_at,
            "permanent": 0 if expires_at else 1,
            "operator": operator_info["operator"],
            "operator_uuid": operator_info["operator_uuid"],
            "operator_account_type": operator_info["operator_account_type"],
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

def get_ban_history(limit: int = 100) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT
                id,
                action,
                'ip' AS target_type,
                ip AS target_name,
                NULL AS target_uuid,
                reason,
                operator_name AS operator,
                expires_at,
                created_at,
                NULL AS ban_record_id,
                detail
            FROM ip_ban_history
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        """, (limit,)).fetchall()

    return [dict(row) for row in rows]


def write_player_to_banned_json(
    player_uuid: str,
    player_name: str,
    reason: str,
    operator: str,
) -> None:
    data = read_json_list(BANNED_PLAYERS_FILE)

    data = [
        item for item in data
        if str(item.get("uuid", "")).lower() != player_uuid.lower()
        and str(item.get("name", "")).lower() != player_name.lower()
    ]

    data.append({
        "uuid": player_uuid,
        "name": player_name,
        "created": datetime.now().strftime("%Y-%m-%d %H:%M:%S +0800"),
        "source": operator or "OxOcraft-Manager",
        "expires": "forever",
        "reason": reason or "Banned by OxOcraft-Manager",
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
) -> dict:
    player_name = str(player_name or "").strip()

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
        player_uuid = resolve_player_uuid(player_name)

        if not player_uuid:
            return {
                "success": False,
                "message": f"無法取得玩家 {player_name} 的 UUID",
            }

        account_type = detect_account_type(player_uuid)

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
        source=(
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
    data = read_json_list(BANNED_PLAYERS_FILE)

    original_count = len(data)

    data = [
        item for item in data
        if not (
            (
                player_uuid
                and str(item.get("uuid", "")).lower()
                == player_uuid.lower()
            )
            or (
                str(item.get("name", "")).lower()
                == player_name.lower()
            )
        )
    ]

    if len(data) == original_count:
        return False

    write_json_list(BANNED_PLAYERS_FILE, data)
    return True


def unban_player_by_uuid(
    player_uuid: str,
    operator: str = "OxOcraft",
) -> dict:
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

    player_uuid = resolve_player_uuid(player_name)

    if not player_uuid:
        print("[PlayerBan] cannot resolve banned player uuid:", player_name)
        return

    account_type = detect_account_type(player_uuid)

    # 從 Minecraft 寫好的 banned-players.json 補 reason
    reason = ""

    for item in read_json_list(BANNED_PLAYERS_FILE):
        if (
            str(item.get("uuid", "")).lower() == player_uuid.lower()
            or str(item.get("name", "")).lower() == player_name.lower()
        ):
            reason = str(item.get("reason", "") or "").strip()
            break

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
    ip = str(ip or "").strip()

    if not ip:
        return False, "請輸入 IP"

    try:
        ipaddress.ip_address(ip)
        return True, ""
    except ValueError:
        return False, "IP 格式不正確"


def ip_exists_in_banned_json(ip: str) -> bool:
    data = read_json_list(BANNED_IPS_FILE)

    return any(
        str(item.get("ip", "")).strip() == ip
        for item in data
    )


def write_ip_to_banned_json(
    ip: str,
    reason: str,
    operator: str,
) -> None:
    data = read_json_list(BANNED_IPS_FILE)

    data = [
        item for item in data
        if str(item.get("ip", "")).strip() != ip
    ]

    data.append({
        "ip": ip,
        "created": datetime.now().strftime("%Y-%m-%d %H:%M:%S +0800"),
        "source": operator or "OxOcraft-Manager",
        "expires": "forever",
        "reason": reason or "Banned by OxOcraft-Manager",
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
    data = read_json_list(BANNED_IPS_FILE)

    original_count = len(data)

    data = [
        item for item in data
        if str(item.get("ip", "")).strip() != ip
    ]

    if len(data) == original_count:
        return False

    write_json_list(BANNED_IPS_FILE, data)
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

    if is_server_running():
        record = get_banned_ip_from_db(ip)

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


def sync_banned_players_json_to_db() -> dict:
    synced_players = 0
    removed_players = 0

    players = read_json_list(BANNED_PLAYERS_FILE)

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
    }


def sync_banned_ips_json_to_db() -> dict:
    synced_ips = 0
    removed_ips = 0

    ips = read_json_list(BANNED_IPS_FILE)

    active_ip_set = {
        str(item.get("ip", "")).strip()
        for item in ips
        if item.get("ip")
    }

    for item in ips:
        ip = str(item.get("ip", "")).strip()

        if not ip:
            continue

        existing = get_banned_ip_from_db(ip)

        expires_at = (
            existing.get("ban_expires_at")
            if existing
            else None
        )

        update_ip_ban_status(
            ip=ip,
            banned=True,
            reason=str(item.get("reason", "") or "").strip(),
            operator_name="banned-ips.json 同步",
            operator_uuid=None,
            expires_at=expires_at,
        )

        if not existing:
            record_ip_ban_history(
                action="sync_add",
                ip=ip,
                reason=str(item.get("reason", "") or "").strip(),
                operator_name="banned-ips.json 同步",
                operator_uuid=None,
                source="minecraft_json",
                detail="從 banned-ips.json 同步",
            )

            synced_ips += 1

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT ip
            FROM ip_records
            WHERE banned = 1
        """).fetchall()

    for row in rows:
        ip = str(row["ip"]).strip()

        if ip in active_ip_set:
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
        "synced_ips": synced_ips,
        "removed_ips": removed_ips,
    }


def sync_banned_json_to_db() -> dict:
    player_result = sync_banned_players_json_to_db()
    ip_result = sync_banned_ips_json_to_db()

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
        })

    return result


def sync_removed_bans_from_json() -> dict:
    ip_entries = read_json_list(BANNED_IPS_FILE)

    ip_set = {
        str(item.get("ip", "")).strip()
        for item in ip_entries
        if item.get("ip")
    }

    removed_ips = 0

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT ip
            FROM ip_records
            WHERE banned = 1
        """).fetchall()

    for row in rows:
        ip = str(row["ip"]).strip()

        if ip in ip_set:
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