import socket

from backend.paths import SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import read_properties_file


def is_server_online(host: str = "127.0.0.1", port: int = 25565, timeout: int = 1) -> bool:
    """檢查 Minecraft server 是否在線。"""
    server_properties = read_properties_file(SERVER_PROPERTIES_PATH)

    if "server-port" in server_properties:
        port = int(server_properties["server-port"])

    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False