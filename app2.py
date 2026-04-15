from __future__ import annotations

import json
from pathlib import Path
from typing import Dict
from flask import Flask, jsonify, request
from mcrcon import MCRcon

app = Flask(__name__)

# 改成你的 Minecraft server.properties 實際位置
SERVER_PROPERTIES_PATH = Path(r"..\server.properties")

CONFIG_PATH = Path("config.json")

DEFAULT_CONFIG = {
    "rcon_host": "127.0.0.1",
    "rcon_port": 25575,
    "rcon_password": "OxO123456",
}


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


def parse_properties_file(file_path: Path) -> Dict[str, str]:
    """把 server.properties 讀成 dict。忽略註解與空行。"""
    properties: Dict[str, str] = {}

    if not file_path.exists():
        raise FileNotFoundError(f"找不到 server.properties：{file_path}")

    with file_path.open("r", encoding="utf-8", errors="replace") as file:
        for raw_line in file:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                properties[key.strip()] = value.strip()

    return properties


def write_properties_file(file_path: Path, updates: Dict[str, str]) -> None:
    """
    保留原本內容順序，僅更新指定 key；
    若 key 原本不存在，補到最後。
    """
    if not file_path.exists():
        raise FileNotFoundError(f"找不到 server.properties：{file_path}")

    with file_path.open("r", encoding="utf-8", errors="replace") as file:
        lines = file.readlines()

    updated_keys = set()
    new_lines: list[str] = []

    for raw_line in lines:
        stripped = raw_line.strip()

        if not stripped or stripped.startswith("#") or "=" not in raw_line:
            new_lines.append(raw_line)
            continue

        key, _ = raw_line.split("=", 1)
        key = key.strip()

        if key in updates:
            new_lines.append(f"{key}={updates[key]}\n")
            updated_keys.add(key)
        else:
            new_lines.append(raw_line)

    for key, value in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={value}\n")

    with file_path.open("w", encoding="utf-8", errors="replace") as file:
        file.writelines(new_lines)


def sync_rcon_to_server_properties(config: Dict) -> None:
    """把 config.json 的 RCON 設定同步到 server.properties。"""
    updates = {
        "enable-rcon": "true",
        "rcon.port": str(config["rcon_port"]),
        "rcon.password": str(config["rcon_password"]),
    }
    write_properties_file(SERVER_PROPERTIES_PATH, updates)


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


@app.route("/api/rcon/test")
def rcon_test():
    """測試 RCON 是否可用。先用 list 測試最直觀。"""
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
    """之後給 web 指令輸入框用。"""
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


@app.route("/")
def index():
    return """
    <h1>OxO_MCServerManager</h1>
    <p>RCON 初始化版已啟動。</p>
    <p>請先確認 Minecraft server 已重啟，讓 RCON 設定生效。</p>
    <p>測試網址：<a href="/api/rcon/test">/api/rcon/test</a></p>
    """


if __name__ == "__main__":
    try:
        init_rcon_config()
        print("RCON 設定已同步到 server.properties")
        print("請確認 Minecraft server 已重啟，否則新的 RCON 設定不會生效。")
    except Exception as error:
        print(f"初始化失敗：{error}")

    app.run(debug=True)