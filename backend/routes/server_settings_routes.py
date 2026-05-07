from flask import Blueprint, jsonify, request, send_file

from backend.config_files import load_or_create_config, save_config
from backend.server_config_sync import init_rcon_config
from backend.server_effective_settings import load_effective_settings_snapshot

from backend.paths import (
    SERVER_PROPERTIES_PATH,
    MC_ROOT,
    STATIC_DIR,
)

from backend.server_settings.server_properties import (
    DEFAULT_SERVER_PROPERTIES,
    read_properties_file,
    get_effective_server_properties,
    format_properties_for_write,
    write_properties_file,
    read_properties_modified_comment,
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

        for key, value in updates.items():
            if key not in DEFAULT_SERVER_PROPERTIES:
                continue

            current_props[key] = str(value)

        lines = format_properties_for_write(current_props)
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
            }
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@settings_bp.route("/api/server/runtime-config", methods=["POST"])
def api_update_runtime_config():
    data = request.get_json(silent=True) or {}
    updates = data.get("config", {})

    if not isinstance(updates, dict):
        return jsonify({
            "success": False,
            "message": "config 格式錯誤"
        }), 400

    try:
        config = load_or_create_config()

        for key in ["java_xms", "java_xmx"]:
            if key in updates:
                config[key] = str(updates[key])

        save_config(config)

        return jsonify({
            "success": True,
            "message": "啟動記憶體設定已儲存"
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
            "message": "RCON 設定已同步到 server.properties"
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