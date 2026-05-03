from flask import Blueprint, jsonify, request
from backend.paths import MC_ROOT
from backend.server_runtime import get_current_level_name, get_current_world_path, start_server, stop_server
from backend.server_monitor import get_cached_server_status
from backend.db import get_backup_records
import tkinter as tk
from tkinter import filedialog
import json
import threading
import time
from datetime import datetime, timedelta
from calendar import monthrange
from pathlib import Path

from backend.backup_service import (
    start_backup,
    cancel_backup,
    get_backup_status,
    is_backup_running,
    is_world_folder,
)
from backend.auto_backup_service import (
    get_missed_backup_status,
    run_missed_backup_now,
    skip_missed_backup,
)

CONFIG_PATH = Path("static/data/config.json")

backup_bp = Blueprint("backup", __name__)
_manual_safe_backup_running = False

def load_app_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}

    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def save_app_config(config: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(config, ensure_ascii=False, indent=4),
        encoding="utf-8"
    )


def get_folder_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                pass
    return total


def find_world_folders(root: Path) -> list[dict]:
    root = root.expanduser()
    candidates = [root] if is_world_folder(root) else []

    if root.is_dir():
        for child in root.iterdir():
            if child.is_dir() and is_world_folder(child):
                candidates.append(child)

    worlds = []
    seen = set()
    for world in candidates:
        resolved = str(world.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        worlds.append({
            "name": world.name,
            "path": str(world),
            "total_bytes": get_folder_size(world),
        })

    return worlds


def is_cached_server_online() -> bool:
    status = get_cached_server_status()
    data = status.get("data", status)
    return bool(data.get("online"))


def wait_for_backup_done() -> dict:
    while is_backup_running():
        time.sleep(1)
    return get_backup_status()


def wait_for_server_online(target_online: bool, timeout: int = 120) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        if is_cached_server_online() == target_online:
            return True
        time.sleep(1)
    return False


def manual_safe_backup_worker(source_root: str, backup_root: str, upload_cloud: bool) -> None:
    global _manual_safe_backup_running

    server_was_online = is_cached_server_online()

    try:
        if server_was_online:
            stop_server()
            wait_for_server_online(False, timeout=120)

        success, message = start_backup(
            source_root=source_root,
            backup_root=backup_root,
        )

        if not success:
            return

        result = wait_for_backup_done()

        if upload_cloud and result.get("status") == "success":
            from backend.routes.cloud_routes import start_cloud_upload_latest

            backup_path = result.get("backup_path")
            backup_folder = str(Path(backup_path).parent) if backup_path else ""
            start_cloud_upload_latest(backup_folder)

    finally:
        if server_was_online:
            start_server()

        _manual_safe_backup_running = False


def add_month_safe(dt: datetime) -> datetime:
    year = dt.year
    month = dt.month + 1

    if month > 12:
        year += 1
        month = 1

    last_day = monthrange(year, month)[1]
    day = min(dt.day, last_day)

    return dt.replace(year=year, month=month, day=day)


def add_year_safe(dt: datetime) -> datetime:
    year = dt.year + 1
    month = dt.month

    last_day = monthrange(year, month)[1]
    day = min(dt.day, last_day)

    return dt.replace(year=year, day=day)


def calculate_next_auto_backup(start_at_text: str, frequency: str) -> str:
    if not start_at_text:
        return ""

    start_at = datetime.fromisoformat(start_at_text)
    now = datetime.now()

    next_run = start_at

    while next_run <= now:
        if frequency == "daily":
            next_run = next_run.replace(day=next_run.day) + timedelta(days=1)
        elif frequency == "weekly":
            next_run = next_run + timedelta(days=7)
        elif frequency == "monthly":
            next_run = add_month_safe(next_run)
        elif frequency == "yearly":
            next_run = add_year_safe(next_run)
        else:
            next_run = next_run + timedelta(days=1)

    return next_run.strftime("%Y-%m-%dT%H:%M")


@backup_bp.route("/api/backup/start", methods=["POST"])
def api_backup_start():
    data = request.get_json(silent=True) or {}

    source_root = data.get("source_root")
    backup_root = data.get("backup_root")

    if backup_root:
        config = load_app_config()
        config["backup_root"] = backup_root
        save_app_config(config)

    success, message = start_backup(
        source_root=source_root,
        backup_root=backup_root,
    )

    return jsonify({
        "success": success,
        "message": message,
    })


@backup_bp.route("/api/backup/cancel", methods=["POST"])
def api_backup_cancel():
    cancel_backup()

    return jsonify({
        "success": True,
        "message": "已送出取消備份請求",
    })


@backup_bp.route("/api/backup/status")
def api_backup_status():
    return jsonify(get_backup_status())


@backup_bp.route("/api/backup/config")
def api_backup_config():
    world_path = get_current_world_path()
    config = load_app_config()

    return jsonify({
        "success": True,
        "source_root": str(world_path),
        "backup_root": config.get("backup_root") or str(MC_ROOT / "world_backup"),
        "manual_backup_root": config.get("manual_backup_root") or str(MC_ROOT / "world_backup"),
        "level_name": get_current_level_name(),
        "world_path": str(world_path),
    })


@backup_bp.route("/api/backup/records")
def api_backup_records():
    return jsonify({
        "success": True,
        "records": get_backup_records(20),
    })

@backup_bp.route("/api/backup/select-folder", methods=["POST"])
def api_backup_select_folder():
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    folder_path = filedialog.askdirectory(
        title="選擇資料夾"
    )

    root.destroy()

    return jsonify({
        "success": True,
        "path": folder_path or ""
    })


@backup_bp.route("/api/backup/worlds", methods=["POST"])
def api_backup_worlds():
    data = request.get_json(silent=True) or {}
    root = Path(data.get("root") or "").expanduser()

    if not root.exists() or not root.is_dir():
        return jsonify({
            "success": False,
            "message": "資料夾不存在或不是有效資料夾",
            "worlds": [],
        }), 400

    worlds = find_world_folders(root)
    return jsonify({
        "success": True,
        "root": str(root),
        "worlds": worlds,
    })


@backup_bp.route("/api/backup/manual-safe-start", methods=["POST"])
def api_backup_manual_safe_start():
    global _manual_safe_backup_running

    if _manual_safe_backup_running:
        return jsonify({
            "success": False,
            "message": "手動備份正在執行中",
        }), 409

    data = request.get_json(silent=True) or {}
    source_root = data.get("source_root") or ""
    backup_root = data.get("backup_root") or ""
    upload_cloud = bool(data.get("upload_cloud"))

    if not source_root or not is_world_folder(Path(source_root).expanduser()):
        return jsonify({
            "success": False,
            "message": "請先選擇有效的世界資料夾",
        }), 400

    if not backup_root:
        return jsonify({
            "success": False,
            "message": "請先選擇備份輸出路徑",
        }), 400

    config = load_app_config()
    config["manual_backup_root"] = backup_root
    save_app_config(config)

    _manual_safe_backup_running = True
    threading.Thread(
        target=manual_safe_backup_worker,
        args=(source_root, backup_root, upload_cloud),
        daemon=True,
    ).start()

    return jsonify({
        "success": True,
        "message": "已開始手動備份",
    })

@backup_bp.route("/api/backup/auto-config")
def api_backup_auto_config():
    config = load_app_config()
    missed_backup = get_missed_backup_status()

    return jsonify({
        "success": True,
        "config": {
            "auto_backup_enabled": config.get("auto_backup_enabled", False),
            "auto_backup_frequency": config.get("auto_backup_frequency", "daily"),
            "auto_backup_start_at": config.get("auto_backup_start_at", ""),
            "auto_backup_next_run_at": config.get("auto_backup_next_run_at", ""),
            "auto_backup_upload_cloud": config.get("auto_backup_upload_cloud", False),
            "auto_backup_missed_pending": missed_backup["pending"],
            "auto_backup_missed_run_at": missed_backup["missed_run_at"],
        }
    })


@backup_bp.route("/api/backup/auto-config", methods=["POST"])
def api_backup_auto_config_save():
    data = request.get_json(silent=True) or {}

    config = load_app_config()

    enabled = bool(data.get("auto_backup_enabled"))
    frequency = data.get("auto_backup_frequency") or "daily"
    start_at = data.get("auto_backup_start_at") or ""
    upload_cloud = bool(data.get("auto_backup_upload_cloud"))

    next_run_at = calculate_next_auto_backup(start_at, frequency) if enabled else ""

    config["auto_backup_enabled"] = enabled
    config["auto_backup_frequency"] = frequency
    config["auto_backup_start_at"] = start_at
    config["auto_backup_next_run_at"] = next_run_at
    config["auto_backup_upload_cloud"] = upload_cloud

    save_app_config(config)

    return jsonify({
        "success": True,
        "message": "自動備份設定已儲存",
        "config": {
            "auto_backup_enabled": enabled,
            "auto_backup_frequency": frequency,
            "auto_backup_start_at": start_at,
            "auto_backup_next_run_at": next_run_at,
            "auto_backup_upload_cloud": upload_cloud,
        }
    })


@backup_bp.route("/api/backup/auto-missed/skip", methods=["POST"])
def api_backup_auto_missed_skip():
    skip_missed_backup()

    return jsonify({
        "success": True,
        "message": "已跳過上次未執行的自動備份排程"
    })


@backup_bp.route("/api/backup/auto-missed/run-now", methods=["POST"])
def api_backup_auto_missed_run_now():
    success, message = run_missed_backup_now()

    status_code = 200 if success else 409
    return jsonify({
        "success": success,
        "message": message
    }), status_code
