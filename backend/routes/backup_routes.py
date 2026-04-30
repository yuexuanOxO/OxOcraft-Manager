from flask import Blueprint, jsonify, request
from backend.paths import MC_ROOT
from backend.server_runtime import get_current_level_name, get_current_world_path

from backend.backup_service import (
    start_backup,
    cancel_backup,
    get_backup_status,
)

backup_bp = Blueprint("backup", __name__)


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