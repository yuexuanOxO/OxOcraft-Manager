from flask import Blueprint, jsonify, request
from backend.paths import MC_ROOT
from backend.server_runtime import get_current_level_name, get_current_world_path
from backend.db import get_backup_records
import tkinter as tk
from tkinter import filedialog
import json
from datetime import datetime, timedelta
from calendar import monthrange
from pathlib import Path

from backend.backup_service import (
    start_backup,
    cancel_backup,
    get_backup_status,
)
from backend.auto_backup_service import (
    get_missed_backup_status,
    run_missed_backup_now,
    skip_missed_backup,
)

CONFIG_PATH = Path("static/data/config.json")

backup_bp = Blueprint("backup", __name__)

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

    return jsonify({
        "success": True,
        "source_root": str(MC_ROOT),
        "backup_root": str(MC_ROOT / "world_backup"),
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
