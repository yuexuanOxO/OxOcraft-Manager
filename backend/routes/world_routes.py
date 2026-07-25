from pathlib import PurePosixPath

from flask import Blueprint, jsonify

from backend.paths import MC_ROOT, SERVER_PROPERTIES_PATH
from backend.backup_service import is_world_folder
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

        path_parts = PurePosixPath(
            normalized_level_name
        ).parts

        world_path = MC_ROOT.joinpath(*path_parts)

        folder_exists = world_path.is_dir()
        is_valid_world = is_world_folder(world_path)

        is_all_save = (
            len(path_parts) >= 2
            and path_parts[0].lower() == "all_save"
        )

        display_path = (
            "/".join(path_parts)
            if is_all_save
            else None
        )

        return jsonify({
            "success": True,
            "world": {
                "folder_name": folder_name,
                "level_name": level_name,
                "is_all_save": is_all_save,
                "display_path": display_path,
                "folder_exists": folder_exists,
                "is_valid_world": is_valid_world,
            },
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": f"讀取目前世界失敗：{error}",
        }), 500