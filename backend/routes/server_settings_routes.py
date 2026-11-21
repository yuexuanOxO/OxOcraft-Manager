from backend import java_runtime
from flask import Blueprint, jsonify, request, send_file
from PIL import Image, UnidentifiedImageError
from backend.server_config_sync import init_rcon_config
from backend.server_runtime import validate_server_bind_ip
from backend.paths import SERVER_PROPERTIES_PATH,MC_ROOT,STATIC_DIR

from backend.config_files import (
    memory_gb_pair,
    load_or_create_config,
    save_config,
    update_config,
    generate_rcon_password,
    generate_management_secret,
)

from backend.server_settings.server_properties import (
    DEFAULT_SERVER_PROPERTIES,
    read_properties_file,
    get_effective_server_properties,
    format_properties_for_write,
    write_properties_file,
    read_properties_modified_comment,
)

from backend.management_api.monitor import (
    update_management_secret,
)

from backend.server_effective_settings import (
    load_effective_settings_snapshot,
    save_effective_settings_snapshot,
)

from backend.server_monitor import (
    refresh_server_status_now,
)


settings_bp = Blueprint("settings", __name__)


@settings_bp.route("/api/server/properties")
def api_get_server_properties():
    try:
        current_props = read_properties_file(SERVER_PROPERTIES_PATH)
        effective_props = get_effective_server_properties(SERVER_PROPERTIES_PATH)
        modified_comment = read_properties_modified_comment(SERVER_PROPERTIES_PATH)

        missing_keys = [
            key for key in DEFAULT_SERVER_PROPERTIES
            if key not in current_props
        ]

        unknown_keys = [
            key for key in current_props
            if key not in DEFAULT_SERVER_PROPERTIES
        ]

        return jsonify({
            "success": True,
            "properties": effective_props,
            "current_properties": current_props,
            "missing_keys": missing_keys,
            "unknown_keys": unknown_keys,
            "modified_comment": modified_comment,
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@settings_bp.route("/api/server/properties", methods=["POST"])
def api_update_server_properties():
    data = request.get_json(silent=True) or {}
    updates = data.get("properties", {})

    if not isinstance(updates, dict):
        return jsonify({
            "success": False,
            "message": "properties 格式錯誤"
        }), 400

    try:
        current_props = read_properties_file(SERVER_PROPERTIES_PATH)

        next_props = current_props.copy()

        for key, value in updates.items():
            if key not in DEFAULT_SERVER_PROPERTIES:
                continue

            next_props[key] = str(value)

        server_ip = (
            next_props
            .get("server-ip", "")
            .strip()
        )

        bind_ok, bind_message = (
            validate_server_bind_ip(server_ip)
        )

        if not bind_ok:
            old_server_ip = (
                current_props
                .get("server-ip", "")
                .strip()
            )

            old_ok, _ = validate_server_bind_ip(old_server_ip)

            fallback_server_ip = old_server_ip if old_ok else ""

            return jsonify({
                "success": False,
                "message": bind_message,
                "fallback": {
                    "server-ip": fallback_server_ip
                }
            }), 400

        lines = format_properties_for_write(next_props)
        write_properties_file(SERVER_PROPERTIES_PATH, lines)

        return jsonify({
            "success": True,
            "message": "設定已儲存。部分設定需要重啟伺服器後才會生效。"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@settings_bp.route("/api/server/runtime-config")
def api_get_runtime_config():
    try:
        config = load_or_create_config()

        return jsonify({
            "success": True,
            "config": {
                "java_xms": config.get("java_xms", "1G"),
                "java_xmx": config.get("java_xmx", "4G"),
                "java_executable": java_runtime.get_default_java(),

                "rcon.password": config.get("rcon_password", ""),
                "rcon.port": str(config.get("rcon_port", 25575)),
                "enable-rcon": "true",
            },
            "effective_java_executable": java_runtime.get_java_for_snapshot(),
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@settings_bp.route("/api/server/runtime-config", methods=["POST"])
def api_update_runtime_config():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify(success=False, message="請求資料格式錯誤"), 400
    updates = data.get("config", {})

    if not isinstance(updates, dict):
        return jsonify({
            "success": False,
            "message": "config 格式錯誤"
        }), 400

    try:
        changes = {}
        if "java_xms" in updates or "java_xmx" in updates:
            xms, xmx = memory_gb_pair({**load_or_create_config(), **updates})
            changes.update(java_xms=xms, java_xmx=xmx)
        if "java_executable" in updates:
            changes["java_executable"] = java_runtime.validate_default_java(updates["java_executable"])
        update_config(changes)

        return jsonify({
            "success": True,
            "message": "Java 啟動設定已儲存"
        })

    except ValueError as error:
        return jsonify(success=False, message=str(error)), 400

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@settings_bp.route("/api/server/regenerate-rcon-password", methods=["POST"])
def api_regenerate_rcon_password():
    try:
        config = load_or_create_config()

        new_password = generate_rcon_password()

        config["rcon_password"] = new_password

        save_config(config)

        return jsonify({
            "success": True,
            "password": new_password
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@settings_bp.route(
    "/api/server/regenerate-management-secret",
    methods=["POST"]
)
def api_regenerate_management_secret():
    try:
        current_props = read_properties_file(
            SERVER_PROPERTIES_PATH
        )

        new_secret = generate_management_secret()

        current_props[
            "management-server-secret"
        ] = new_secret

        lines = format_properties_for_write(
            current_props
        )

        write_properties_file(
            SERVER_PROPERTIES_PATH,
            lines
        )

        update_management_secret(new_secret)

        return jsonify({
            "success": True,
            "password": new_secret
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@settings_bp.route("/api/server/sync-rcon", methods=["POST"])
def api_sync_rcon_config():
    try:
        init_rcon_config()

        return jsonify({
            "success": True,
            "message": (
                "RCON 與 Management API 設定"
                "已同步到 server.properties"
            )
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@settings_bp.route("/api/server/effective-settings")
def api_get_effective_settings():
    try:
        snapshot = load_effective_settings_snapshot()

        return jsonify({
            "success": True,
            "snapshot": snapshot
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@settings_bp.route("/api/server/icon-preview")
def api_server_icon_preview():

    server_icon_path = MC_ROOT / "server-icon.png"

    default_icon_path = (
        STATIC_DIR
        / "icons"
        / "server_settings"
        / "default_server_icon.png"
    )

    try:

        if server_icon_path.exists():
            return send_file(
                server_icon_path,
                mimetype="image/png"
            )

        return send_file(
            default_icon_path,
            mimetype="image/png"
        )

    except Exception:
        return send_file(
            default_icon_path,
            mimetype="image/png"
        )
    

@settings_bp.route("/api/server/icon", methods=["POST"])
def api_upload_server_icon():
    upload_file = request.files.get("icon")

    if not upload_file:
        return jsonify({
            "success": False,
            "message": "沒有收到圖片檔案"
        }), 400

    try:
        with Image.open(upload_file.stream, formats=("PNG", "JPEG")) as source:
            image = source.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return jsonify({
            "success": False,
            "message": "無法讀取圖片，請選擇有效的PNG或JPG圖片。"
        }), 400

    try:

        width, height = image.size

        if width != 64 or height != 64:
            side = min(width, height)
            left = (width - side) // 2
            top = (height - side) // 2
            image = image.crop((left, top, left + side, top + side))
            image = image.resize((64, 64), Image.Resampling.LANCZOS)

        server_icon_path = MC_ROOT / "server-icon.png"
        image.save(server_icon_path, "PNG")

        return jsonify({
            "success": True,
            "message": "伺服器圖示已更新"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@settings_bp.route(
    "/api/server/effective-settings/sync",
    methods=["POST"],
)
def api_sync_effective_settings():
    try:
        status = refresh_server_status_now()
        state = status.get("state", "unknown")
        online = bool(status.get("online"))

        if online or state in {
            "ready",
            "starting",
            "stopping",
        }:
            return jsonify({
                "success": False,
                "message": "伺服器執行期間不能同步生效設定",
            }), 409

        snapshot = save_effective_settings_snapshot()

        return jsonify({
            "success": True,
            "snapshot": snapshot,
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error),
        }), 500


@settings_bp.route("/api/server/java-settings-options")
def api_java_settings_options():
    try:
        options = java_runtime.scan_java_versions()
        response = jsonify(success=True, options=options)
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception as error:
        return jsonify(success=False, message=f"掃描 Java 失敗：{error}"), 500
