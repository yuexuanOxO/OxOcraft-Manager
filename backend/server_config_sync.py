from typing import Dict

from backend.paths import SERVER_PROPERTIES_PATH
from backend.config_files import load_or_create_config
from backend.server_settings.server_properties import (
    read_properties_file,
    format_properties_for_write,
    write_properties_file,
)


def sync_rcon_to_server_properties(config: Dict) -> None:
    updates = {
        "enable-rcon": "true",
        "rcon.port": str(config["rcon_port"]),
        "rcon.password": str(config["rcon_password"]),
    }

    server_properties = read_properties_file(SERVER_PROPERTIES_PATH)
    server_properties.update(updates)

    lines = format_properties_for_write(server_properties)
    write_properties_file(SERVER_PROPERTIES_PATH, lines)


def init_rcon_config() -> Dict:
    """
    啟動 Flask 時：
    1. 建立或載入 config.json
    2. 同步 RCON 到 server.properties
    """
    config = load_or_create_config()
    sync_rcon_to_server_properties(config)
    return config