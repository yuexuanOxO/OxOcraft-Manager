import ipaddress
import json
from datetime import datetime, timedelta
from pathlib import Path

from backend.paths import MC_ROOT
from backend.db import get_connection
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

BANNED_PLAYERS_FILE = MC_ROOT / "banned-players.json"
BANNED_IPS_FILE = MC_ROOT / "banned-ips.json"


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


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


def add_ban_history(
    action: str,
    target_type: str,
    target_name: str,
    target_uuid: str | None = None,
    reason: str = "",
    operator: str = "OxOcraft",
    ban_record_id: int | None = None,
    detail: str = "",
) -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO ban_history (
                action,
                target_type,
                target_name,
                target_uuid,
                reason,
                operator,
                created_at,
                ban_record_id,
                detail
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            action,
            target_type,
            target_name,
            target_uuid,
            reason,
            operator,
            now_text(),
            ban_record_id,
            detail,
        ))

        conn.commit()


def get_active_bans(target_type: str) -> list[dict]:
    current_account_type = get_current_account_type()

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ban_records
            WHERE active = 1
              AND target_type = ?
            ORDER BY created_at DESC, id DESC
        """, (target_type,)).fetchall()

    records = [dict(row) for row in rows]

    deduped = {}

    for record in records:
        if target_type == "player":
            key = (
                str(record.get("target_uuid") or "").lower()
                or str(record.get("target_name") or "").lower()
            )
        else:
            key = str(record.get("target_name") or "").strip()

        if not key:
            continue

        old = deduped.get(key)

        if old is None:
            deduped[key] = record
            continue

        old_operator = str(old.get("operator") or "")
        new_operator = str(record.get("operator") or "")

        if old_operator != "OxOcraft" and new_operator == "OxOcraft":
            deduped[key] = record

    result = list(deduped.values())

    if target_type == "player":
        for record in result:
            record["valid_for_current_mode"] = (
                record.get("account_type") == current_account_type
            )

    return result


def get_ban_history(limit: int = 100) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ban_history
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        """, (limit,)).fetchall()

    return [dict(row) for row in rows]


def player_exists_in_banned_json(
    player_uuid: str,
    player_name: str,
) -> bool:
    data = read_json_list(BANNED_PLAYERS_FILE)

    for item in data:
        if str(item.get("uuid", "")).lower() == player_uuid.lower():
            return True

        if str(item.get("name", "")).lower() == player_name.lower():
            return True

    return False


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


def insert_ban_record(
    target_type: str,
    target_name: str,
    target_uuid: str | None,
    account_type: str | None,
    reason: str,
    operator: str,
    expires_at: str | None,
    permanent: bool,
    source: str = "OxOcraft",
) -> int:
    created_at = now_text()

    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO ban_records (
                target_type,
                target_name,
                target_uuid,
                account_type,
                reason,
                operator,
                created_at,
                expires_at,
                permanent,
                active,
                source
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """, (
            target_type,
            target_name,
            target_uuid,
            account_type,
            reason,
            operator,
            created_at,
            expires_at,
            1 if permanent else 0,
            source,
        ))

        conn.commit()
        return int(cursor.lastrowid)


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
        account_type = str(candidate_account_type or detect_account_type(player_uuid)).strip()
    else:
        player_uuid = resolve_player_uuid(player_name)

        if not player_uuid:
            return {
                "success": False,
                "message": f"無法取得玩家 {player_name} 的 UUID",
            }

        account_type = detect_account_type(player_uuid)

    if is_server_running():
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

    existing_record = find_active_ban_record(
        target_type="player",
        target_name=player_name,
        target_uuid=player_uuid,
    )

    if existing_record:
        ban_record_id = int(existing_record["id"])

        update_ban_record_as_oxocraft(
            record_id=ban_record_id,
            reason=reason,
            operator=operator,
            expires_at=expires_at,
            permanent=permanent,
            account_type=account_type,
        )
    else:
        ban_record_id = insert_ban_record(
            target_type="player",
            target_name=player_name,
            target_uuid=player_uuid,
            account_type=account_type,
            reason=reason,
            operator=operator,
            expires_at=expires_at,
            permanent=permanent,
        )

    add_ban_history(
        action="ban_player",
        target_type="player",
        target_name=player_name,
        target_uuid=player_uuid,
        reason=reason,
        operator=operator,
        ban_record_id=ban_record_id,
        detail=result,
    )

    return {
        "success": True,
        "message": f"已封鎖玩家 {player_name}",
        "result": result,
    }


def find_active_ban_record(
    target_type: str,
    target_name: str,
    target_uuid: str | None = None,
) -> dict | None:
    with get_connection() as conn:
        if target_type == "player":
            row = conn.execute("""
                SELECT *
                FROM ban_records
                WHERE active = 1
                  AND target_type = 'player'
                  AND (
                      lower(target_uuid) = lower(?)
                      OR lower(target_name) = lower(?)
                  )
                ORDER BY id DESC
                LIMIT 1
            """, (
                target_uuid or "",
                target_name or "",
            )).fetchone()
        else:
            row = conn.execute("""
                SELECT *
                FROM ban_records
                WHERE active = 1
                  AND target_type = 'ip'
                  AND target_name = ?
                ORDER BY id DESC
                LIMIT 1
            """, (
                target_name or "",
            )).fetchone()

    return dict(row) if row else None


def update_ban_record_as_oxocraft(
    record_id: int,
    reason: str,
    operator: str,
    expires_at: str | None,
    permanent: bool,
    account_type: str | None = None,
) -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE ban_records
            SET reason = ?,
                operator = ?,
                expires_at = ?,
                permanent = ?,
                source = 'OxOcraft',
                account_type = COALESCE(?, account_type)
            WHERE id = ?
        """, (
            reason,
            operator,
            expires_at,
            1 if permanent else 0,
            account_type,
            record_id,
        ))

        conn.commit()


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


def deactivate_ban_record(record_id: int) -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE ban_records
            SET active = 0
            WHERE id = ?
        """, (record_id,))

        conn.commit()


def get_ban_record(record_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("""
            SELECT *
            FROM ban_records
            WHERE id = ?
        """, (record_id,)).fetchone()

    return dict(row) if row else None


def unban_player(
    record_id: int,
    operator: str = "OxOcraft",
) -> dict:
    record = get_ban_record(record_id)

    if not record:
        return {
            "success": False,
            "message": "找不到封鎖紀錄",
        }

    if record.get("target_type") != "player":
        return {
            "success": False,
            "message": "此紀錄不是玩家封鎖",
        }

    if not record.get("active"):
        return {
            "success": False,
            "message": "此封鎖紀錄已解除",
        }

    player_name = record.get("target_name") or ""
    player_uuid = record.get("target_uuid")

    if is_server_running():
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

    deactivate_ban_record(record_id)

    add_ban_history(
        action="manual_unban_player",
        target_type="player",
        target_name=player_name,
        target_uuid=player_uuid,
        reason="手動解除封鎖",
        operator=operator,
        ban_record_id=record_id,
        detail=result,
    )

    return {
        "success": True,
        "message": f"已解除玩家 {player_name} 的封鎖",
        "result": result,
    }


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
    operator = str(operator or "OxOcraft").strip()

    valid, message = validate_ip(ip)

    if not valid:
        return {
            "success": False,
            "message": message,
        }

    if is_server_running():
        command = f"ban-ip {ip} {reason}".strip()
        result = send_rcon_command(command)
    else:
        write_ip_to_banned_json(
            ip=ip,
            reason=reason,
            operator=operator,
        )
        result = "已寫入 banned-ips.json"

    existing_record = find_active_ban_record(
        target_type="ip",
        target_name=ip,
    )

    if existing_record:
        ban_record_id = int(existing_record["id"])

        update_ban_record_as_oxocraft(
            record_id=ban_record_id,
            reason=reason,
            operator=operator,
            expires_at=expires_at,
            permanent=permanent,
            account_type=None,
        )
    else:
        ban_record_id = insert_ban_record(
            target_type="ip",
            target_name=ip,
            target_uuid=None,
            account_type=None,
            reason=reason,
            operator=operator,
            expires_at=expires_at,
            permanent=permanent,
        )

    add_ban_history(
        action="ban_ip",
        target_type="ip",
        target_name=ip,
        target_uuid=None,
        reason=reason,
        operator=operator,
        ban_record_id=ban_record_id,
        detail=result,
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
    record_id: int,
    operator: str = "OxOcraft",
) -> dict:
    record = get_ban_record(record_id)

    if not record:
        return {
            "success": False,
            "message": "找不到封鎖紀錄",
        }

    if record.get("target_type") != "ip":
        return {
            "success": False,
            "message": "此紀錄不是 IP 封鎖",
        }

    if not record.get("active"):
        return {
            "success": False,
            "message": "此封鎖紀錄已解除",
        }

    ip = record.get("target_name") or ""

    if is_server_running():
        result = send_rcon_command(f"pardon-ip {ip}")
    else:
        removed = remove_ip_from_banned_json(ip)

        result = (
            "已從 banned-ips.json 移除"
            if removed
            else "banned-ips.json 中已不存在此 IP"
        )

    deactivate_ban_record(record_id)

    add_ban_history(
        action="manual_unban_ip",
        target_type="ip",
        target_name=ip,
        target_uuid=None,
        reason="手動解除 IP 封鎖",
        operator=operator,
        ban_record_id=record_id,
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


def player_ban_exists_in_json(record: dict) -> bool:
    if record.get("target_type") != "player":
        return False

    return player_exists_in_banned_json(
        player_uuid=record.get("target_uuid") or "",
        player_name=record.get("target_name") or "",
    )


def ip_ban_exists_in_json(record: dict) -> bool:
    if record.get("target_type") != "ip":
        return False

    return ip_exists_in_banned_json(
        record.get("target_name") or ""
    )


def get_expired_active_bans() -> list[dict]:
    now = now_text()

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ban_records
            WHERE active = 1
              AND permanent = 0
              AND expires_at IS NOT NULL
              AND expires_at <= ?
            ORDER BY expires_at ASC, id ASC
        """, (now,)).fetchall()

    return [dict(row) for row in rows]


def process_expired_ban(record: dict) -> dict:
    record_id = int(record["id"])
    target_type = record.get("target_type")
    target_name = record.get("target_name") or ""
    target_uuid = record.get("target_uuid")

    if target_type == "player":
        exists = player_ban_exists_in_json(record)

        if not exists:
            deactivate_ban_record(record_id)

            add_ban_history(
                action="already_removed_player",
                target_type="player",
                target_name=target_name,
                target_uuid=target_uuid,
                reason="封鎖期限到期，但玩家已不在黑名單中",
                operator="OxOcraft",
                ban_record_id=record_id,
                detail="略過 /pardon",
            )

            return {
                "success": True,
                "action": "already_removed_player",
                "target": target_name,
            }

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

        deactivate_ban_record(record_id)

        add_ban_history(
            action="expired_unban_player",
            target_type="player",
            target_name=target_name,
            target_uuid=target_uuid,
            reason="封鎖期限到期",
            operator="OxOcraft",
            ban_record_id=record_id,
            detail=result,
        )

        return {
            "success": True,
            "action": "expired_unban_player",
            "target": target_name,
            "result": result,
        }

    if target_type == "ip":
        exists = ip_ban_exists_in_json(record)

        if not exists:
            deactivate_ban_record(record_id)

            add_ban_history(
                action="already_removed_ip",
                target_type="ip",
                target_name=target_name,
                target_uuid=None,
                reason="封鎖期限到期，但 IP 已不在黑名單中",
                operator="OxOcraft",
                ban_record_id=record_id,
                detail="略過 /pardon-ip",
            )

            return {
                "success": True,
                "action": "already_removed_ip",
                "target": target_name,
            }

        if is_server_running():
            result = send_rcon_command(f"pardon-ip {target_name}")
        else:
            removed = remove_ip_from_banned_json(target_name)

            result = (
                "已從 banned-ips.json 移除"
                if removed
                else "banned-ips.json 中已不存在此 IP"
            )

        deactivate_ban_record(record_id)

        add_ban_history(
            action="expired_unban_ip",
            target_type="ip",
            target_name=target_name,
            target_uuid=None,
            reason="封鎖期限到期",
            operator="OxOcraft",
            ban_record_id=record_id,
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
        "record_id": record_id,
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


def sync_banned_json_to_db() -> dict:
    synced_players = 0
    synced_ips = 0

    players = read_json_list(BANNED_PLAYERS_FILE)
    ips = read_json_list(BANNED_IPS_FILE)

    with get_connection() as conn:
        for item in players:
            player_name = str(item.get("name", "")).strip()
            player_uuid = str(item.get("uuid", "")).strip()
            account_type = detect_account_type(player_uuid)

            if not player_name or not player_uuid:
                continue

            exists = conn.execute("""
                SELECT id
                FROM ban_records
                WHERE active = 1
                  AND target_type = 'player'
                  AND (
                      lower(target_uuid) = lower(?)
                      OR lower(target_name) = lower(?)
                  )
                LIMIT 1
            """, (
                player_uuid,
                player_name,
            )).fetchone()

            if exists:
                conn.execute("""
                    UPDATE ban_records
                    SET account_type = ?
                    WHERE id = ?
                """, (
                    account_type,
                    exists["id"],
                ))
                continue

            created_at = now_text()

            cursor = conn.execute("""
                INSERT INTO ban_records (
                    target_type,
                    target_name,
                    target_uuid,
                    account_type,
                    reason,
                    operator,
                    created_at,
                    expires_at,
                    permanent,
                    active,
                    source,
                    note
                )
                VALUES (
                    'player',
                    ?, ?, ?,
                    ?, ?, ?, NULL, 1, 1, 'Minecraft',
                    '從 banned-players.json 同步'
                )
            """, (
                    player_name,
                    player_uuid,
                    account_type,
                    item.get("reason", ""),
                    item.get("source", "Minecraft"),
                    created_at,
                ))

            conn.execute("""
                INSERT INTO ban_history (
                    action,
                    target_type,
                    target_name,
                    target_uuid,
                    reason,
                    operator,
                    created_at,
                    ban_record_id,
                    detail
                )
                VALUES (
                    'sync_ban_player',
                    'player',
                    ?, ?, ?, ?, ?, ?,
                    '從 banned-players.json 同步'
                )
            """, (
                player_name,
                player_uuid,
                item.get("reason", ""),
                item.get("source", "Minecraft"),
                created_at,
                cursor.lastrowid,
            ))

            synced_players += 1

        for item in ips:
            ip = str(item.get("ip", "")).strip()

            if not ip:
                continue

            exists = conn.execute("""
                SELECT id
                FROM ban_records
                WHERE active = 1
                  AND target_type = 'ip'
                  AND target_name = ?
                LIMIT 1
            """, (ip,)).fetchone()

            if exists:
                continue

            created_at = now_text()

            cursor = conn.execute("""
                INSERT INTO ban_records (
                    target_type,
                    target_name,
                    target_uuid,
                    account_type,
                    reason,
                    operator,
                    created_at,
                    expires_at,
                    permanent,
                    active,
                    source,
                    note
                )
                VALUES (
                    'ip',
                    ?, NULL, NULL,
                    ?, ?, ?, NULL, 1, 1, 'Minecraft',
                    '從 banned-ips.json 同步'
                )
            """, (
                ip,
                item.get("reason", ""),
                item.get("source", "Minecraft"),
                created_at,
            ))

            conn.execute("""
                INSERT INTO ban_history (
                    action,
                    target_type,
                    target_name,
                    target_uuid,
                    reason,
                    operator,
                    created_at,
                    ban_record_id,
                    detail
                )
                VALUES (
                    'sync_ban_ip',
                    'ip',
                    ?, NULL, ?, ?, ?, ?,
                    '從 banned-ips.json 同步'
                )
            """, (
                ip,
                item.get("reason", ""),
                item.get("source", "Minecraft"),
                created_at,
                cursor.lastrowid,
            ))

            synced_ips += 1

        conn.commit()

    return {
        "synced_players": synced_players,
        "synced_ips": synced_ips,
    }


def deactivate_all_active_bans_by_mode_change() -> dict:
    now = now_text()

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ban_records
            WHERE active = 1
        """).fetchall()

        records = [dict(row) for row in rows]

        for record in records:
            target_type = record.get("target_type")
            action = (
                "mode_changed_clear_player_ban"
                if target_type == "player"
                else "mode_changed_clear_ip_ban"
            )

            conn.execute("""
                INSERT INTO ban_history (
                    action,
                    target_type,
                    target_name,
                    target_uuid,
                    reason,
                    operator,
                    created_at,
                    ban_record_id,
                    detail
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                action,
                target_type,
                record.get("target_name", ""),
                record.get("target_uuid"),
                "切換正版驗證 / 離線模式，清除舊黑名單資料",
                "OxOcraft",
                now,
                record.get("id"),
                "online-mode changed",
            ))

        conn.execute("""
            UPDATE ban_records
            SET active = 0
            WHERE active = 1
        """)

        conn.commit()

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
    player_entries = read_json_list(BANNED_PLAYERS_FILE)
    ip_entries = read_json_list(BANNED_IPS_FILE)

    player_uuid_set = {
        str(item.get("uuid", "")).lower()
        for item in player_entries
        if item.get("uuid")
    }

    player_name_set = {
        str(item.get("name", "")).lower()
        for item in player_entries
        if item.get("name")
    }

    ip_set = {
        str(item.get("ip", "")).strip()
        for item in ip_entries
        if item.get("ip")
    }

    removed_players = 0
    removed_ips = 0
    now = now_text()

    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM ban_records
            WHERE active = 1
        """).fetchall()

        for row in rows:
            record = dict(row)
            target_type = record.get("target_type")
            target_name = str(record.get("target_name", ""))
            target_uuid = str(record.get("target_uuid", ""))

            missing = False

            if target_type == "player":
                missing = (
                    target_uuid.lower() not in player_uuid_set
                    and target_name.lower() not in player_name_set
                )

            elif target_type == "ip":
                missing = target_name not in ip_set

            if not missing:
                continue

            conn.execute("""
                UPDATE ban_records
                SET active = 0
                WHERE id = ?
            """, (record["id"],))

            action = (
                "external_unban_player"
                if target_type == "player"
                else "external_unban_ip"
            )

            conn.execute("""
                INSERT INTO ban_history (
                    action,
                    target_type,
                    target_name,
                    target_uuid,
                    reason,
                    operator,
                    created_at,
                    ban_record_id,
                    detail
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                action,
                target_type,
                target_name,
                target_uuid or None,
                "偵測到 Minecraft 黑名單已移除",
                "Minecraft",
                now,
                record["id"],
                "sync_removed_bans_from_json",
            ))

            if target_type == "player":
                removed_players += 1
            else:
                removed_ips += 1

        conn.commit()

    return {
        "removed_players": removed_players,
        "removed_ips": removed_ips,
    }