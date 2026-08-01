from pathlib import Path, PurePosixPath
from threading import Lock
from flask import Blueprint, jsonify, send_file

from backend.backup_service import (
    get_folder_size,
    is_world_folder,
)

from backend.server_settings.server_properties import (
    format_properties_for_write,
    read_properties_file,
    write_properties_file,
)

from backend.world_service import (
    count_world_players,
    read_world_metadata,
    switch_world_icons,
)

from backend.paths import (
    MC_ROOT,
    SERVER_PROPERTIES_PATH,
    STATIC_DIR,
)

from backend.server_monitor import (
    refresh_server_status_now,
)

from backend.server_runtime import (
    lock_current_world_path,
)

from backend.world_settings_service import (
    apply_world_properties,
    load_or_create_world_properties,
)


world_bp = Blueprint("world", __name__)
_world_switch_lock = Lock()


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
                "player_count": (
                    count_world_players(world_path)
                    if is_valid_world
                    else None
                ),
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
                "player_count": count_world_players(
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
    "/api/worlds/<string:folder_name>/switch",
    methods=["POST"],
)
def api_switch_world(
    folder_name: str,
):
    if not SERVER_PROPERTIES_PATH.is_file():
        return jsonify({
            "success": False,
            "message": "找不到 server.properties",
        }), 404

    with _world_switch_lock:
        try:
            status = refresh_server_status_now()

            status_data = status.get(
                "data",
                status,
            )

            state = status_data.get(
                "state",
                "unknown",
            )

            online = bool(
                status_data.get("online")
            )

            if (
                online
                or state != "offline"
            ):
                return jsonify({
                    "success": False,
                    "message": (
                        "只有伺服器完全離線時"
                        "才能切換世界"
                    ),
                }), 409

            target_world_path = (
                MC_ROOT / folder_name
            )

            if (
                target_world_path.resolve().parent
                != MC_ROOT.resolve()
                or not is_world_folder(
                    target_world_path
                )
            ):
                return jsonify({
                    "success": False,
                    "message": "找不到世界存檔",
                }), 404

            (
                current_level_name,
                current_folder_name,
            ) = _read_configured_level_name()

            if current_folder_name is None:
                return jsonify({
                    "success": False,
                    "message": (
                        "目前 server.properties "
                        "的 level-name 格式無效"
                    ),
                }), 409

            current_world_path = (
                MC_ROOT / current_folder_name
            )

            if _paths_are_same(
                current_world_path,
                target_world_path,
            ):
                return jsonify({
                    "success": True,
                    "message": (
                        f"{folder_name} 已經是"
                        "目前使用中的世界"
                    ),
                    "level_name": folder_name,
                })

            if not is_world_folder(
                current_world_path
            ):
                return jsonify({
                    "success": False,
                    "message": (
                        "目前使用中的世界存檔"
                        "不存在或無法辨識，"
                        "因此無法保存目前 Icon"
                    ),
                }), 409

            original_properties = (
                SERVER_PROPERTIES_PATH
                .read_bytes()
            )

            current_properties = (
                read_properties_file(
                    SERVER_PROPERTIES_PATH
                )
            )

            # 目前世界沒有 JSON 時，
            # 使用目前 server.properties 與 level.dat 補建。
            load_or_create_world_properties(
                current_world_path,
                current_server_properties=(
                    current_properties
                ),
            )

            # 目標世界沒有 JSON 時，
            # 使用該世界的 level.dat 與安全預設值補建。
            target_world_properties = (
                load_or_create_world_properties(
                    target_world_path
                )
            )

            next_properties = (
                apply_world_properties(
                    current_properties,
                    target_world_properties,
                )
            )

            next_properties[
                "level-name"
            ] = target_world_path.name

            try:
                properties_lines = (
                    format_properties_for_write(
                        next_properties
                    )
                )

                write_properties_file(
                    SERVER_PROPERTIES_PATH,
                    properties_lines,
                )

                switch_world_icons(
                    current_world_path=
                        current_world_path,

                    target_world_path=
                        target_world_path,

                    server_icon_path=(
                        MC_ROOT
                        / "server-icon.png"
                    ),
                )

            except Exception:
                # Icon 或 properties 任一項失敗，
                # 都把 level-name 還原。
                SERVER_PROPERTIES_PATH.write_bytes(
                    original_properties
                )

                raise

            # server_runtime 會快取目前世界路徑，
            # 切換完成後必須同步更新。
            lock_current_world_path()

            return jsonify({
                "success": True,
                "message": (
                    f"已切換至世界："
                    f"{target_world_path.name}"
                ),
                "previous_level_name":
                    current_level_name,
                "level_name":
                    target_world_path.name,
            })

        except Exception as error:
            return jsonify({
                "success": False,
                "message": (
                    f"切換世界失敗：{error}"
                ),
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