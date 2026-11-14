import json
import os
import threading
import re
import secrets
import string

from typing import Dict

from backend.paths import CONFIG_PATH, EULA_PATH, MC_ROOT

_config_lock = threading.RLock()

def generate_secure_password(length: int = 40) -> str:
    chars = string.ascii_letters + string.digits

    return "".join(
        secrets.choice(chars)
        for _ in range(length)
    )


def generate_rcon_password() -> str:
    return generate_secure_password()


def generate_management_secret() -> str:
    return generate_secure_password()

DEFAULT_CONFIG = {
    "rcon_host": "127.0.0.1",
    "rcon_port": 25575,
    "rcon_password": generate_rcon_password(),
    "java_xms": "2G",
    "java_xmx": "4G",
    "java_executable": "java",
}

def _legacy_java_default() -> str:
    # 只在 config.json 尚未有此欄位時讀取舊設定，不刪除舊檔。
    old_path = CONFIG_PATH.parent / "java_runtime.json"
    if old_path.exists():
        try:
            data = json.loads(old_path.read_text(encoding="utf-8"))
            root_key = os.path.normcase(str(MC_ROOT.resolve()))
            value = data.get("servers", {}).get(root_key)
            if isinstance(value, str) and value.strip():
                return value
        except (OSError, ValueError, TypeError, AttributeError) as error:
            print("[Java] 無法讀取舊的預設 Java 設定：", error)
    return "java"


def load_or_create_config() -> Dict:
    with _config_lock:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        if CONFIG_PATH.exists():
            with CONFIG_PATH.open("r", encoding="utf-8") as file:
                config = json.load(file)
        else:
            config = {}
        if not isinstance(config, dict):
            raise ValueError("config.json 必須是 JSON 物件。")
        changed = False
        if "java_executable" not in config:
            config["java_executable"] = _legacy_java_default()
            changed = True
        for key, value in DEFAULT_CONFIG.items():
            if key not in config:
                config[key] = value
                changed = True
        if changed:
            save_config(config)
        return config


def save_config(config: Dict) -> None:
    """以暫存檔替換 config.json，避免讀到寫入一半的內容。"""
    with _config_lock:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = CONFIG_PATH.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(config, ensure_ascii=False, indent=4), encoding="utf-8"
        )
        os.replace(temporary, CONFIG_PATH)


def update_config(updates: Dict) -> Dict:
    """讀取最新設定後只更新指定欄位，保留其他伺服器參數。"""
    with _config_lock:
        config = load_or_create_config()
        config.update(updates)
        save_config(config)
        return config



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
