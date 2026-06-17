import json
import uuid
import re

from backend.paths import MC_ROOT
from backend.db import (
    get_connection,
    upsert_player_from_usercache,
    upsert_player_login,
    upsert_ip_player_login,
    mark_player_offline_by_name,
    get_all_players,
    delete_player_by_uuid,
    get_player_by_name,
    upsert_player_identity,
    hide_player_candidate,
)


USERCACHE_FILE = MC_ROOT / "usercache.json"

MINECRAFT_PLAYER_NAME_PATTERN = re.compile(
    r"^[A-Za-z0-9_]{3,16}$"
)


def load_usercache_data() -> list[dict]:
    if not USERCACHE_FILE.exists():
        return []

    try:
        with USERCACHE_FILE.open("r", encoding="utf-8") as file:
            content = file.read().strip()

        if not content:
            return []

        data = json.loads(content)

        if not isinstance(data, list):
            return []

        return data

    except json.JSONDecodeError:
        return []


def is_valid_minecraft_player_name(
    player_name: str,
) -> bool:
    player_name = str(player_name or "").strip()

    return bool(
        MINECRAFT_PLAYER_NAME_PATTERN.fullmatch(
            player_name
        )
    )


def get_account_type(player_uuid: str) -> str:
    try:
        version = uuid.UUID(player_uuid).version

        if version == 4:
            return "premium"

        if version == 3:
            return "offline"

        return "unknown"

    except Exception:
        return "unknown"


def sync_usercache_to_db() -> None:
    if not USERCACHE_FILE.exists():
        return

    usercache_data = load_usercache_data()

    for entry in usercache_data:
        player_uuid = str(entry.get("uuid", "")).strip()
        player_name = str(entry.get("name", "")).strip()
        expires_on = entry.get("expiresOn")

        if not player_uuid or not player_name:
            continue

        upsert_player_from_usercache(
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=get_account_type(player_uuid),
            usercache_expires_on=expires_on,
        )


def get_current_usercache_players() -> list[dict]:
    if not USERCACHE_FILE.exists():
        return []

    usercache_data = load_usercache_data()

    result = []

    for entry in usercache_data:
        player_uuid = str(entry.get("uuid", "")).strip()
        player_name = str(entry.get("name", "")).strip()
        expires_on = entry.get("expiresOn")

        if not player_uuid or not player_name:
            continue

        account_type = get_account_type(player_uuid)

        upsert_player_from_usercache(
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=account_type,
            usercache_expires_on=expires_on,
        )

        with get_connection() as conn:
            row = conn.execute("""
                SELECT *
                FROM players
                WHERE lower(player_uuid) = lower(?)
                LIMIT 1
            """, (
                player_uuid,
            )).fetchone()

        if row:
            result.append(dict(row))
        else:
            result.append({
                "player_uuid": player_uuid,
                "player_name": player_name,
                "account_type": account_type,
                "usercache_expires_on": expires_on,
                "show_in_player_candidates": 1,
            })

    return result


def get_known_players() -> list[dict]:
    sync_usercache_to_db()
    return get_all_players()


def remove_player_from_usercache(player_uuid: str) -> None:
    if USERCACHE_FILE.exists():
        with USERCACHE_FILE.open("r", encoding="utf-8") as file:
            usercache_data = json.load(file)

        usercache_data = [
            entry
            for entry in usercache_data
            if str(entry.get("uuid", "")).lower()
            != player_uuid.lower()
        ]

        with USERCACHE_FILE.open("w", encoding="utf-8") as file:
            json.dump(
                usercache_data,
                file,
                ensure_ascii=False,
            )

    delete_player_by_uuid(player_uuid)


def upsert_player_to_usercache(
    player_uuid: str,
    player_name: str,
    expires_on: str | None = None,
) -> None:
    if not expires_on:
        expires_on = "9999-12-31 23:59:59 +0800"

    usercache_data = []

    if USERCACHE_FILE.exists():
        with USERCACHE_FILE.open("r", encoding="utf-8") as file:
            usercache_data = json.load(file)

    usercache_data = [
        entry
        for entry in usercache_data
        if str(entry.get("uuid", "")).lower()
        != player_uuid.lower()
    ]

    usercache_data.insert(0, {
        "uuid": player_uuid,
        "name": player_name,
        "expiresOn": expires_on,
    })

    with USERCACHE_FILE.open("w", encoding="utf-8") as file:
        json.dump(
            usercache_data,
            file,
            ensure_ascii=False,
        )

    upsert_player_from_usercache(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=get_account_type(player_uuid),
        usercache_expires_on=expires_on,
    )


def record_player_login_from_log(
    player_name: str,
    player_uuid: str,
    ip: str | None = None,
    port: str | None = None,
) -> dict | None:
    player_name = str(player_name or "").strip()
    player_uuid = str(player_uuid or "").strip()

    if not player_name or not player_uuid:
        return None

    account_type = get_account_type(player_uuid)

    upsert_player_login(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        usercache_expires_on=None,
    )

    if ip:
        upsert_ip_player_login(
            ip=ip,
            player_uuid=player_uuid,
            player_name=player_name,
            account_type=account_type,
            port=port,
        )

    return {
        "player_name": player_name,
        "player_uuid": player_uuid,
        "account_type": account_type,
        "ip": ip,
        "port": port,
    }


def record_player_logout_from_log(
    player_name: str,
) -> None:
    mark_player_offline_by_name(player_name)


def resolve_player_identity(
    player_name: str,
) -> dict:
    player_name = str(player_name or "").strip()

    if not player_name:
        return {
            "player_uuid": None,
            "player_name": "",
            "account_type": None,
        }

    player = get_player_by_name(player_name)

    if player:
        return {
            "player_uuid": player.get("player_uuid"),
            "player_name": player.get("player_name") or player_name,
            "account_type": player.get("account_type"),
        }

    try:
        from backend.routes.player_routes import (
            is_online_mode,
            get_mojang_uuid,
            get_offline_player_uuid,
        )

        if is_online_mode():
            player_uuid = get_mojang_uuid(player_name)
            account_type = "premium"
        else:
            player_uuid = get_offline_player_uuid(player_name)
            account_type = "offline"

        if player_uuid:
            upsert_player_identity(
                player_uuid=player_uuid,
                player_name=player_name,
                account_type=account_type,
            )

            return {
                "player_uuid": player_uuid,
                "player_name": player_name,
                "account_type": account_type,
            }

    except Exception as error:
        print("[PlayerIdentity] resolve identity failed:", error)

    return {
        "player_uuid": None,
        "player_name": player_name,
        "account_type": None,
    }


def delete_player_candidate(
    player_uuid: str,
    player_name: str,
) -> dict:
    player_uuid = str(player_uuid or "").strip()
    player_name = str(player_name or "").strip()

    if not player_uuid or not player_name:
        return {
            "success": False,
            "message": "缺少玩家 UUID 或名稱",
        }

    hidden = hide_player_candidate(player_uuid)

    if not hidden:
        return {
            "success": False,
            "message": f"找不到玩家 {player_name} 的紀錄",
        }

    return {
        "success": True,
        "message": f"已從之前加入過的玩家清單移除 {player_name}",
    }