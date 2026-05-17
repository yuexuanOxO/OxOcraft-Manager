from flask import Blueprint, jsonify, request

from backend.notification_service import (
    get_notifications,
    get_unread_notification_count,
    mark_all_notifications_read,
)

notification_bp = Blueprint("notification", __name__)


@notification_bp.route("/api/notifications")
def api_notifications():
    limit = request.args.get("limit", 10, type=int)
    offset = request.args.get("offset", 0, type=int)

    limit = max(1, min(limit, 50))
    offset = max(0, offset)

    return jsonify({
        "success": True,
        "notifications": get_notifications(limit=limit, offset=offset),
        "unread_count": get_unread_notification_count(),
    })


@notification_bp.route("/api/notifications/unread-count")
def api_notification_unread_count():
    return jsonify({
        "success": True,
        "unread_count": get_unread_notification_count(),
    })


@notification_bp.route("/api/notifications/mark-all-read", methods=["POST"])
def api_notifications_mark_all_read():
    mark_all_notifications_read()

    return jsonify({
        "success": True,
        "unread_count": 0,
    })