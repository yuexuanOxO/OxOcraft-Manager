import socket
from pathlib import Path
from backend.paths import SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import read_properties_file
from mcstatus import JavaServer



DEFAULT_SERVER_PORT = 25565
CURRENT_SERVER_PORT = None
CURRENT_SERVER_HOST = None
CURRENT_RCON_PORT = None


def load_server_port_from_properties() -> int:
    if not SERVER_PROPERTIES_PATH.exists():
        return DEFAULT_SERVER_PORT

    try:
        server_properties = read_properties_file(SERVER_PROPERTIES_PATH)
        return int(server_properties.get("server-port", DEFAULT_SERVER_PORT))
    except Exception:
        return DEFAULT_SERVER_PORT


def load_server_host_from_properties() -> str:
    if not SERVER_PROPERTIES_PATH.exists():
        return "127.0.0.1"

    try:
        server_properties = read_properties_file(
            SERVER_PROPERTIES_PATH
        )

        server_ip = (
            server_properties
            .get("server-ip", "")
            .strip()
        )

        if server_ip:
            return server_ip

        return "127.0.0.1"

    except Exception:
        return "127.0.0.1"


def lock_current_server_host() -> str:
    global CURRENT_SERVER_HOST

    CURRENT_SERVER_HOST = (
        load_server_host_from_properties()
    )

    return CURRENT_SERVER_HOST


def get_current_server_host() -> str:
    if CURRENT_SERVER_HOST is not None:
        return CURRENT_SERVER_HOST

    return load_server_host_from_properties()


def lock_current_server_port() -> int:
    global CURRENT_SERVER_PORT

    CURRENT_SERVER_PORT = load_server_port_from_properties()
    return CURRENT_SERVER_PORT


def get_current_server_port() -> int:
    if CURRENT_SERVER_PORT is not None:
        return CURRENT_SERVER_PORT

    return load_server_port_from_properties()


def is_server_online(host: str | None = None,timeout: int = 1) -> bool:
    port = get_current_server_port()
    if host is None:
        host = get_current_server_host()

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


def build_query_player_list(player_names: list[str]) -> list[dict]:
    try:
        from backend.player_permissions.player_permission_service import (
            get_effective_online_mode
        )

        online_mode = get_effective_online_mode()

    except Exception:
        online_mode = True

    players = []

    for player_name in player_names or []:
        if online_mode:
            avatar_url = (
                "https://mc-heads.net/avatar/"
                f"{player_name}"
            )
        else:
            avatar_url = get_offline_default_skin_avatar_url(
                player_name
            )

        players.append({
            "name": player_name,
            "avatar_url": avatar_url,
        })

    return players


def get_offline_default_skin_avatar_url(player_name: str) -> str:
    from backend.routes.player_routes import get_offline_player_uuid

    player_uuid = get_offline_player_uuid(player_name)

    skin = get_offline_default_skin_name(player_uuid)

    return f"/static/img/player/default_skins/{skin}.png"


def get_offline_default_skin_name(player_uuid: str) -> str:
    default_skins = [
        "alex",
        "ari",
        "efe",
        "kai",
        "makena",
        "noor",
        "steve",
        "sunny",
        "zuri",
    ]

    clean_uuid = str(player_uuid or "").replace("-", "").lower()

    if len(clean_uuid) != 32:
        return "steve"

    most = int(clean_uuid[:16], 16)
    least = int(clean_uuid[16:], 16)

    hilo = most ^ least
    hash_code = ((hilo >> 32) ^ hilo) & 0xffffffff

    if hash_code >= 0x80000000:
        hash_code -= 0x100000000

    index = hash_code % 9

    return default_skins[index]


def get_server_query_status(host: str | None = None) -> dict:
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

    if runtime_state == "stopping":
        try:
            from backend.server_runtime import is_server_running, set_server_runtime_state

            if not is_server_running() and not is_server_online(host=host):
                set_server_runtime_state("offline")
                return {
                    "online": False,
                    "state": "offline",
                    "message": "伺服器離線",
                }
        except Exception:
            pass

    port = get_query_port()

    if host is None:
        host = get_current_server_host()

    try:
        server = JavaServer.lookup(f"{host}:{port}")
        query = server.query()

        return {
            "online": True,
            "state": "ready",
            "query_ready": True,
            "message": "伺服器在線",
            "motd": query.motd.raw,
            "map_name": query.map_name,
            "players_online": query.players.online,
            "players_max": query.players.max,
            "players": build_query_player_list(query.players.list),
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
            if runtime_state == "ready":
                return {
                    "online": True,
                    "state": "ready",
                    "query_ready": False,
                    "message": "伺服器在線，但 Query 尚未回應",
                    "players_online": 0,
                    "players_max": 0,
                    "players": [],
                    "error": str(error),
                }

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
    

def load_rcon_host_from_properties() -> str:
    if not SERVER_PROPERTIES_PATH.exists():
        return "127.0.0.1"

    try:
        server_properties = read_properties_file(
            SERVER_PROPERTIES_PATH
        )

        server_ip = (
            server_properties
            .get("server-ip", "")
            .strip()
        )

        if server_ip:
            return server_ip

        return "127.0.0.1"

    except Exception:
        return "127.0.0.1"
    
def load_rcon_port_from_properties() -> int:
    if not SERVER_PROPERTIES_PATH.exists():
        return 25575

    try:
        server_properties = read_properties_file(
            SERVER_PROPERTIES_PATH
        )

        return int(
            server_properties.get("rcon.port", 25575)
        )

    except Exception:
        return 25575
    
def lock_current_rcon_settings() -> tuple[str, int]:
    global CURRENT_RCON_HOST
    global CURRENT_RCON_PORT

    CURRENT_RCON_HOST = (
        load_rcon_host_from_properties()
    )

    CURRENT_RCON_PORT = (
        load_rcon_port_from_properties()
    )

    return (
        CURRENT_RCON_HOST,
        CURRENT_RCON_PORT,
    )

def get_current_rcon_host() -> str:
    if CURRENT_RCON_HOST is not None:
        return CURRENT_RCON_HOST

    return load_rcon_host_from_properties()


def get_current_rcon_port() -> int:
    if CURRENT_RCON_PORT is not None:
        return CURRENT_RCON_PORT

    return load_rcon_port_from_properties()