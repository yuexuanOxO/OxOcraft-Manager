from flask import Blueprint, jsonify

from backend.db import get_recent_player_deaths


death_bp = Blueprint("death", __name__)


@death_bp.route("/api/deaths")
def api_deaths():
    try:
        deaths = get_recent_player_deaths(limit=10)
        return jsonify({
            "success": True,
            "deaths": deaths
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500