import queue
from backend.server_runtime import start_server, stop_server
from backend.server_setup import get_server_setup_status
from backend.server_status import get_server_query_status
from flask import Blueprint, jsonify, Response
from backend.server_monitor import (
    get_cached_server_status,
    subscribe_events,
    unsubscribe_events,
    format_sse,
)

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


@server_bp.route("/api/server/query-status")
def api_server_query_status():
    response = jsonify(get_cached_server_status())
    response.headers["Cache-Control"] = "no-store"
    return response


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