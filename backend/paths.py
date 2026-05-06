from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
MC_ROOT = PROJECT_ROOT.parent

SERVER_JAR_PATH = MC_ROOT / "server.jar"
SERVER_PROPERTIES_PATH = MC_ROOT / "server.properties"
EULA_PATH = MC_ROOT / "eula.txt"
LOG_FILE_PATH = MC_ROOT / "logs" / "latest.log"

STATIC_DIR = PROJECT_ROOT / "static"
DATA_DIR = STATIC_DIR / "data"

CONFIG_PATH = DATA_DIR / "config.json"
SERVER_PROPERTIES_FIELDS_PATH = DATA_DIR / "server_properties_fields.json"

DB_PATH = BACKEND_DIR / "instance" / "oxocraft.db"

