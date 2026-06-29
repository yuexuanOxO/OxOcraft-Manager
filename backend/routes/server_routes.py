import queue
from dataclasses import asdict
from backend.management_api.state import get_management_state
from backend.server_runtime import start_server, stop_server
from backend.server_setup import get_server_setup_status
from backend.server_status import get_server_query_status
from backend.auto_backup_service import is_auto_backup_control_locked

from flask import Blueprint, jsonify, Response, request
from backend.server_monitor import (
    refresh_server_status_now,
    get_cached_server_status,
    subscribe_events,
    unsubscribe_events,
    format_sse,
)

server_bp = Blueprint("server", __name__)


def build_server_status_response():
    force = request.args.get("force") == "1"

    if force:
        payload = refresh_server_status_now()
    else:
        payload = get_cached_server_status()

    response = jsonify(payload)
    response.headers["Cache-Control"] = "no-store"

    return response


@server_bp.route("/api/server/setup-status")
def api_server_setup_status():
    return jsonify(get_server_setup_status())


@server_bp.route("/api/server/start", methods=["POST"])
def api_server_start():

    if is_auto_backup_control_locked():
        return jsonify({
            "success": False,
            "message": "自動備份進行中，暫時無法啟動伺服器"
        }), 409

    success, message = start_server()

    status_code = 200 if success else 400

    return jsonify({
        "success": success,
        "message": message
    }), status_code


@server_bp.route("/api/server/stop", methods=["POST"])
def api_server_stop():

    if is_auto_backup_control_locked():
        return jsonify({
            "success": False,
            "message": "自動備份進行中，暫時無法關閉伺服器"
        }), 409

    success, message = stop_server()

    return jsonify({
        "success": success,
        "message": message
    })


@server_bp.route("/api/server/status")
def api_server_status():
    return build_server_status_response()


@server_bp.route("/api/server/query-status")
def api_server_query_status():
    return build_server_status_response()


@server_bp.route("/api/events")
def api_events():
    q = subscribe_events()

    def stream():
        try:
            # 初始資料
            yield format_sse("server_status_changed", get_cached_server_status())

            while True:
                try:
                    # 最多等15秒
                    event = q.get(timeout=15)

                    yield format_sse(
                        event["type"],
                        event["data"]
                    )

                except queue.Empty:
                    # heartbeat，避免連線閒置被斷
                    yield ": keep-alive\n\n"

        except GeneratorExit:
            pass

        finally:
            unsubscribe_events(q)

    response = Response(stream(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"

    return response


@server_bp.route("/api/server/management-status")
def api_server_management_status():
    state = get_management_state()

    response = jsonify({
        "success": True,
        "management": asdict(state),
    })
    response.headers["Cache-Control"] = "no-store"

    return response
