from pathlib import Path, PurePosixPath
from threading import Lock

from flask import (
    Blueprint,
    jsonify,
    request,
    send_file,
)

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
    WORLD_SETTINGS_FILE_NAME,
    apply_world_properties,
    load_or_create_world_properties,
    normalize_world_properties,
    save_world_properties,
)


world_bp = Blueprint("world", __name__)
_world_operation_lock = Lock()

INVALID_WORLD_NAME_CHARACTERS = set(
    '<>:"/\\|?*'
)

WINDOWS_RESERVED_WORLD_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    "com1",
    "com2",
    "com3",
    "com4",
    "com5",
    "com6",
    "com7",
    "com8",
    "com9",
    "lpt1",
    "lpt2",
    "lpt3",
    "lpt4",
    "lpt5",
    "lpt6",
    "lpt7",
    "lpt8",
    "lpt9",
}


def _is_pending_world_folder(
    world_path: Path,
) -> bool:
    try:
        return (
            world_path.is_dir()
            and not is_world_folder(
                world_path
            )
            and (
                world_path
                / WORLD_SETTINGS_FILE_NAME
            ).is_file()
        )

    except OSError:
        return False


def _normalize_new_world_name(
    value,
) -> str:
    if not isinstance(value, str):
        raise ValueError(
            "世界名稱格式無效"
        )

    folder_name = value.strip()

    if not folder_name:
        raise ValueError(
            "請輸入世界名稱"
        )

    if len(folder_name) > 128:
        raise ValueError(
            "世界名稱不能超過 128 個字元"
        )

    if (
        folder_name in {".", ".."}
        or ".." in folder_name
    ):
        raise ValueError(
            "世界名稱不能包含 .."
        )

    if folder_name.endswith("."):
        raise ValueError(
            "世界名稱不能以句點結尾"
        )

    if any(
        character in INVALID_WORLD_NAME_CHARACTERS
        or ord(character) < 32
        for character in folder_name
    ):
        raise ValueError(
            "世界名稱包含無效字元"
        )

    reserved_name = (
        folder_name
        .split(".", 1)[0]
        .casefold()
    )

    if (
        reserved_name
        in WINDOWS_RESERVED_WORLD_NAMES
    ):
        raise ValueError(
            "此世界名稱為系統保留名稱"
        )

    target_world_path = (
        MC_ROOT / folder_name
    )

    if (
        target_world_path.resolve().parent
        != MC_ROOT.resolve()
    ):
        raise ValueError(
            "世界名稱指向了無效位置"
        )

    return folder_name


def _normalize_initial_pack_setting(
    value,
    default_value: str,
    property_label: str,
) -> str:
    if value is None:
        value = default_value

    if not isinstance(value, str):
        raise ValueError(
            f"{property_label}格式無效"
        )

    if (
        "\r" in value
        or "\n" in value
    ):
        raise ValueError(
            f"{property_label}不能包含換行"
        )

    return value.strip()


def _find_root_name_conflict(
    folder_name: str,
) -> Path | None:
    normalized_name = (
        folder_name.casefold()
    )

    for entry in MC_ROOT.iterdir():
        if (
            entry.name.casefold()
            == normalized_name
        ):
            return entry

    return None

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
            if (
                not is_world_folder(entry)
                and not _is_pending_world_folder(
                    entry
                )
            ):
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

        is_pending_generation = (
            world_path is not None
            and _is_pending_world_folder(
                world_path
            )
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
                "is_pending_generation":is_pending_generation,
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

            is_valid_world = (
                is_world_folder(
                    world_path
                )
            )

            is_pending_generation = (
                not is_valid_world
                and _is_pending_world_folder(
                    world_path
                )
            )

            metadata = (
                read_world_metadata(
                    world_path
                )
                if is_valid_world
                else None
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
                "is_valid_world": is_valid_world,
                "is_pending_generation": is_pending_generation,
                "size_bytes": get_folder_size(
                    world_path
                ),
                "player_count": (
                    count_world_players(
                        world_path
                    )
                    if is_valid_world
                    else None
                ),
                "has_icon": icon_path.is_file(),
                "metadata": metadata,
            })

        worlds.sort(
            key=lambda world: (
                not world["is_current"],
                -(
                    (
                        world["metadata"]
                        or {}
                    ).get(
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
    "/api/worlds",
    methods=["POST"],
)
def api_create_world():
    if not SERVER_PROPERTIES_PATH.is_file():
        return jsonify({
            "success": False,
            "message": (
                "找不到 server.properties"
            ),
        }), 404

    with _world_operation_lock:
        try:
            status = (
                refresh_server_status_now()
            )

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
                        "才能建立新世界"
                    ),
                }), 409

            payload = request.get_json(
                silent=True
            )

            if not isinstance(
                payload,
                dict,
            ):
                return jsonify({
                    "success": False,
                    "message": (
                        "建立世界資料格式無效"
                    ),
                }), 400

            try:
                folder_name = (
                    _normalize_new_world_name(
                        payload.get(
                            "level-name"
                        )
                    )
                )

                world_properties = (
                    normalize_world_properties(
                        payload
                    )
                )

                initial_enabled_packs = (
                    _normalize_initial_pack_setting(
                        payload.get(
                            "initial-enabled-packs"
                        ),
                        "vanilla",
                        "預設啟用資料包",
                    )
                )

                initial_disabled_packs = (
                    _normalize_initial_pack_setting(
                        payload.get(
                            "initial-disabled-packs"
                        ),
                        "",
                        "預設停用資料包",
                    )
                )

            except ValueError as error:
                return jsonify({
                    "success": False,
                    "message": str(error),
                }), 400

            pending_world_paths = [
                world_path
                for world_path
                in _list_world_paths()
                if _is_pending_world_folder(
                    world_path
                )
            ]

            if pending_world_paths:
                pending_world_name = (
                    pending_world_paths[0].name
                )

                return jsonify({
                    "success": False,
                    "message": (
                        "目前已有待生成世界："
                        f"{pending_world_name}。"
                        "請先啟動伺服器完成生成"
                    ),
                }), 409

            name_conflict = (
                _find_root_name_conflict(
                    folder_name
                )
            )

            if name_conflict is not None:
                return jsonify({
                    "success": False,
                    "message": (
                        "伺服器目錄中已存在"
                        "相同名稱的檔案或資料夾："
                        f"{name_conflict.name}"
                    ),
                }), 409

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
                MC_ROOT
                / current_folder_name
            )

            if not is_world_folder(
                current_world_path
            ):
                return jsonify({
                    "success": False,
                    "message": (
                        "目前使用中的世界存檔"
                        "不存在或無法辨識，"
                        "因此無法建立新世界"
                    ),
                }), 409

            current_properties = (
                read_properties_file(
                    SERVER_PROPERTIES_PATH
                )
            )

            original_properties = (
                SERVER_PROPERTIES_PATH
                .read_bytes()
            )

            # 確保目前世界已保存自己的生成參數。
            load_or_create_world_properties(
                current_world_path,
                current_server_properties=(
                    current_properties
                ),
            )

            target_world_path = (
                MC_ROOT / folder_name
            )

            target_created = False

            try:
                target_world_path.mkdir()
                target_created = True

                save_world_properties(
                    target_world_path,
                    world_properties,
                )

                next_properties = (
                    apply_world_properties(
                        current_properties,
                        world_properties,
                    )
                )

                next_properties[
                    "level-name"
                ] = folder_name

                next_properties[
                    "initial-enabled-packs"
                ] = initial_enabled_packs

                next_properties[
                    "initial-disabled-packs"
                ] = initial_disabled_packs

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
                SERVER_PROPERTIES_PATH.write_bytes(
                    original_properties
                )

                if target_created:
                    settings_path = (
                        target_world_path
                        / WORLD_SETTINGS_FILE_NAME
                    )

                    try:
                        settings_path.unlink()

                    except FileNotFoundError:
                        pass

                    try:
                        target_world_path.rmdir()

                    except FileNotFoundError:
                        pass

                raise

            lock_current_world_path()

            return jsonify({
                "success": True,
                "message": (
                    f"已建立待生成世界："
                    f"{folder_name}。"
                    "請手動啟動伺服器"
                    "以完成世界生成"
                ),
                "previous_level_name":
                    current_level_name,
                "level_name":
                    folder_name,
                "world": {
                    "folder_name":
                        folder_name,
                    "folder_path":
                        str(
                            target_world_path
                            .resolve()
                        ),
                    "level_name":
                        folder_name,
                    "is_current":
                        True,
                    "folder_exists":
                        True,
                    "is_valid_world":
                        False,
                    "is_pending_generation":
                        True,
                    "size_bytes":
                        get_folder_size(
                            target_world_path
                        ),
                    "player_count":
                        None,
                    "has_icon":
                        False,
                    "metadata":
                        None,
                },
            }), 201

        except Exception as error:
            return jsonify({
                "success": False,
                "message": (
                    "建立新世界失敗："
                    f"{error}"
                ),
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

    with _world_operation_lock:
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

            current_world_is_valid = (
                is_world_folder(
                    current_world_path
                )
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


            original_properties = (
                SERVER_PROPERTIES_PATH
                .read_bytes()
            )

            current_properties = (
                read_properties_file(
                    SERVER_PROPERTIES_PATH
                )
            )

            # 目前世界仍然存在時，
            # 才保存 / 補建目前世界的生成參數。
            #
            # 如果 level-name 指向的世界已消失，
            # 則直接進入 recovery 切換流程。
            if current_world_is_valid:
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
            or (
                not is_world_folder(
                    world_path
                )
                and not _is_pending_world_folder(
                    world_path
                )
            )
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