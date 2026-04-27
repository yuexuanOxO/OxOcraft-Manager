import json
from pathlib import Path
from typing import Dict
from flask import Flask, render_template, jsonify, request
from backend.server_runtime import start_server,stop_server
import webbrowser
import threading
from backend.routes.death_routes import death_bp
from backend.routes.page_routes import page_bp
from backend.routes.status_routes import status_bp

from backend.db import init_db, get_recent_player_deaths
from backend.server_status import is_server_online
from backend.rcon_service import send_rcon_command, get_online_players
from backend.server_config_sync import init_rcon_config
from backend.log_reader import read_last_lines
from backend.server_settings.server_properties import (
    DEFAULT_SERVER_PROPERTIES,
    read_properties_file,
    get_effective_server_properties,
    format_properties_for_write,
    write_properties_file,
    read_properties_modified_comment,
)
from backend.paths import (
    SERVER_PROPERTIES_PATH,
    LOG_FILE_PATH,
    CONFIG_PATH,
    EULA_PATH,
)

from backend.config_files import (
    load_or_create_config,
    save_config,
    read_eula_file,
)


app = Flask(__name__)

app.register_blueprint(death_bp)
app.register_blueprint(page_bp)
app.register_blueprint(status_bp)


BASE_DIR = Path(__file__).resolve().parent
SERVER_ROOT = BASE_DIR.parent

SERVER_PROPERTIES_PATH = SERVER_ROOT / "server.properties"
CONFIG_PATH = BASE_DIR / "static" / "data" / "config.json"
EULA_PATH = SERVER_ROOT / "eula.txt"




#儲存config.json
def save_config(data):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)



def open_browser():
    webbrowser.open("http://127.0.0.1:5000", new=2)



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