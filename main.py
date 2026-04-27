from __future__ import annotations

import subprocess
import threading
import json
from pathlib import Path

from backend.death_record.death_rules import parse_death_message, location_pattern
from backend.db import insert_player_death

BASE_DIR = Path(__file__).resolve().parent
SERVER_ROOT = BASE_DIR.parent
SERVER_JAR_PATH = SERVER_ROOT / "server.jar"
CONFIG_PATH = BASE_DIR / "static" / "data" / "config.json"

server_process: subprocess.Popen | None = None

# 暫存等待座標回來的死亡事件
pending_deaths: dict[str, dict] = {}


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


def start_server() -> tuple[bool, str]:
    global server_process

    if is_server_running():
        return False, "伺服器已經在執行中"

    if not SERVER_JAR_PATH.exists():
        return False, f"找不到 server.jar：{SERVER_JAR_PATH}"

    command = [
        "java",
        "-jar",
        str(SERVER_JAR_PATH),
        "nogui",
    ]

    try:
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

        threading.Thread(target=handle_server_output, daemon=True).start()
        return True, "伺服器啟動成功"
    except Exception as error:
        return False, f"伺服器啟動失敗：{error}"


def stop_server() -> tuple[bool, str]:
    global server_process

    if not is_server_running():
        return False, "伺服器未運行"

    try:
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