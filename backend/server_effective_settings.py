import json
from datetime import datetime
from backend.paths import DATA_DIR, SERVER_PROPERTIES_PATH
from backend.config_files import load_or_create_config
from backend.server_settings.server_properties import (
    get_effective_server_properties,
    read_properties_modified_comment,
)

EFFECTIVE_SETTINGS_PATH = DATA_DIR / "server_effective_settings.json"


def build_effective_settings_snapshot() -> dict:
    config = load_or_create_config()

    return {
        "captured_at": datetime.now().isoformat(timespec="seconds"),
        "properties_modified_comment": read_properties_modified_comment(SERVER_PROPERTIES_PATH),
        "properties": get_effective_server_properties(SERVER_PROPERTIES_PATH),
        "runtime_config": {
            "java_xms": config.get("java_xms", "1G"),
            "java_xmx": config.get("java_xmx", "4G"),
        },
    }


def save_effective_settings_snapshot() -> dict:
    EFFECTIVE_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)

    snapshot = build_effective_settings_snapshot()

    with EFFECTIVE_SETTINGS_PATH.open("w", encoding="utf-8") as file:
        json.dump(snapshot, file, ensure_ascii=False, indent=4)

    return snapshot


def load_effective_settings_snapshot() -> dict:
    if not EFFECTIVE_SETTINGS_PATH.exists():
        return build_effective_settings_snapshot()

    with EFFECTIVE_SETTINGS_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)