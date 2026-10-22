import queue
from dataclasses import asdict
from backend.management_api.state import get_management_state
from backend.server_setup import get_server_setup_status
from backend.server_status import get_server_query_status
from backend.auto_backup_service import is_auto_backup_control_locked

from flask import Blueprint, jsonify, Response, request

from backend.player_permissions.player_whitelist_service import (
    get_whitelist_start_warning,
)

from backend.player_permissions.player_permission_service import (
    get_ops_start_block,
)

from backend.server_monitor import (
    refresh_server_status_now,
    get_cached_server_status,
    subscribe_events,
    unsubscribe_events,
    format_sse,
)

from backend.server_runtime import (
    start_server,
    stop_server,
    get_server_start_failure,
    get_server_start_warning,
)

server_bp = Blueprint("server", __name__)



def collect_server_start_issues() -> dict:
    from backend.player_ban.player_ban_service import (
        get_ban_start_blocks,
    )

    warnings = []

    ops_warning = get_ops_start_block()

    if ops_warning:
        warnings.append({
            "source": "ops",
            "label": "權限管理",
            "file": "ops.json",
            **ops_warning,
        })

    whitelist_warning = get_whitelist_start_warning()

    if whitelist_warning:
        warnings.append({
            "source": "whitelist",
            "label": "白名單",
            "file": "whitelist.json",
            **whitelist_warning,
        })

    return {
        "warnings": warnings,
        "blocks": get_ban_start_blocks(),
    }


def build_server_start_block_message(
    issues: dict,
) -> str:
    lines = []

    for item in (
        issues["warnings"] + issues["blocks"]
    ):
        line = (
            f"• {item['label']}"
            f"（{item['file']}）"
        )

        if item.get("reason"):
            line += f"：{item['reason']}"

        lines.append(line)

    return (
        "目前偵測到以下資料錯誤：\n"
        + "\n".join(lines)
        + "\n\n黑名單資料錯誤無法略過，"
        "請先修復黑名單檔案後再開啟伺服器。"
    )



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
            "message": "自動備份進行中，暫時無法啟動伺服器",
        }), 409

    data = request.get_json(silent=True) or {}

    confirm_ops_error = (
        data.get("confirm_ops_error") is True
    )

    confirm_whitelist_error = (
        data.get("confirm_whitelist_error") is True
    )

    # 只在準備啟動 Minecraft 時執行檢查
    try:
        issues = collect_server_start_issues()

    except Exception as error:
        return jsonify({
            "success": False,
            "message": (
                "無法完成伺服器啟動前檢查："
                f"{error}"
            ),
        }), 500

    # 黑名單錯誤不可略過
    if issues["blocks"]:
        return jsonify({
            "success": False,
            "start_blocked": True,
            "warnings": issues["warnings"],
            "blocks": issues["blocks"],
            "message":
                build_server_start_block_message(issues),
        }), 409

    # 收集尚未確認的警告
    pending_warnings = []

    for warning in issues["warnings"]:
        source = warning["source"]

        if source == "ops" and confirm_ops_error:
            continue

        if (
            source == "whitelist"
            and confirm_whitelist_error
        ):
            continue

        pending_warnings.append(warning)

    if pending_warnings:
        return jsonify({
            "success": False,
            "requires_confirmation": True,
            "warnings": pending_warnings,
        }), 409

    # 通過檢查或獲得使用者確認，才開始啟動
    success, message = start_server(
        allow_invalid_ops=confirm_ops_error
    )

    return jsonify({
        "success": success,
        "message": message,
    }), 200 if success else 400



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


@server_bp.route("/api/server/start-failure")
def api_server_start_failure():
    response = jsonify({
        "success": True,
        "failure": get_server_start_failure(),
    })

    response.headers["Cache-Control"] = "no-store"

    return response


@server_bp.route("/api/server/start-warning")
def api_server_start_warning():
    response = jsonify({
        "success": True,
        "warning": get_server_start_warning(),
    })

    response.headers["Cache-Control"] = "no-store"

    return response


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


@server_bp.route("/api/server/start-diagnostics")
def api_server_start_diagnostics():
    from backend.server_runtime import get_server_start_diagnostics

    response = jsonify({
        "success": True,
        "failure": get_server_start_diagnostics(),
    })
    response.headers["Cache-Control"] = "no-store"
    return response



