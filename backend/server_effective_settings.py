import json
from datetime import datetime
from backend.config_files import load_or_create_config
from backend.server_settings.server_properties import (
    get_effective_server_properties,
    read_properties_modified_comment,
)

from backend.paths import (
    EFFECTIVE_SETTINGS_PATH,
    SERVER_PROPERTIES_PATH,
)


def build_effective_settings_snapshot() -> dict:
    config = load_or_create_config()

    properties = get_effective_server_properties(SERVER_PROPERTIES_PATH)
    
    properties["enable-rcon"] = "true"
    properties["rcon.port"] = str(config.get("rcon_port", 25575))
    properties["rcon.password"] = str(config.get("rcon_password", ""))

    return {
        "captured_at": datetime.now().isoformat(timespec="seconds"),
        "properties_modified_comment": read_properties_modified_comment(SERVER_PROPERTIES_PATH),

        "properties": properties,

        "runtime_config": {
            "java_xms": config.get("java_xms", "1G"),
            "java_xmx": config.get("java_xmx", "4G"),
        },
    }


def save_effective_settings_snapshot() -> dict:
    EFFECTIVE_SETTINGS_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    old_snapshot = load_effective_settings_snapshot()

    old_online_mode = (
        get_effective_online_mode_from_snapshot(
            old_snapshot
        )
    )

    snapshot = build_effective_settings_snapshot()

    new_online_mode = (
        get_effective_online_mode_from_snapshot(
            snapshot
        )
    )

    if old_online_mode != new_online_mode:
        clear_access_control_files()

    with EFFECTIVE_SETTINGS_PATH.open(
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            snapshot,
            file,
            ensure_ascii=False,
            indent=4
        )

    return snapshot


def load_effective_settings_snapshot() -> dict:
    if not EFFECTIVE_SETTINGS_PATH.exists():
        return build_effective_settings_snapshot()

    with EFFECTIVE_SETTINGS_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)
    

def get_effective_online_mode_from_snapshot(
    snapshot: dict
) -> bool:

    properties = snapshot.get("properties", {})

    return str(
        properties.get("online-mode", "true")
    ).lower() == "true"


from backend.paths import MC_ROOT

OPS_FILE = MC_ROOT / "ops.json"
WHITELIST_FILE = MC_ROOT / "whitelist.json"
USERCACHE_FILE = MC_ROOT / "usercache.json"
BANNED_PLAYERS_FILE = MC_ROOT / "banned-players.json"
BANNED_IPS_FILE = MC_ROOT / "banned-ips.json"


def clear_access_control_files() -> None:
    for path in [
        OPS_FILE,
        WHITELIST_FILE,
        USERCACHE_FILE,
        BANNED_PLAYERS_FILE,
        BANNED_IPS_FILE,
    ]:

        if not path.exists():
            continue

        with path.open("w", encoding="utf-8") as file:
            json.dump([], file, ensure_ascii=False, indent=2)

    try:
        from backend.player_ban.player_ban_service import (
            deactivate_all_active_bans_by_mode_change
        )

        deactivate_all_active_bans_by_mode_change()

    except Exception:
        pass