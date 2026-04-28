import socket

from backend.paths import SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import read_properties_file


DEFAULT_SERVER_PORT = 25565
CURRENT_SERVER_PORT = None


def load_server_port_from_properties() -> int:
    if not SERVER_PROPERTIES_PATH.exists():
        return DEFAULT_SERVER_PORT

    try:
        server_properties = read_properties_file(SERVER_PROPERTIES_PATH)
        return int(server_properties.get("server-port", DEFAULT_SERVER_PORT))
    except Exception:
        return DEFAULT_SERVER_PORT


def lock_current_server_port() -> int:
    global CURRENT_SERVER_PORT

    CURRENT_SERVER_PORT = load_server_port_from_properties()
    return CURRENT_SERVER_PORT


def get_current_server_port() -> int:
    if CURRENT_SERVER_PORT is not None:
        return CURRENT_SERVER_PORT

    return load_server_port_from_properties()


def is_server_online(host: str = "127.0.0.1", timeout: int = 1) -> bool:
    port = get_current_server_port()

    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False