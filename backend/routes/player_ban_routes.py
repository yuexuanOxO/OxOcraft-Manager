from flask import Blueprint, jsonify, request

from backend.db import get_ban_access_history

from backend.player_permissions.player_permission_service import (
    get_effective_online_mode,
)

from backend.player_ban.player_ban_service import (
    get_active_bans,
    ban_player,
    unban_player_by_uuid,
    ban_ip,
    unban_ip,
    parse_expire_payload,
    process_expired_bans,
    sync_banned_json_to_db,
    get_player_ban_candidate_list,
    get_ip_ban_candidate_list,
)

player_ban_bp = Blueprint("player_ban", __name__)


@player_ban_bp.route("/api/player/ban/players")
def api_player_ban_players():
    return jsonify({
        "success": True,
        "players": get_active_bans("player"),
        "online_mode": get_effective_online_mode(),
    })


@player_ban_bp.route("/api/player/ban/ips")
def api_player_ban_ips():
    return jsonify({
        "success": True,
        "ips": get_active_bans("ip"),
        "online_mode": get_effective_online_mode(),
    })


@player_ban_bp.route("/api/player/ban/history")
def api_player_ban_history():
    return jsonify({
        "success": True,
        "records": get_ban_access_history(),
    })


@player_ban_bp.route("/api/player/ban/player", methods=["POST"])
def api_player_ban_player():
    data = request.get_json(silent=True) or {}

    ok, expires_at, permanent, message = parse_expire_payload(data)

    if not ok:
        return jsonify({
            "success": False,
            "message": message,
        }), 400

    result = ban_player(
        player_name=data.get("name", ""),
        reason=data.get("reason", ""),
        operator=data.get("operator", "OxOcraft"),
        expires_at=expires_at,
        permanent=permanent,
        selected_from_candidate=bool(
            data.get("selected_from_candidate", False)
        ),
        candidate_uuid=data.get("uuid"),
        candidate_account_type=data.get("account_type"),
    )

    status = 200 if result.get("success") else 400
    return jsonify(result), status


@player_ban_bp.route("/api/player/ban/player/unban", methods=["POST"])
def api_player_unban_player():
    data = request.get_json(silent=True) or {}

    player_uuid = str(data.get("uuid", "")).strip()

    if not player_uuid:
        return jsonify({
            "success": False,
            "message": "缺少玩家 UUID",
        }), 400

    result = unban_player_by_uuid(
        player_uuid=player_uuid,
        operator=data.get("operator", "OxOcraft"),
    )

    status = 200 if result.get("success") else 400
    return jsonify(result), status


@player_ban_bp.route("/api/player/ban/ip", methods=["POST"])
def api_player_ban_ip():
    data = request.get_json(silent=True) or {}

    ok, expires_at, permanent, message = parse_expire_payload(data)

    if not ok:
        return jsonify({
            "success": False,
            "message": message,
        }), 400

    result = ban_ip(
        ip=data.get("ip", ""),
        reason=data.get("reason", ""),
        operator=data.get("operator", "OxOcraft"),
        expires_at=expires_at,
        permanent=permanent,
    )

    status = 200 if result.get("success") else 400
    return jsonify(result), status


@player_ban_bp.route("/api/player/ban/ip/unban", methods=["POST"])
def api_player_unban_ip():
    data = request.get_json(silent=True) or {}

    ip = str(data.get("ip", "")).strip()

    if not ip:
        return jsonify({
            "success": False,
            "message": "缺少 IP",
        }), 400

    result = unban_ip(
        ip=ip,
        operator=data.get("operator", "OxOcraft"),
    )

    status = 200 if result.get("success") else 400
    return jsonify(result), status


@player_ban_bp.route("/api/player/ban/process-expired", methods=["POST"])
def api_player_ban_process_expired():
    return jsonify({
        "success": True,
        "results": process_expired_bans(),
    })


@player_ban_bp.route("/api/player/ban/sync-json", methods=["POST"])
def api_player_ban_sync_json():
    return jsonify({
        "success": True,
        **sync_banned_json_to_db(),
    })


@player_ban_bp.route("/api/player/ban/candidates")
def api_player_ban_candidates():
    from backend.player_ban.player_ban_service import (
        can_add_ban_player_by_name
    )

    return jsonify({
        "success": True,
        "players": get_player_ban_candidate_list(),
        "can_add_by_name": can_add_ban_player_by_name(),
    })


@player_ban_bp.route(
    "/api/player/ban/ip-candidates"
)
def api_player_ban_ip_candidates():
    return jsonify({
        "success": True,
        "records": get_ip_ban_candidate_list(),
    })