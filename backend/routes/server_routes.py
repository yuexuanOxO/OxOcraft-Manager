from flask import Blueprint, jsonify
from backend.server_runtime import start_server, stop_server
from backend.server_setup import get_server_setup_status


server_bp = Blueprint("server", __name__)


@server_bp.route("/api/server/setup-status")
def api_server_setup_status():
    return jsonify(get_server_setup_status())


@server_bp.route("/api/server/start", methods=["POST"])
def api_server_start():
    success, message = start_server()

    status_code = 200 if success else 400

    return jsonify({
        "success": success,
        "message": message
    }), status_code


@server_bp.route("/api/server/stop", methods=["POST"])
def api_server_stop():
    success, message = stop_server()

    return jsonify({
        "success": success,
        "message": message
    })