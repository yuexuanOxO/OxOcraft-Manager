from flask import Blueprint, jsonify

from backend.paths import LOG_FILE_PATH
from backend.log_reader import read_last_lines
from backend.server_status import is_server_online


status_bp = Blueprint("status", __name__)


@status_bp.route("/status")
def get_status():
    response = jsonify({
        "online": is_server_online()
    })
    response.headers["Cache-Control"] = "no-store"
    return response


@status_bp.route("/log")
def get_log():
    response = jsonify({
        "logs": "".join(read_last_lines(LOG_FILE_PATH, max_lines=100))
    })
    response.headers["Cache-Control"] = "no-store"
    return response