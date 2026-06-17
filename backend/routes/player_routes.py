import hashlib
import json
import urllib.request
import uuid

from flask import Blueprint, jsonify, request

from backend.paths import MC_ROOT, SERVER_PROPERTIES_PATH
from backend.rcon_service import send_rcon_command

from backend.player_permissions.player_identity_service import (
    delete_player_candidate,
)

from backend.player_permissions.player_permission_service import (
    get_player_permission_list,
    toggle_player_op,
    get_player_permission_candidate_list,
    can_add_op_by_name,
    is_server_ready
)

from backend.player_permissions.player_whitelist_service import (
    get_player_whitelist_list,
    get_player_whitelist_candidate_list,
    toggle_player_whitelist,
    add_player_whitelist_by_name,
    get_whitelist_settings,
    toggle_whitelist_setting,
    add_player_whitelist_direct
)



player_bp = Blueprint("player", __name__)

OPS_FILE = MC_ROOT / "ops.json"


def read_server_property(key: str, default: str = "") -> str:
    if not SERVER_PROPERTIES_PATH.exists():
        return default

    with SERVER_PROPERTIES_PATH.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()

            if not line or line.startswith("#") or "=" not in line:
                continue

            prop_key, prop_value = line.split("=", 1)

            if prop_key.strip() == key:
                return prop_value.strip()

    return default


def is_online_mode() -> bool:
    from backend.player_permissions.player_permission_service import (
        get_effective_online_mode
    )

    return get_effective_online_mode()


def get_offline_player_uuid(player_name: str) -> str:
    raw = ("OfflinePlayer:" + player_name).encode("utf-8")
    digest = bytearray(hashlib.md5(raw).digest())

    digest[6] &= 0x0f
    digest[6] |= 0x30
    digest[8] &= 0x3f
    digest[8] |= 0x80

    return str(uuid.UUID(bytes=bytes(digest)))


def get_mojang_uuid(player_name: str) -> str | None:
    url = f"https://api.mojang.com/users/profiles/minecraft/{player_name}"

    try:
        request_obj = urllib.request.Request(
            url,
            headers={"User-Agent": "OxOcraft-Manager"}
        )

        with urllib.request.urlopen(request_obj, timeout=5) as response:
            if response.status == 204:
                return None

            data = json.loads(response.read().decode("utf-8"))

        raw_uuid = data.get("id")

        if not raw_uuid:
            return None

        return str(uuid.UUID(raw_uuid))

    except Exception:
        return None


def resolve_player_uuid(player_name: str) -> str | None:
    if is_online_mode():
        return get_mojang_uuid(player_name)

    return get_offline_player_uuid(player_name)


def is_player_op(player_name: str) -> bool:
    player_uuid = resolve_player_uuid(player_name)

    if not player_uuid:
        return False

    if not OPS_FILE.exists():
        return False

    with OPS_FILE.open("r", encoding="utf-8") as file:
        ops_data = json.load(file)

    return any(
        str(entry.get("uuid", "")).lower() == player_uuid.lower()
        for entry in ops_data
    )


@player_bp.route("/api/player/action", methods=["POST"])
def api_player_action():
    data = request.get_json(silent=True) or {}
    action = str(data.get("action", "")).strip()
    player = str(data.get("player", "")).strip()

    if not action or not player:
        return jsonify({
            "success": False,
            "message": "缺少必要參數"
        }), 400

    try:
        if action == "kick":
            result = send_rcon_command(f"kick {player}")

            return jsonify({
                "success": True,
                "message": f"已踢出玩家 {player}",
                "result": result
            })

        elif action == "toggle-op":
            player_uuid = resolve_player_uuid(player)

            if not player_uuid:
                return jsonify({
                    "success": False,
                    "message": f"無法取得玩家 {player} 的 UUID，請確認網路連線或玩家名稱是否正確"
                }), 400

            if is_player_op(player):
                result = send_rcon_command(f"deop {player}")

                return jsonify({
                    "success": True,
                    "message": f"已收回 {player} 的管理員權限",
                    "result": result,
                    "op": False
                })

            result = send_rcon_command(f"op {player}")

            return jsonify({
                "success": True,
                "message": f"已將 {player} 設為管理員!",
                "result": result,
                "op": True
            })

        else:
            return jsonify({
                "success": False,
                "message": "不支援的操作"
            }), 400

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@player_bp.route("/api/player/op-status")
def api_player_op_status():
    player = str(request.args.get("player", "")).strip()

    if not player:
        return jsonify({
            "success": False,
            "message": "缺少玩家名稱"
        }), 400

    player_uuid = resolve_player_uuid(player)

    if not player_uuid:
        return jsonify({
            "success": False,
            "message": f"無法取得玩家 {player} 的 UUID"
        }), 400

    return jsonify({
        "success": True,
        "player": player,
        "uuid": player_uuid,
        "op": is_player_op(player)
    })


@player_bp.route("/api/player/permissions")
def api_player_permissions():
    from backend.server_monitor import get_cached_server_status
    from backend.player_permissions.player_permission_service import (
        get_effective_online_mode
    )

    status = get_cached_server_status()
    server_data = status.get("data", {})

    return jsonify({
        "success": True,
        "players": get_player_permission_list(),
        "online_mode": get_effective_online_mode(),
        "server_ready": is_server_ready(),
        "server_state": server_data.get("state", "offline"),
    })


@player_bp.route("/api/player/permission/toggle-op", methods=["POST"])
def api_player_permission_toggle_op():
    data = request.get_json(silent=True) or {}

    player_uuid = str(data.get("uuid", "")).strip()
    player_name = str(data.get("name", "")).strip()

    if not player_uuid or not player_name:
        return jsonify({
            "success": False,
            "message": "缺少玩家 UUID 或名稱"
        }), 400

    try:
        result = toggle_player_op(
            player_uuid=player_uuid,
            player_name=player_name,
        )

        return jsonify(result)

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@player_bp.route("/api/player/permission/add-op", methods=["POST"])
def api_player_permission_add_op():
    data = request.get_json(silent=True) or {}

    player_name = str(data.get("name", "")).strip()

    if not player_name:
        return jsonify({
            "success": False,
            "message": "請輸入玩家名稱"
        }), 400

    if not can_add_op_by_name():
        return jsonify({
            "success": False,
            "message": "離線模式且伺服器在線時，不能手動輸入玩家名稱新增 OP。請先讓玩家進入伺服器一次，再從「之前加入過的玩家」清單加入。"
        }), 400

    player_uuid = resolve_player_uuid(player_name)

    if not player_uuid:
        return jsonify({
            "success": False,
            "message": f"無法取得玩家 {player_name} 的 UUID，請確認玩家名稱或網路連線"
        }), 400

    try:
        from backend.player_permissions.player_permission_service import set_player_op

        result = set_player_op(
            player_uuid=player_uuid,
            player_name=player_name,
        )

        return jsonify(result)

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@player_bp.route("/api/player/whitelist")
def api_player_whitelist():
    from backend.player_permissions.player_permission_service import (
        get_effective_online_mode
    )

    return jsonify({
        "success": True,
        "players": get_player_whitelist_list(),
        "online_mode": get_effective_online_mode(),
    })


@player_bp.route("/api/player/whitelist/toggle", methods=["POST"])
def api_player_whitelist_toggle():
    data = request.get_json(silent=True) or {}

    player_uuid = str(data.get("uuid", "")).strip()
    player_name = str(data.get("name", "")).strip()

    if not player_uuid or not player_name:
        return jsonify({
            "success": False,
            "message": "缺少玩家 UUID 或名稱"
        }), 400

    try:
        result = toggle_player_whitelist(
            player_uuid=player_uuid,
            player_name=player_name,
        )

        return jsonify(result)

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@player_bp.route("/api/player/whitelist/candidates")
def api_player_whitelist_candidates():
    return jsonify({
        "success": True,
        "players": get_player_whitelist_candidate_list(),
    })


@player_bp.route("/api/player/whitelist/add", methods=["POST"])
def api_player_whitelist_add():
    data = request.get_json(silent=True) or {}

    player_name = str(data.get("name", "")).strip()

    if not player_name:
        return jsonify({
            "success": False,
            "message": "請輸入玩家名稱"
        }), 400

    try:
        result = add_player_whitelist_by_name(player_name)
        status = 200 if result.get("success") else 400
        return jsonify(result), status

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@player_bp.route("/api/player/whitelist/settings")
def api_player_whitelist_settings():
    return jsonify({
        "success": True,
        **get_whitelist_settings(),
    })


@player_bp.route("/api/player/whitelist/settings/toggle", methods=["POST"])
def api_player_whitelist_settings_toggle():
    data = request.get_json(silent=True) or {}
    key = str(data.get("key", "")).strip()

    try:
        result = toggle_whitelist_setting(key)
        status = 200 if result.get("success") else 400
        return jsonify(result), status

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@player_bp.route("/api/player/permissions/candidates")
def api_player_permission_candidates():
    return jsonify({
        "success": True,
        "players": get_player_permission_candidate_list(),
    })


@player_bp.route(
    "/api/player/candidate/delete",
    methods=["POST"]
)
def api_player_candidate_delete():
    data = request.get_json(silent=True) or {}

    player_uuid = str(data.get("uuid", "")).strip()
    player_name = str(data.get("name", "")).strip()

    if not player_uuid or not player_name:
        return jsonify({
            "success": False,
            "message": "缺少玩家 UUID 或名稱"
        }), 400

    try:
        result = delete_player_candidate(
            player_uuid=player_uuid,
            player_name=player_name,
        )

        status = 200 if result.get("success") else 400
        return jsonify(result), status

    except Exception as error:
        return jsonify({
            "success": False,
            "message": str(error)
        }), 500


@player_bp.route(
    "/api/player/whitelist/add-candidate",
    methods=["POST"]
)
def api_player_whitelist_add_candidate():

    data = request.get_json(silent=True) or {}

    player_uuid = str(
        data.get("uuid", "")
    ).strip()

    player_name = str(
        data.get("name", "")
    ).strip()

    if not player_uuid or not player_name:
        return jsonify({
            "success": False,
            "message": "缺少玩家 UUID 或名稱"
        }), 400

    try:

        result = add_player_whitelist_direct(
            player_uuid=player_uuid,
            player_name=player_name,
        )

        status = 200 if result.get("success") else 400

        return jsonify(result), status

    except Exception as error:

        return jsonify({
            "success": False,
            "message": str(error)
        }), 500
    

@player_bp.route("/api/player/avatar")
def api_player_avatar():
    player_name = str(request.args.get("player", "")).strip()

    if not player_name:
        return jsonify({
            "success": False,
            "message": "缺少玩家名稱"
        }), 400

    if is_online_mode():
        avatar_url = (
            "https://mc-heads.net/avatar/"
            f"{player_name}"
        )
    else:
        from backend.server_status import (
            get_offline_default_skin_avatar_url
        )

        avatar_url = get_offline_default_skin_avatar_url(player_name)

    return jsonify({
        "success": True,
        "player": player_name,
        "avatar_url": avatar_url,
    })