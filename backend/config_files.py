import json
import re
from typing import Dict

from backend.paths import CONFIG_PATH, EULA_PATH

DEFAULT_CONFIG = {
    "rcon_host": "127.0.0.1",
    "rcon_port": 25575,
    "rcon_password": "OxO123456",
    "java_xms": "2G",
    "java_xmx": "4G",
}



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