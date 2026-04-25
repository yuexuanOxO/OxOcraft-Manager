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
from database import init_db, get_recent_player_deaths

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
SERVER_ROOT = BASE_DIR.parent

SERVER_PROPERTIES_PATH = SERVER_ROOT / "server.properties"
LOG_FILE = SERVER_ROOT / "logs" / "latest.log"
CONFIG_PATH = BASE_DIR / "config.json"

DEFAULT_CONFIG = {
    "rcon_host": "127.0.0.1",
    "rcon_port": 25575,
    "rcon_password": "OxO123456",
}



def is_server_online(host: str = "127.0.0.1", port: int = 25565, timeout: int = 1) -> bool:
    #讀取server.properties設定值的port
    server_properties = read_properties_file()
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
    """讀取 config.json；若不存在就建立預設檔。"""
    if not CONFIG_PATH.exists():
        with CONFIG_PATH.open("w", encoding="utf-8") as file:
            json.dump(DEFAULT_CONFIG, file, ensure_ascii=False, indent=4)
        return DEFAULT_CONFIG.copy()

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_config(config: Dict) -> None:
    """儲存 config.json。"""
    with CONFIG_PATH.open("w", encoding="utf-8") as file:
        json.dump(config, file, ensure_ascii=False, indent=4)


def read_properties_file():
    file_path:Path =SERVER_PROPERTIES_PATH

    if not file_path.exists():
        raise FileNotFoundError(f"找不到 server.properties：{file_path}")

    with file_path.open("r", encoding="utf-8", errors="replace") as file:
        lines = file.readlines()
        #print(f"lines:{lines}")
        
    new_lines: list[str] = []
    server_properties = {}

    for raw_line in lines:
        stripped = raw_line.strip()
        # print(repr(raw_line))
        

        #過濾掉server.properties的空白&註解
        if not stripped or stripped.startswith("#") or "=" not in raw_line:
            new_lines.append(raw_line)
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()

        server_properties[key] = value
        # print(f"{key}={value}")
        # print(stripped)
        
    #print(server_properties)
        
    return server_properties



def properties_Format_recovery(update_server_properties):
    original_Format_server_properties: list[str] = []

    for key in update_server_properties:
        original_Format_server_properties.append(f"{key}={update_server_properties[key]}\n") 
        
    return write_properties_file(original_Format_server_properties)



def write_properties_file(original_Format_server_properties):

    with SERVER_PROPERTIES_PATH.open("w", encoding="utf-8", errors="replace") as file:
        file.writelines(original_Format_server_properties)



# def Test1():
#     update_key = "max-players"
#     update_value = 6
    
#     server_properties = read_properties_file()
#     if update_key in server_properties:
#         server_properties[update_key] = update_value
#         print(f"max-players已修改")

#     print(server_properties)

#     return properties_Format_recovery(server_properties)

    

def sync_rcon_to_server_properties(config: Dict) -> None:
    """把 config.json 的 RCON 設定同步到 server.properties。"""
    updates = {
        "enable-rcon": "true",
        "rcon.port": str(config["rcon_port"]),
        "rcon.password": str(config["rcon_password"]),
    }

    server_properties = read_properties_file()
    server_properties.update(updates)

    return properties_Format_recovery(server_properties)
            


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