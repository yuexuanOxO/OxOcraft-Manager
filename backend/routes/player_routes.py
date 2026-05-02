from flask import Blueprint, jsonify, request

from backend.rcon_service import send_rcon_command


player_bp = Blueprint("player", __name__)




@player_bp.route("/api/player/action", methods=["POST"])
def api_player_action():
    data = request.get_json(silent=True) or {}
    action = str(data.get("action", "")).strip()
    player = str(data.get("player", "")).strip()

    if not action or not player:
        return jsonify({
            "success": False,
            "message": "缺少必要參數"
        }), 400

    try:
        if action == "kick":
            result = send_rcon_command(f"kick {player}")
        else:
            return jsonify({
                "success": False,
                "message": "不支援的操作"
            }), 400

        return jsonify({
            "success": True,
            "result": result
        })

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500