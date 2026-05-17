import json

from flask import Blueprint, jsonify, request, Response
from backend.notification_service import (
    get_notifications,
    get_unread_notification_count,
    mark_all_notifications_read,
    subscribe_notification_events,
    unsubscribe_notification_events,
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


@notification_bp.route("/api/notifications/events")
def api_notification_events():

    def stream():
        queue = subscribe_notification_events()

        try:
            while True:
                notification = queue.get()

                yield (
                    "event: notification\n"
                    f"data: {json.dumps(notification, ensure_ascii=False)}\n\n"
                )

        except GeneratorExit:
            unsubscribe_notification_events(queue)

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )