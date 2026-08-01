from pathlib import Path, PurePosixPath

from flask import Blueprint, jsonify, send_file

from backend.backup_service import (
    get_folder_size,
    is_world_folder,
)

from backend.server_settings.server_properties import (
    read_properties_file,
)

from backend.world_service import (
    read_world_metadata,
)

from backend.paths import (
    MC_ROOT,
    SERVER_PROPERTIES_PATH,
    STATIC_DIR,
)


world_bp = Blueprint("world", __name__)


def _read_configured_level_name() -> tuple[str, str | None]:
    properties = read_properties_file(
        SERVER_PROPERTIES_PATH
    )

    level_name = str(
        properties.get("level-name", "world")
    ).strip() or "world"

    normalized_path = PurePosixPath(
        level_name.replace("\\", "/")
    )

    if (
        len(normalized_path.parts) != 1
        or normalized_path.name in {"", ".", ".."}
    ):
        return level_name, None

    return level_name, normalized_path.name


def _paths_are_same(
    first_path: Path | None,
    second_path: Path | None,
) -> bool:
    if first_path is None or second_path is None:
        return False

    try:
        return (
            first_path.resolve()
            == second_path.resolve()
        )

    except OSError:
        return False


def _list_world_paths() -> list[Path]:
    world_paths = []

    try:
        resolved_mc_root = MC_ROOT.resolve()
        root_entries = list(MC_ROOT.iterdir())

    except OSError:
        return world_paths

    for entry in root_entries:
        try:
            if not is_world_folder(entry):
                continue

            if entry.resolve().parent != resolved_mc_root:
                continue

            world_paths.append(entry)

        except OSError:
            continue

    return world_paths


@world_bp.route("/api/worlds/current")
def api_current_world():
    if not SERVER_PROPERTIES_PATH.exists():
        return jsonify({
            "success": False,
            "message": "找不到 server.properties",
        }), 404

    try:
        level_name, folder_name = (
            _read_configured_level_name()
        )

        world_path = (
            MC_ROOT / folder_name
            if folder_name is not None
            else None
        )

        folder_exists = (
            world_path is not None
            and world_path.is_dir()
        )

        is_valid_world = (
            world_path is not None
            and is_world_folder(world_path)
        )

        world_size_bytes = (
            get_folder_size(world_path)
            if folder_exists
            else None
        )

        world_metadata = (
            read_world_metadata(world_path)
            if is_valid_world
            else None
        )

        icon_path = MC_ROOT / "server-icon.png"

        return jsonify({
            "success": True,
            "world": {
                "folder_name": (
                folder_name or level_name
            ),
            "folder_path": (
                str(world_path)
                if world_path is not None
                else level_name
            ),
            "level_name": level_name,
                "is_current": True,
                "folder_exists": folder_exists,
                "is_valid_world": is_valid_world,
                "size_bytes": world_size_bytes,
                "has_icon": icon_path.is_file(),
                "metadata": world_metadata,
            },
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": f"讀取目前世界失敗：{error}",
        }), 500


@world_bp.route("/api/worlds")
def api_world_list():
    if not SERVER_PROPERTIES_PATH.exists():
        return jsonify({
            "success": False,
            "message": "找不到 server.properties",
        }), 404

    try:
        level_name, current_folder_name = (
            _read_configured_level_name()
        )

        current_world_path = (
            MC_ROOT / current_folder_name
            if current_folder_name is not None
            else None
        )

        worlds = []

        for world_path in _list_world_paths():
            is_current = _paths_are_same(
                world_path,
                current_world_path,
            )

            metadata = read_world_metadata(
                world_path
            )

            icon_path = (
                MC_ROOT / "server-icon.png"
                if is_current
                else world_path / "server-icon.png"
            )

            worlds.append({
                "folder_name": world_path.name,
                "folder_path": str(
                    world_path.resolve()
                ),
                "level_name": world_path.name,
                "is_current": is_current,
                "folder_exists": True,
                "is_valid_world": True,
                "size_bytes": get_folder_size(
                    world_path
                ),
                "has_icon": icon_path.is_file(),
                "metadata": metadata,
            })

        worlds.sort(
            key=lambda world: (
                not world["is_current"],
                -(
                    world["metadata"].get(
                        "last_saved_at"
                    )
                    or 0
                ),
                world["folder_name"].casefold(),
            )
        )

        return jsonify({
            "success": True,
            "current_level_name": level_name,
            "worlds": worlds,
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": f"讀取世界清單失敗：{error}",
        }), 500


@world_bp.route(
    "/api/worlds/<string:folder_name>/icon"
)
def api_world_icon(folder_name: str):
    world_path = MC_ROOT / folder_name

    try:
        if (
            world_path.resolve().parent
            != MC_ROOT.resolve()
            or not is_world_folder(world_path)
        ):
            return jsonify({
                "success": False,
                "message": "找不到世界存檔",
            }), 404

        _, current_folder_name = (
            _read_configured_level_name()
        )

        current_world_path = (
            MC_ROOT / current_folder_name
            if current_folder_name is not None
            else None
        )

        is_current = _paths_are_same(
            world_path,
            current_world_path,
        )

        icon_path = (
            MC_ROOT / "server-icon.png"
            if is_current
            else world_path / "server-icon.png"
        )

        default_icon_path = (
            STATIC_DIR
            / "icons"
            / "server_settings"
            / "default_server_icon.png"
        )

        if icon_path.is_file():
            return send_file(
                icon_path,
                mimetype="image/png",
                max_age=0,
            )

        return send_file(
            default_icon_path,
            mimetype="image/png",
            max_age=0,
        )

    except OSError:
        return jsonify({
            "success": False,
            "message": "讀取世界圖示失敗",
        }), 500