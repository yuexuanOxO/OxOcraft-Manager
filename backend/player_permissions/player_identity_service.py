import json
import uuid

from backend.paths import MC_ROOT
from backend.db import (
    upsert_player_from_usercache,
    get_all_players,
    delete_player_by_uuid,
)


USERCACHE_FILE = MC_ROOT / "usercache.json"


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


def get_uuid_type(player_uuid: str) -> str:
    try:
        version = uuid.UUID(player_uuid).version

        if version == 4:
            return "online"

        if version == 3:
            return "offline"

        return f"v{version}"

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
            uuid_type=get_uuid_type(player_uuid),
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

        uuid_type = get_uuid_type(player_uuid)

        upsert_player_from_usercache(
            player_uuid=player_uuid,
            player_name=player_name,
            uuid_type=uuid_type,
            usercache_expires_on=expires_on,
        )

        result.append({
            "player_uuid": player_uuid,
            "player_name": player_name,
            "uuid_type": uuid_type,
            "usercache_expires_on": expires_on,
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
        uuid_type=get_uuid_type(player_uuid),
        usercache_expires_on=expires_on,
    )