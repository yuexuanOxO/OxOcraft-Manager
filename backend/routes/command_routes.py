from flask import Blueprint, jsonify, request

from backend.rcon_service import send_rcon_command


command_bp = Blueprint("command", __name__)


@command_bp.route("/api/rcon/test")
def rcon_test():
    try:
        result = send_rcon_command("list")
        return jsonify({
            "success": True,
            "message": "RCON 連線成功",
            "result": result,
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": f"RCON 連線失敗：{error}",
        }), 500


@command_bp.route("/api/command", methods=["POST"])
def api_command():
    from backend.server_status import get_server_query_status
    if get_server_query_status().get("state") == "external":
        return jsonify(success=False, message="伺服器由其他方式啟動，無法透過 OxOcraft-Manager 傳送指令。"), 409
    data = request.get_json(silent=True) or {}
    command = str(data.get("command", "")).strip()

    if not command:
        return jsonify({
            "success": False,
            "message": "指令不可為空",
        }), 400

    try:
        result = send_rcon_command(command)
        return jsonify({
            "success": True,
            "result": result,
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error),
        }), 500
