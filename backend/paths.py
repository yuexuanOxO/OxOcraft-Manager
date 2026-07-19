import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent


# Manager 程式根目錄
#
# 開發環境：
#   OxOcraft-Manager 專案根目錄
#
# PyInstaller 打包環境：
#   OxOcraft-Manager.exe 所在目錄
if getattr(sys, "frozen", False):
    APP_ROOT = Path(sys.executable).resolve().parent
else:
    APP_ROOT = PROJECT_ROOT


def find_mc_root() -> Path:
    current = PROJECT_ROOT

    for _ in range(5):
        if (current / "server.jar").exists():
            return current

        current = current.parent

    return PROJECT_ROOT.parent


# Minecraft 伺服器根目錄
MC_ROOT = find_mc_root()

SERVER_JAR_PATH = MC_ROOT / "server.jar"
SERVER_PROPERTIES_PATH = MC_ROOT / "server.properties"
EULA_PATH = MC_ROOT / "eula.txt"
LOG_FILE_PATH = MC_ROOT / "logs" / "latest.log"


# 打包進程式的唯讀資源
STATIC_DIR = PROJECT_ROOT / "static"
STATIC_DATA_DIR = STATIC_DIR / "data"

SERVER_PROPERTIES_FIELDS_PATH = (
    STATIC_DATA_DIR / "server_properties_fields.json"
)


# Manager 執行期間產生的可變資料
APP_DATA_DIR = APP_ROOT / "data"

CONFIG_PATH = APP_DATA_DIR / "config.json"
EFFECTIVE_SETTINGS_PATH = (
    APP_DATA_DIR / "server_effective_settings.json"
)


# 目前先維持原本位置，之後再另外處理
DB_PATH = BACKEND_DIR / "instance" / "oxocraft.db"