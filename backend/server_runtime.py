from __future__ import annotations

import subprocess
import threading
import json
import socket
from pathlib import Path
from backend.death_record.death_rules import parse_death_message, location_pattern
from backend.db import insert_player_death
from backend.server_monitor import append_log_line, clear_log_cache
from backend.paths import SERVER_JAR_PATH, CONFIG_PATH, MC_ROOT, SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import read_properties_file
from backend.server_effective_settings import save_effective_settings_snapshot

from backend.server_status import (
    lock_current_server_port,
    lock_current_server_host,
    lock_current_rcon_settings,
)

SERVER_ROOT = MC_ROOT

server_process: subprocess.Popen | None = None

# 暫存等待座標回來的死亡事件
pending_deaths: dict[str, dict] = {}

CURRENT_LEVEL_NAME: str | None = None
CURRENT_WORLD_PATH: Path | None = None

SERVER_RUNTIME_STATE = "offline"
_runtime_state_lock = threading.Lock()


def set_server_runtime_state(state: str) -> None:
    global SERVER_RUNTIME_STATE

    with _runtime_state_lock:
        SERVER_RUNTIME_STATE = state

    try:
        from backend.server_monitor import refresh_server_status_now
        refresh_server_status_now()
    except Exception:
        pass


def get_server_runtime_state() -> str:
    with _runtime_state_lock:
        return SERVER_RUNTIME_STATE


def is_server_running() -> bool:
    global server_process
    return server_process is not None and server_process.poll() is None


def send_command(cmd: str) -> None:
    global server_process

    if server_process and server_process.stdin:
        server_process.stdin.write(cmd + "\n")
        server_process.stdin.flush()


def handle_server_output() -> None:
    global server_process, pending_deaths

    if not server_process or not server_process.stdout:
        return

    for line in server_process.stdout:
        line = line.strip()
        print(line)
        append_log_line(line)

        if "Done (" in line and "For help, type" in line:
            print("[Runtime Debug] Detected server ready from log.")
            set_server_runtime_state("ready")

            try:
                from backend.player_ban.player_ban_service import (
                    sync_banned_json_to_db,
                    sync_removed_bans_from_json,
                )

                sync_banned_json_to_db()
                sync_removed_bans_from_json()

                from backend.server_monitor import publish_event
                publish_event("player_ban_should_refresh", {
                    "reason": "server_ready_sync_ban_json",
                })

                print("[PlayerBan] server ready sync completed")

            except Exception as error:
                print("[PlayerBan] server ready sync failed:", error)

        
        if "Query running on" in line:
            print("[Runtime Debug] Query listener ready from log.")
            try:
                from backend.server_monitor import refresh_server_status_now
                refresh_server_status_now()
            except Exception:
                pass


        death_result = parse_death_message(line)
        if death_result:
            player = death_result["player"]
            if player:
                pending_deaths[player] = death_result
                send_command(f"data get entity {player} LastDeathLocation")
            continue

        location_match = location_pattern.search(line)
        if location_match:
            player = location_match.group("player")

            if player not in pending_deaths:
                continue

            death_data = pending_deaths.pop(player)

            x = int(location_match.group("x"))
            y = int(location_match.group("y"))
            z = int(location_match.group("z"))
            dimension = location_match.group("dimension")

            insert_player_death(
                player_name=player,
                death_type=death_data["type"],
                death_text=death_data["death_text"],
                killer=death_data["killer"],
                item=death_data["item"],
                x=x,
                y=y,
                z=z,
                dimension=dimension,
                raw_log=death_data["message"],
            )

    set_server_runtime_state("offline")


def get_local_ipv4_addresses() -> set[str]:
    ips = {
        "127.0.0.1",
        "0.0.0.0",
        "localhost",
    }

    try:
        hostname = socket.gethostname()

        for item in socket.getaddrinfo(hostname, None):
            ip = item[4][0]

            if ":" not in ip:
                ips.add(ip)

    except Exception:
        pass

    return ips


def validate_server_bind_ip(server_ip: str) -> tuple[bool, str]:

    try:
        server_ip = server_ip.strip()
        if not server_ip:
            return True, ""

        if not server_ip:
            return True, ""

        local_ips = get_local_ipv4_addresses()

        if server_ip in local_ips:
            return True, ""

        available_ips = "\n".join(sorted(local_ips))

        return False, (
            "server-ip 綁定失敗!\n\n"
            "server-ip 只能填這台電腦目前擁有的 IP。\n"
            "如果不確定，建議將 server-ip 留空。\n\n"
            f"目前設定的 server-ip：\n{server_ip}\n\n"
            f"目前可用 IP：\n{available_ips}"
        )

    except Exception as error:
        return False, f"檢查 server-ip 時發生錯誤：{error}"


def start_server() -> tuple[bool, str]:
    global server_process

    if is_server_running():
        return False, "伺服器已經在執行中"

    if not SERVER_JAR_PATH.exists():
        return False, f"找不到 server.jar：{SERVER_JAR_PATH}"
    
    props = {}

    if SERVER_PROPERTIES_PATH.exists():
        props = read_properties_file(SERVER_PROPERTIES_PATH)

    server_ip = props.get("server-ip", "")

    bind_ip_ok, bind_ip_message = (
        validate_server_bind_ip(server_ip)
    )

    if not bind_ip_ok:
        return False, bind_ip_message

    set_server_runtime_state("starting")
    
    lock_current_server_port()
    lock_current_server_host()
    lock_current_rcon_settings()
    lock_current_world_path()


    command = [
        "java",
        "-jar",
        "server.jar",
        "nogui",
    ]

    try:
        clear_log_cache()
        server_process = subprocess.Popen(
            command,
            cwd=SERVER_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )

        print("[Runtime Debug] server process started:", server_process.pid)

        if SERVER_PROPERTIES_PATH.exists():
            save_effective_settings_snapshot()

        threading.Thread(target=handle_server_output, daemon=True).start()
        return True, "伺服器啟動成功"
    except Exception as error:
        set_server_runtime_state("offline")
        return False, f"伺服器啟動失敗：{error}"


def stop_server() -> tuple[bool, str]:
    global server_process

    if not is_server_running():
        return False, "伺服器未運行"

    try:
        set_server_runtime_state("stopping")
        send_command("stop")
        return True, "正在關閉伺服器"
    except Exception as error:
        return False, str(error)
    
def load_runtime_config() -> dict:
    if not CONFIG_PATH.exists():
        return {
            "java_xms": "1G",
            "java_xmx": "4G",
        }

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)
    

def lock_current_world_path() -> Path:
    global CURRENT_LEVEL_NAME, CURRENT_WORLD_PATH

    level_name = "world"

    try:
        if SERVER_PROPERTIES_PATH.exists():
            props = read_properties_file(SERVER_PROPERTIES_PATH)
            level_name = props.get("level-name", "world") or "world"
    except Exception:
        level_name = "world"

    CURRENT_LEVEL_NAME = level_name
    CURRENT_WORLD_PATH = MC_ROOT / level_name

    return CURRENT_WORLD_PATH


def get_current_world_path() -> Path:
    if CURRENT_WORLD_PATH is not None:
        return CURRENT_WORLD_PATH

    return lock_current_world_path()


def get_current_level_name() -> str:
    if CURRENT_LEVEL_NAME is not None:
        return CURRENT_LEVEL_NAME

    lock_current_world_path()
    return CURRENT_LEVEL_NAME or "world"