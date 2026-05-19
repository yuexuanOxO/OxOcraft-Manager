from flask import Blueprint, jsonify

from backend.db import get_recent_player_deaths_grouped


death_bp = Blueprint("death", __name__)


@death_bp.route("/api/deaths")
def api_deaths():
    try:
        players = get_recent_player_deaths_grouped(limit_per_player=5)
        return jsonify({
            "success": True,
            "players": players
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500