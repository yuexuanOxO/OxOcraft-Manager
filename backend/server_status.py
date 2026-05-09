import socket
from pathlib import Path
from backend.paths import SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import read_properties_file
from mcstatus import JavaServer


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
    

def get_query_port() -> int:
    return get_current_server_port()


def is_backup_state_active() -> bool:
    try:
        from backend.backup_service import (
            is_backup_running,
            get_backup_status,
        )

        from backend.server_runtime import get_current_world_path

        if not is_backup_running():
            return False

        status = get_backup_status()
        backup_source = status.get("source_path")

        if not backup_source:
            return False

        backup_path = Path(backup_source).resolve()
        current_path = Path(get_current_world_path()).resolve()

        return backup_path == current_path

    except Exception:
        return False


def get_server_query_status(host: str = "127.0.0.1") -> dict:
    if is_backup_state_active():
        return {
            "online": False,
            "state": "backuping",
            "message": "備份中",
        }

    runtime_state = "offline"

    try:
        from backend.server_runtime import get_server_runtime_state
        runtime_state = get_server_runtime_state()
    except Exception:
        pass

    if runtime_state == "starting":
        return {
            "online": False,
            "state": "starting",
            "message": "伺服器啟動中",
        }

    if runtime_state == "stopping":
        return {
            "online": False,
            "state": "stopping",
            "message": "伺服器關閉中",
        }

    port = get_query_port()

    try:
        server = JavaServer.lookup(f"{host}:{port}")
        query = server.query()

        return {
            "online": True,
            "state": "ready",
            "message": "伺服器在線",
            "motd": query.motd.raw,
            "map_name": query.map_name,
            "players_online": query.players.online,
            "players_max": query.players.max,
            "players": query.players.list,
            "version": query.software.version,
            "brand": query.software.brand,
            "port": query.port,
        }

    except Exception as error:
        if runtime_state in ("starting", "stopping"):
            return {
                "online": False,
                "state": runtime_state,
                "message": (
                    "伺服器啟動中"
                    if runtime_state == "starting"
                    else "伺服器關閉中"
                ),
                "error": str(error),
            }

        if is_server_online(host=host):
            return {
                "online": False,
                "state": "starting",
                "message": "伺服器啟動中或 Query 尚未就緒",
                "error": str(error),
            }

        return {
            "online": False,
            "state": "offline",
            "message": "伺服器離線",
            "error": str(error),
        }