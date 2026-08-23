from flask import Blueprint, jsonify

from backend.db import (
    get_recent_player_deaths_grouped
)

from backend.player_permissions.player_identity_service import (
    get_account_type,
)


death_bp = Blueprint("death", __name__)


@death_bp.route("/api/deaths")
def api_deaths():
    try:
        players = get_recent_player_deaths_grouped(
            limit_per_player=5
        )

        for player in players:
            player_uuid = str(
                player.get("player_uuid") or ""
            ).strip()

            player["account_type"] = (
                get_account_type(player_uuid)
                if player_uuid
                else "unknown"
            )

            for death in player.get("deaths", []):
                death_player_uuid = str(
                    death.get("player_uuid") or ""
                ).strip()

                killer_uuid = str(
                    death.get("killer_uuid") or ""
                ).strip()

                death["account_type"] = (
                    get_account_type(
                        death_player_uuid
                    )
                    if death_player_uuid
                    else "unknown"
                )

                death["killer_account_type"] = (
                    get_account_type(killer_uuid)
                    if killer_uuid
                    else "unknown"
                )

        return jsonify({
            "success": True,
            "players": players
        })
    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500