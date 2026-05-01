import threading
import webbrowser

from flask import Flask

from backend.db import init_db
from backend.server_config_sync import init_rcon_config

from backend.routes.death_routes import death_bp
from backend.routes.page_routes import page_bp
# from backend.routes.status_routes import status_bp
from backend.routes.command_routes import command_bp
from backend.routes.player_routes import player_bp
from backend.routes.server_routes import server_bp
from backend.routes.server_settings_routes import settings_bp
from backend.routes.eula_routes import eula_bp
from backend.server_monitor import start_server_monitor
from backend.routes.backup_routes import backup_bp
from backend.routes.cloud_routes import cloud_bp




app = Flask(__name__)
app.secret_key = "oxo_google_login_secret"

app.register_blueprint(death_bp)
app.register_blueprint(page_bp)
app.register_blueprint(command_bp)
app.register_blueprint(player_bp)
app.register_blueprint(server_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(eula_bp)
app.register_blueprint(backup_bp)
app.register_blueprint(cloud_bp)


def open_browser():
    webbrowser.open("http://127.0.0.1:5000", new=2)



if __name__ == "__main__":
    try:
        init_db()
        print("SQLite 資料庫初始化完成")
        
        init_rcon_config()
        print("RCON 設定已同步到 server.properties")
        print("請確認 Minecraft server 已重啟，否則新的 RCON 設定不會生效。")
        start_server_monitor()
        
    except Exception as error:
        print(f"初始化失敗：{error}")

    threading.Timer(1, open_browser).start()
    app.run(debug=False)