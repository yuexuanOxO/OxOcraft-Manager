from __future__ import annotations

import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SERVER_ROOT = BASE_DIR.parent
SERVER_JAR_PATH = SERVER_ROOT / "server.jar"

server_process: subprocess.Popen | None = None


def is_server_running() -> bool:
    global server_process
    return server_process is not None and server_process.poll() is None


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
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return True, "伺服器啟動成功"
    except Exception as error:
        return False, f"伺服器啟動失敗：{error}"
    

def stop_server() -> tuple[bool, str]:
    global server_process

    if not is_server_running():
        return False, "伺服器未運行"

    try:
        if server_process.stdin:
            server_process.stdin.write("stop\n")
            server_process.stdin.flush()
        return True, "正在關閉伺服器"
    except Exception as error:
        return False, str(error)