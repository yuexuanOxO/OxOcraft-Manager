import json
import uuid

from backend.paths import MC_ROOT
from backend.db import (
    upsert_player_from_usercache,
    get_all_players,
)


USERCACHE_FILE = MC_ROOT / "usercache.json"


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

    with USERCACHE_FILE.open("r", encoding="utf-8") as file:
        usercache_data = json.load(file)

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


def get_known_players() -> list[dict]:
    sync_usercache_to_db()
    return get_all_players()