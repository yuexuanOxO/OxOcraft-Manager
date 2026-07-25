from pathlib import PurePosixPath

from flask import Blueprint, jsonify

from backend.paths import SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import (
    read_properties_file,
)


world_bp = Blueprint("world", __name__)


@world_bp.route("/api/worlds/current")
def api_current_world():
    if not SERVER_PROPERTIES_PATH.exists():
        return jsonify({
            "success": False,
            "message": "找不到 server.properties",
        }), 404

    try:
        properties = read_properties_file(
            SERVER_PROPERTIES_PATH
        )

        level_name = str(
            properties.get("level-name", "world")
        ).strip() or "world"

        normalized_level_name = (
            level_name.replace("\\", "/")
        )

        folder_name = PurePosixPath(
            normalized_level_name
        ).name or "world"

        return jsonify({
            "success": True,
            "world": {
                "folder_name": folder_name,
                "level_name": level_name,
            },
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": f"讀取目前世界失敗：{error}",
        }), 500