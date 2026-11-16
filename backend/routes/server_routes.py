import queue
import re
from backend import java_runtime
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
    if not isinstance(data, dict):
        return jsonify(success=False, message="請求資料格式錯誤。"), 400

    confirm_ops_error = (
        data.get("confirm_ops_error") is True
    )

    confirm_whitelist_error = (
        data.get("confirm_whitelist_error") is True
    )

    if (not isinstance(data, dict)
            or (data.get("java_candidate_id") is not None
                and not isinstance(data["java_candidate_id"], str))
            or (data.get("retry_attempt_id") is not None
                and not isinstance(data["retry_attempt_id"], str))):
        return jsonify(success=False, message="Java 選擇資料格式錯誤。"), 400

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
    before_attempt_id = java_runtime.get_attempt().get("attempt_id")
    success, message = start_server(
        allow_invalid_ops=confirm_ops_error,
        java_candidate_id=data.get("java_candidate_id"),
        retry_attempt_id=data.get("retry_attempt_id"),
    )

    attempt = java_runtime.get_attempt()
    failure = (
        get_server_start_failure()
        if not success and attempt.get("attempt_id") != before_attempt_id
        else None
    )
    return jsonify({
        "success": success,
        "message": message,
        "failure": failure,
        "attempt": attempt if success else None,
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







@server_bp.route("/api/server/java-options")
def api_java_options():
    from backend.server_runtime import can_retry_java, wait_for_start_output

    failure = get_server_start_failure()
    if not failure or not failure.get("java_retry_allowed"):
        return jsonify(success=False, message="本次錯誤不需要自動切換 Java，請查看啟動日誌。"), 409
    # 致命錯誤可能先於程序結束出現；必須等原程序及讀取執行緒結束。
    wait_for_start_output()
    if not can_retry_java():
        return jsonify(success=False, message="原 Minecraft 程序仍在執行，暫時無法更換 Java。請先確認程序已停止。"), 409
    attempt_id = failure.get("attempt_id")
    if not attempt_id or java_runtime.get_attempt().get("attempt_id") != attempt_id:
        return jsonify(success=False, message="啟動狀態已改變，請重新操作。"), 409
    try:
        options = java_runtime.scan_java_versions()
        if java_runtime.get_attempt().get("attempt_id") != attempt_id or not can_retry_java():
            return jsonify(success=False, message="啟動狀態已改變，請重新操作。"), 409
        required_java = failure.get("required_java_version")
        for option in options:
            # 同時支援 Java 8 的 1.8.0_xxx 與 17 / 25.0.x 格式。
            parts = option["version"].split(".")
            version_text = parts[1] if parts[0] == "1" and len(parts) > 1 else parts[0]
            major = re.match(r"^(\d+)", version_text)
            version = int(major.group(1)) if major else None
            option["java_major"] = version
            option["meets_java_requirement"] = (
                version >= required_java
                if version is not None and required_java is not None else None
            )
        response = jsonify(
            success=True, options=options, attempt_id=attempt_id,
            required_java_version=required_java,
            current_java_version=failure.get("current_java_version"),
        )
        response.headers["Cache-Control"] = "no-store"
        return response
    except Exception as error:
        return jsonify(success=False, message=f"掃描 Java 失敗：{error}"), 500


@server_bp.route("/api/server/java-default", methods=["POST"])
def api_java_default():
    from backend.server_runtime import is_server_running
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify(success=False, message="請求資料格式錯誤。"), 400
    if not is_server_running():
        return jsonify(success=False, message="伺服器已停止，無法確認本次啟動成功。"), 409
    try:
        path = java_runtime.save_successful_java(data.get("attempt_id"))
        return jsonify(success=True, java_path=path)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        return jsonify(success=False, message=f"儲存預設 Java 失敗：{error}"), 400

