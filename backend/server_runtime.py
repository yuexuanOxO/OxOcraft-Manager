from __future__ import annotations

import subprocess
import threading
import json
import socket
from pathlib import Path
from backend.death_record.death_rules import parse_death_message, location_pattern
from backend.server_monitor import append_log_line, clear_log_cache
from backend.paths import SERVER_JAR_PATH, CONFIG_PATH, MC_ROOT, SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import read_properties_file
from backend.server_effective_settings import save_effective_settings_snapshot

from backend.server_status import (
    lock_current_server_port,
    lock_current_server_host,
    lock_current_rcon_settings,
)

from backend.server_config_sync import init_rcon_config

from backend.management_api.config import (
    load_management_config,
)

from backend.management_api.monitor import (
    start_management_api_monitor,
)

from backend.db import (
    insert_player_death,
    get_player_by_name_and_account_type,
    get_player_by_name_and_account_type_exact,
)


SERVER_ROOT = MC_ROOT

server_process: subprocess.Popen | None = None

# 暫存等待座標回來的死亡事件
pending_deaths: dict[str, dict] = {}

CURRENT_LEVEL_NAME: str | None = None
CURRENT_WORLD_PATH: Path | None = None

SERVER_RUNTIME_STATE = "offline"
_runtime_state_lock = threading.Lock()

# Minecraft 啟動失敗紀錄
_start_failure_lock = threading.Lock()
_last_start_failure = None


def get_server_start_failure() -> dict | None:
    with _start_failure_lock:
        return (
            dict(_last_start_failure)
            if _last_start_failure
            else None
        )


def clear_server_start_failure() -> None:
    global _last_start_failure

    with _start_failure_lock:
        _last_start_failure = None


def record_server_start_failure(
    failure: dict,
) -> None:
    global _last_start_failure

    with _start_failure_lock:
        _last_start_failure = dict(failure)


def classify_server_start_failure(
    log_lines: list[str],
    exit_code: int,
) -> dict:
    log_text = "\n".join(log_lines)

    # JSON 載入錯誤類型
    json_error_types = [
        {
            "marker": "DedicatedPlayerList.loadUserBanList",
            "error_code": "banned_players_json_invalid",
            "name": "玩家黑名單",
            "file": "banned-players.json",
        },
        {
            "marker": "DedicatedPlayerList.loadIpBanList",
            "error_code": "banned_ips_json_invalid",
            "name": "IP黑名單",
            "file": "banned-ips.json",
        },
    ]

    # 判斷是否為 JSON 解析錯誤
    has_json_error = (
        "Encountered an unexpected exception" in log_text
        and (
            "JsonSyntaxException" in log_text
            or "MalformedJsonException" in log_text
        )
    )

    if has_json_error:
        for error_type in json_error_types:
            if error_type["marker"] not in log_text:
                continue

            name = error_type["name"]
            filename = error_type["file"]

            return {
                "error_code": error_type["error_code"],
                "title": f"{name}資料錯誤",
                "message": (
                    f"Minecraft無法正確解析{filename}，"
                    "導致伺服器啟動失敗。\n"
                    f"請檢查並修正{name}資料，"
                    "再重新啟動伺服器。"
                ),
                "file": filename,
                "exit_code": exit_code,
            }

    # 無法辨識的啟動失敗
    return {
        "error_code": "server_exited_before_ready",
        "title": "伺服器啟動失敗",
        "message": (
            "Minecraft 尚未完成啟動就已停止。\n"
            f"程序退出代碼：{exit_code}\n\n"
            "目前無法確認具體原因，"
            "請查看伺服器 Log。"
        ),
        "file": None,
        "exit_code": exit_code,
    }


def resolve_death_player_uuid(
    player_name: str | None,
    account_type: str,
) -> str | None:
    player_name = str(
        player_name or ""
    ).strip()

    if not player_name:
        return None

    if account_type == "premium":
        player = get_player_by_name_and_account_type(
            player_name,
            account_type,
        )
    else:
        player = (
            get_player_by_name_and_account_type_exact(
                player_name,
                account_type,
            )
        )

    if not player:
        return None

    player_uuid = str(
        player.get("player_uuid") or ""
    ).strip()

    return player_uuid or None


def set_server_runtime_state(state: str) -> None:
    global SERVER_RUNTIME_STATE

    with _runtime_state_lock:
        SERVER_RUNTIME_STATE = state

    try:
        from backend.server_monitor import refresh_server_status_now
        refresh_server_status_now()
    except Exception:
        pass


def get_server_runtime_state() -> str:
    with _runtime_state_lock:
        return SERVER_RUNTIME_STATE


def is_server_running() -> bool:
    global server_process
    return server_process is not None and server_process.poll() is None


def send_command(cmd: str) -> None:
    global server_process

    if server_process and server_process.stdin:
        server_process.stdin.write(cmd + "\n")
        server_process.stdin.flush()


def handle_server_output() -> None:
    global server_process, pending_deaths

    process = server_process

    if not process or not process.stdout:
        return

    startup_logs = []
    reached_ready = False

    for line in process.stdout:
        line = line.strip()
        print(line)
        append_log_line(line)

        if not reached_ready:
            startup_logs.append(line)

            # 只保留啟動階段最近的 Log
            if len(startup_logs) > 300:
                startup_logs.pop(0)

        if "Done (" in line and "For help, type" in line:
            reached_ready = True
            print("[Runtime Debug] Detected server ready from log.")

            try:
                from backend.player_permissions.player_permission_service import (
                    sync_ops_json_to_players,
                )

                sync_ops_json_to_players(
                    operator_name="Unknown",
                    source="minecraft_json",
                    detail="server ready ops.json sync",
                )

                from backend.server_monitor import publish_event
                publish_event("player_permission_should_refresh", {
                    "reason": "server_ready_sync_ops_json",
                })

                print("[PlayerPermission] server ready OP sync completed")

            except Exception as error:
                print("[PlayerPermission] server ready OP sync failed:", error)

            try:
                from backend.player_ban.player_ban_service import (
                    sync_banned_json_to_db,
                    sync_removed_bans_from_json,
                )

                sync_banned_json_to_db()
                sync_removed_bans_from_json()

                from backend.server_monitor import publish_event
                publish_event("player_ban_should_refresh", {
                    "reason": "server_ready_sync_ban_json",
                })

                print("[PlayerBan] server ready sync completed")

            except Exception as error:
                print("[PlayerBan] server ready sync failed:", error)

        
        if "Query running on" in line:
            print("[Runtime Debug] Query listener ready from log.")
            try:
                from backend.server_monitor import refresh_server_status_now
                refresh_server_status_now()
            except Exception:
                pass


        death_result = parse_death_message(line)

        if death_result:
            player = death_result["player"]

            if player:
                from backend.player_permissions.player_permission_service import (
                    get_effective_online_mode,
                )

                account_type = (
                    "premium"
                    if get_effective_online_mode()
                    else "offline"
                )

                death_result["player_uuid"] = (
                    resolve_death_player_uuid(
                        player,
                        account_type,
                    )
                )

                death_result["killer_uuid"] = (
                    resolve_death_player_uuid(
                        death_result.get("killer"),
                        account_type,
                    )
                )

                pending_deaths[player] = death_result

                send_command(
                    f"data get entity "
                    f"{player} LastDeathLocation"
                )

            continue

        location_match = location_pattern.search(line)
        if location_match:
            player = location_match.group("player")

            if player not in pending_deaths:
                continue

            death_data = pending_deaths.pop(player)

            x = int(location_match.group("x"))
            y = int(location_match.group("y"))
            z = int(location_match.group("z"))
            dimension = location_match.group("dimension")

            insert_player_death(
                player_name=player,
                player_uuid=death_data.get(
                    "player_uuid"
                ),
                death_type=death_data["type"],
                death_text=death_data["death_text"],
                killer=death_data["killer"],
                killer_uuid=death_data.get(
                    "killer_uuid"
                ),
                item=death_data["item"],
                x=x,
                y=y,
                z=z,
                dimension=dimension,
                raw_log=death_data["message"],
            )

            from backend.server_monitor import publish_event

            publish_event("death_record_added", {
                "player_name": player,
                "player_uuid": death_data.get("player_uuid"),
            })


    # stdout 結束後，等待 Minecraft 程序完全退出
    exit_code = process.wait()

    # 只有尚未 Ready 就退出才記錄啟動失敗
    if (
        not reached_ready
        and get_server_runtime_state() != "stopping"
        and server_process is process
    ):
        failure = classify_server_start_failure(
            startup_logs,
            exit_code,
        )

        record_server_start_failure(failure)

        print(
            "[ServerStartup] Minecraft 啟動失敗:",
            failure["error_code"],
        )


    try:
        from backend.db import mark_all_players_offline
        mark_all_players_offline()
    except Exception as error:
        print("[PlayerIdentity] mark all offline failed:", error)

    set_server_runtime_state("offline")


def get_local_ipv4_addresses() -> set[str]:
    ips = {
        "127.0.0.1",
        "0.0.0.0",
        "localhost",
    }

    try:
        hostname = socket.gethostname()

        for item in socket.getaddrinfo(hostname, None):
            ip = item[4][0]

            if ":" not in ip:
                ips.add(ip)

    except Exception:
        pass

    return ips


def validate_server_bind_ip(server_ip: str) -> tuple[bool, str]:

    try:
        server_ip = server_ip.strip()
        if not server_ip:
            return True, ""

        if not server_ip:
            return True, ""

        local_ips = get_local_ipv4_addresses()

        if server_ip in local_ips:
            return True, ""

        available_ips = "\n".join(sorted(local_ips))

        return False, (
            "server-ip 綁定失敗!\n\n"
            "server-ip 只能填這台電腦目前擁有的 IP。\n"
            "如果不確定，建議將 server-ip 留空。\n\n"
            f"目前設定的 server-ip：\n{server_ip}\n\n"
            f"目前可用 IP：\n{available_ips}"
        )

    except Exception as error:
        return False, f"檢查 server-ip 時發生錯誤：{error}"


def start_server() -> tuple[bool, str]:
    global server_process

    if is_server_running():
        return False, "伺服器已經在執行中"

    if not SERVER_JAR_PATH.exists():
        return False, f"找不到 server.jar：{SERVER_JAR_PATH}"

    # 正式啟動 Minecraft 前，最後確認 OP 資料
    try:
        from backend.player_permissions.player_permission_service import (
            get_ops_start_block,
        )

        ops_start_block = get_ops_start_block()

        if ops_start_block:
            return False, ops_start_block["message"]

    except Exception as error:
        return False, (
            "無法完成管理員資料啟動檢查："
            f"{error}"
        )

    if SERVER_PROPERTIES_PATH.exists():
        try:
            # 正式啟動 Server 前確認管理設定已同步。
            init_rcon_config()

            management_config = load_management_config()

            start_management_api_monitor(
                host=management_config["host"],
                port=management_config["port"],
                secret=management_config["secret"],
                tls_enabled=management_config["tls_enabled"],
            )

            print(
                "[ManagementAPI] monitor ensured before server start:",
                f"host={management_config['host']}",
                f"port={management_config['port']}",
                f"tls={management_config['tls_enabled']}",
            )

        except Exception as error:
            return False, (
                "Management API 初始化失敗："
                f"{type(error).__name__}: {error}"
            )

    else:
        # Minecraft 第一次啟動時，server.properties 尚未生成。
        # 這次只啟動 server.jar，讓 Minecraft 產生必要檔案。
        print(
            "[ManagementAPI] server.properties 尚未生成，"
            "略過 Management API 初始化"
        )

    props = {}

    if SERVER_PROPERTIES_PATH.exists():
        props = read_properties_file(SERVER_PROPERTIES_PATH)

    if SERVER_PROPERTIES_PATH.exists():
        level_name = str(
            props.get(
                "level-name",
                "world",
            )
        ).strip()

        if not level_name:
            return False, (
                "目前尚未選擇世界。"
                "請先至世界管理建立新世界，"
                "或切換至現有世界後再啟動伺服器。"
            )

    server_ip = props.get("server-ip", "")

    bind_ip_ok, bind_ip_message = (
        validate_server_bind_ip(server_ip)
    )

    if not bind_ip_ok:
        return False, bind_ip_message

    clear_server_start_failure()

    set_server_runtime_state("starting")
    
    lock_current_server_port()
    lock_current_server_host()
    lock_current_rcon_settings()
    lock_current_world_path()


    command = [
        "java",
        "-jar",
        "server.jar",
        "nogui",
    ]

    try:
        clear_log_cache()
        server_process = subprocess.Popen(
            command,
            cwd=SERVER_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )

        print("[Runtime Debug] server process started:", server_process.pid)

        if SERVER_PROPERTIES_PATH.exists():
            save_effective_settings_snapshot()

        threading.Thread(target=handle_server_output, daemon=True).start()
        return True, "伺服器啟動成功"
    except Exception as error:
        set_server_runtime_state("offline")
        return False, f"伺服器啟動失敗：{error}"


def stop_server() -> tuple[bool, str]:
    global server_process

    if not is_server_running():
        return False, "伺服器未運行"

    try:
        set_server_runtime_state("stopping")
        send_command("stop")
        return True, "正在關閉伺服器"
    except Exception as error:
        return False, str(error)
    
def load_runtime_config() -> dict:
    if not CONFIG_PATH.exists():
        return {
            "java_xms": "1G",
            "java_xmx": "4G",
        }

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)
    

def lock_current_world_path() -> Path | None:
    global CURRENT_LEVEL_NAME, CURRENT_WORLD_PATH

    level_name = "world"

    try:
        if SERVER_PROPERTIES_PATH.exists():
            props = read_properties_file(
                SERVER_PROPERTIES_PATH
            )

            level_name = str(
                props.get(
                    "level-name",
                    "world",
                )
            ).strip()

    except Exception:
        level_name = "world"

    CURRENT_LEVEL_NAME = level_name

    CURRENT_WORLD_PATH = (
        MC_ROOT / level_name
        if level_name
        else None
    )

    return CURRENT_WORLD_PATH


def get_current_world_path() -> Path | None:
    # CURRENT_LEVEL_NAME 已初始化，
    # 但 CURRENT_WORLD_PATH 為 None，
    # 代表合法的「沒有選擇世界」狀態。
    if CURRENT_LEVEL_NAME is not None:
        return CURRENT_WORLD_PATH

    return lock_current_world_path()


def get_current_level_name() -> str:
    if CURRENT_LEVEL_NAME is not None:
        return CURRENT_LEVEL_NAME

    lock_current_world_path()

    return CURRENT_LEVEL_NAME or ""