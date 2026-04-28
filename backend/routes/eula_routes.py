from flask import Blueprint, jsonify
import threading
import os
import time

from backend.paths import EULA_PATH
from backend.config_files import read_eula_file


eula_bp = Blueprint("eula", __name__)


@eula_bp.route("/api/eula/status")
def api_eula_status():
    try:
        info = read_eula_file()

        return jsonify({
            "success": True,
            "exists": info["exists"],
            "accepted": info["accepted"],
            "url": info["url"],
            "date": info["date"],
            "message_zh": "若要繼續使用 Minecraft 伺服器，你必須同意 Minecraft 使用者授權合約（EULA）。同意後，系統會將 eula.txt 中的 eula 設為 true。"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@eula_bp.route("/api/eula/accept", methods=["POST"])
def api_eula_accept():
    try:
        info = read_eula_file()

        if not info["exists"]:
            return jsonify({
                "success": False,
                "message": "找不到 eula.txt"
            }), 404

        output_lines = []

        for line in info["raw_lines"]:
            if line.strip().lower().startswith("eula="):
                output_lines.append("eula=true")
            else:
                output_lines.append(line)

        EULA_PATH.write_text(
            "\n".join(output_lines) + "\n",
            encoding="utf-8"
        )

        return jsonify({
            "success": True,
            "message": "已同意 EULA"
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@eula_bp.route("/api/app/shutdown", methods=["POST"])
def api_app_shutdown():
    def shutdown_later():
        time.sleep(0.5)
        os._exit(0)

    threading.Thread(target=shutdown_later, daemon=True).start()

    return jsonify({
        "success": True,
        "message": "OxOcraft-Manager 即將關閉"
    })