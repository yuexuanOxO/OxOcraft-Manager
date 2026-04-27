import json
import socket
from pathlib import Path
from typing import Dict
from flask import Flask, render_template, jsonify, request
from mcrcon import MCRcon
from main import start_server,stop_server
import webbrowser
import threading
import re
from backend.db import init_db, get_recent_player_deaths
from backend.server_settings.server_properties import (
    DEFAULT_SERVER_PROPERTIES,
    read_properties_file,
    get_effective_server_properties,
    format_properties_for_write,
    write_properties_file,
    read_properties_modified_comment,
)


app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
SERVER_ROOT = BASE_DIR.parent

SERVER_PROPERTIES_PATH = SERVER_ROOT / "server.properties"
LOG_FILE = SERVER_ROOT / "logs" / "latest.log"
CONFIG_PATH = BASE_DIR / "static" / "data" / "config.json"
EULA_PATH = SERVER_ROOT / "eula.txt"

DEFAULT_CONFIG = {
    "rcon_host": "127.0.0.1",
    "rcon_port": 25575,
    "rcon_password": "OxO123456",
    "java_xms": "2G",
    "java_xmx": "4G",
}


def is_server_online(host: str = "127.0.0.1", port: int = 25565, timeout: int = 1) -> bool:
    #讀取server.properties設定值的port
    server_properties = read_properties_file(SERVER_PROPERTIES_PATH)
    server_port = "server-port"

    #根據server.properties的port動態修改,用正確的port檢查
    if server_port in server_properties:
        port = server_properties[server_port]
    #備註讓user在使用UI操作server不要再去手動修改server.properties以免發生錯誤,需手動修改請在OxOcraft-Manager關閉時操作

    """檢查 Minecraft server 是否在線。"""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def read_last_lines(file_path: Path, max_lines: int = 100) -> list[str]:
    """讀取文字檔最後幾行。"""
    if not file_path.exists():
        return [f"[OxO_MCServerManager] 找不到 log 檔案: {file_path}"]

    try:
        with file_path.open("r", encoding="utf-8", errors="replace") as file:
            lines = file.readlines()
        return lines[-max_lines:]
    except Exception as error:
        return [f"[OxO_MCServerManager] 讀取 log 失敗: {error}"]


def load_or_create_config() -> Dict:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    if not CONFIG_PATH.exists():
        save_config(DEFAULT_CONFIG.copy())
        return DEFAULT_CONFIG.copy()

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        config = json.load(file)

    changed = False
    for key, value in DEFAULT_CONFIG.items():
        if key not in config:
            config[key] = value
            changed = True

    if changed:
        save_config(config)

    return config


def save_config(config: Dict) -> None:
    """儲存 config.json。"""
    with CONFIG_PATH.open("w", encoding="utf-8") as file:
        json.dump(config, file, ensure_ascii=False, indent=4)



# def Test1():
#     update_key = "max-players"
#     update_value = 6
    
#     server_properties = read_properties_file(SERVER_PROPERTIES_PATH)
#     if update_key in server_properties:
#         server_properties[update_key] = update_value
#         print(f"max-players已修改")

#     print(server_properties)

#     return properties_Format_recovery(server_properties)

    

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
    啟動 Flask 時做：
    1. 建立或載入 config.json
    2. 同步 RCON 到 server.properties
    """
    config = load_or_create_config()
    sync_rcon_to_server_properties(config)
    return config


def send_rcon_command(command: str) -> str:
    """透過 RCON 發送 Minecraft 指令。"""
    config = load_or_create_config()

    with MCRcon(
        host=config["rcon_host"],
        password=config["rcon_password"],
        port=int(config["rcon_port"]),
    ) as mcr:
        result = mcr.command(command)

    return result

def get_online_players() -> list[str]:
    result = send_rcon_command("list")

    if  not result:
        return []
    
    # 用正則抓玩家數量
    match = re.search(r"There are (\d+) of a max of (\d+) players online",result)
    if not match:
        return []
    
    player_count = int(match.group(1))

    # 沒玩家直接回空
    if player_count == 0:
        return []
    
    # 解析玩家名稱
    if ":" not in result:
        return []
    
    players_part = result.split(":",1)[1].strip()

    if not players_part:
        return []
    
    return [name.strip() for name in players_part.split(",") if name.strip()]


def read_eula_file() -> dict:
    if not EULA_PATH.exists():
        return {
            "exists": False,
            "accepted": False,
            "url": "",
            "date": "",
            "raw_lines": []
        }

    lines = EULA_PATH.read_text(encoding="utf-8", errors="replace").splitlines()

    accepted = False
    url = ""
    date = ""

    for line in lines:
        stripped = line.strip()

        if "https://" in stripped or "http://" in stripped:
            match = re.search(r"https?://[^\s)]+", stripped)
            if match:
                url = match.group(0)

        elif stripped.startswith("#") and not date:
            # 第二行通常是日期，第一行通常是說明
            pass

        if stripped.startswith("#") and "CST" in stripped:
            date = stripped.lstrip("#").strip()

        if stripped.lower().startswith("eula="):
            value = stripped.split("=", 1)[1].strip().lower()
            accepted = value == "true"

    return {
        "exists": True,
        "accepted": accepted,
        "url": url,
        "date": date,
        "raw_lines": lines
    }


#讀取config.json
def load_config():
    if not CONFIG_PATH.exists():
        default_config = {
            "java_xms": "1G",
            "java_xmx": "4G"
        }

        save_config(default_config)
        return default_config

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


#儲存config.json
def save_config(data):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)



def open_browser():
    webbrowser.open("http://127.0.0.1:5000", new=2)



@app.route("/")
def index():
    logs = "".join(read_last_lines(LOG_FILE, max_lines=100))
    server_online = is_server_online()
    return render_template("index_zh.html", logs=logs, server_online=server_online)


@app.route("/status")
def get_status():
    response = jsonify({
        "online": is_server_online()
    })
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/log")
def get_log():
    response = jsonify({
        "logs": "".join(read_last_lines(LOG_FILE, max_lines=100))
    })
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/players")
def get_players():
    try:
        players = get_online_players()
        return jsonify({
            "success":True,
            "players":players
        })
    except Exception as error:
        return jsonify({
            "success":False,
            "players":[],
            "message":str(error)
        })


@app.route("/api/rcon/test")
def rcon_test():
    """測試 RCON 是否可用。"""
    try:
        result = send_rcon_command("list")
        return jsonify({
            "success": True,
            "message": "RCON 連線成功",
            "result": result,
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": f"RCON 連線失敗：{error}",
        }), 500


@app.route("/api/command", methods=["POST"])
def api_command():
    """給 web 指令輸入框用。"""
    data = request.get_json(silent=True) or {}
    command = str(data.get("command", "")).strip()

    if not command:
        return jsonify({
            "success": False,
            "message": "指令不可為空",
        }), 400

    try:
        result = send_rcon_command(command)
        return jsonify({
            "success": True,
            "result": result,
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error),
        }), 500
    

@app.route("/api/server/start", methods=["POST"])
def api_server_start():
    success, message = start_server()

    status_code = 200 if success else 400
    return jsonify({
        "success": success,
        "message": message
    }), status_code

@app.route("/api/server/stop", methods=["POST"])
def api_server_stop():
    success, message = stop_server()
    return jsonify({
        "success": success,
        "message": message
    })

@app.route("/api/player/action", methods=["POST"])
def api_player_action():
    data = request.get_json(silent=True) or {}
    action = str(data.get("action", "")).strip()
    player = str(data.get("player", "")).strip()

    if not action or not player:
        return jsonify({
            "success": False,
            "message": "缺少必要參數"
        }), 400

    try:
        if action == "kick":
            result = send_rcon_command(f'kick {player}')
        else:
            return jsonify({
                "success": False,
                "message": "不支援的操作"
            }), 400

        return jsonify({
            "success": True,
            "result": result
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@app.route("/api/deaths")
def api_deaths():
    try:
        deaths = get_recent_player_deaths(limit=10)
        return jsonify({
            "success": True,
            "deaths": deaths
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@app.route("/api/server/properties")
def api_get_server_properties():
    try:
        current_props = read_properties_file(SERVER_PROPERTIES_PATH)
        effective_props = get_effective_server_properties(SERVER_PROPERTIES_PATH)
        modified_comment = read_properties_modified_comment(SERVER_PROPERTIES_PATH)

        missing_keys = [
            key for key in DEFAULT_SERVER_PROPERTIES
            if key not in current_props
        ]

        unknown_keys = [
            key for key in current_props
            if key not in DEFAULT_SERVER_PROPERTIES
        ]

        return jsonify({
            "success": True,
            "properties": effective_props,
            "current_properties": current_props,
            "missing_keys": missing_keys,
            "unknown_keys": unknown_keys,
            "modified_comment": modified_comment,
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@app.route("/api/server/properties", methods=["POST"])
def api_update_server_properties():
    data = request.get_json(silent=True) or {}
    updates = data.get("properties", {})

    if not isinstance(updates, dict):
        return jsonify({
            "success": False,
            "message": "properties 格式錯誤"
        }), 400

    try:
        current_props = read_properties_file(SERVER_PROPERTIES_PATH)

        for key, value in updates.items():
            if key not in DEFAULT_SERVER_PROPERTIES:
                continue

            current_props[key] = str(value)

        lines = format_properties_for_write(current_props)
        write_properties_file(SERVER_PROPERTIES_PATH, lines)

        return jsonify({
            "success": True,
            "message": "設定已儲存。部分設定需要重啟伺服器後才會生效。"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@app.route("/api/eula/status")
def api_eula_status():
    try:
        info = read_eula_file()

        return jsonify({
            "success": True,
            "exists": info["exists"],
            "accepted": info["accepted"],
            "url": info["url"],
            "date": info["date"],
            "message_zh": "若要繼續使用 Minecraft 伺服器，你必須同意 Minecraft 使用者授權合約（EULA）。同意後，系統會將 eula.txt 中的 eula 設為 true。"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


#新增同意 API
@app.route("/api/eula/accept", methods=["POST"])
def api_eula_accept():
    try:
        info = read_eula_file()

        if not info["exists"]:
            return jsonify({
                "success": False,
                "message": "找不到 eula.txt"
            }), 404

        output_lines = []

        for line in info["raw_lines"]:
            if line.strip().lower().startswith("eula="):
                output_lines.append("eula=true")
            else:
                output_lines.append(line)

        EULA_PATH.write_text(
            "\n".join(output_lines) + "\n",
            encoding="utf-8"
        )

        return jsonify({
            "success": True,
            "message": "已同意 EULA"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


#不同意關閉程式 API
@app.route("/api/app/shutdown", methods=["POST"])
def api_app_shutdown():
    def shutdown_later():
        import os
        import time
        time.sleep(0.5)
        os._exit(0)

    threading.Thread(target=shutdown_later, daemon=True).start()

    return jsonify({
        "success": True,
        "message": "OxOcraft-Manager 即將關閉"
    })


@app.route("/api/server/runtime-config")
def api_get_runtime_config():
    try:
        config = load_or_create_config()
        return jsonify({
            "success": True,
            "config": {
                "java_xms": config.get("java_xms", "1G"),
                "java_xmx": config.get("java_xmx", "4G"),
            }
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@app.route("/api/server/runtime-config", methods=["POST"])
def api_update_runtime_config():
    data = request.get_json(silent=True) or {}
    updates = data.get("config", {})

    if not isinstance(updates, dict):
        return jsonify({
            "success": False,
            "message": "config 格式錯誤"
        }), 400

    try:
        config = load_or_create_config()

        for key in ["java_xms", "java_xmx"]:
            if key in updates:
                config[key] = str(updates[key])

        save_config(config)

        return jsonify({
            "success": True,
            "message": "啟動記憶體設定已儲存"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


if __name__ == "__main__":
    try:
        init_db()
        print("SQLite 資料庫初始化完成")
        
        init_rcon_config()
        print("RCON 設定已同步到 server.properties")
        print("請確認 Minecraft server 已重啟，否則新的 RCON 設定不會生效。")
    except Exception as error:
        print(f"初始化失敗：{error}")

    threading.Timer(1, open_browser).start()
    app.run(debug=False)