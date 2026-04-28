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
from backend.routes.command_routes import command_bp
from backend.routes.player_routes import player_bp
from backend.routes.server_routes import server_bp
from backend.routes.server_settings_routes import settings_bp
from backend.routes.eula_routes import eula_bp

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
app.register_blueprint(command_bp)
app.register_blueprint(player_bp)
app.register_blueprint(server_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(eula_bp)



BASE_DIR = Path(__file__).resolve().parent
SERVER_ROOT = BASE_DIR.parent

SERVER_PROPERTIES_PATH = SERVER_ROOT / "server.properties"
CONFIG_PATH = BASE_DIR / "static" / "data" / "config.json"
EULA_PATH = SERVER_ROOT / "eula.txt"




def open_browser():
    webbrowser.open("http://127.0.0.1:5000", new=2)



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