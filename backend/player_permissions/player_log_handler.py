import re
from backend.notification_service import create_notification

_pending_login_uuids: dict[str, str] = {}


def maybe_record_player_ip_from_log(
    line: str,
) -> None:
    uuid_match = re.search(
        (
            r"UUID of player\s+"
            r"(?P<player_name>.+?)\s+is\s+"
            r"(?P<player_uuid>[0-9a-fA-F-]{36})"
        ),
        line,
    )

    if uuid_match:
        player_name = (
            uuid_match
            .group("player_name")
            .strip()
        )

        player_uuid = (
            uuid_match
            .group("player_uuid")
            .strip()
        )

        if player_name and player_uuid:
            _pending_login_uuids[
                player_name
            ] = player_uuid

            print(
                "[PlayerIP] UUID cached:",
                player_name,
                player_uuid,
            )

        return

    login_match = re.search(
        (
            r"\]:\s*"
            r"(?P<player_name>.+?)"
            r"\[/"
            r"(?P<address>"
            r"\[[0-9a-fA-F:]+\]"
            r"|"
            r"[0-9a-fA-F:.]+"
            r")"
            r":(?P<port>\d+)"
            r"\]\s+logged in with entity id"
        ),
        line,
    )

    if not login_match:
        return

    player_name = (
        login_match
        .group("player_name")
        .strip()
    )

    ip = (
        login_match
        .group("address")
        .strip()
        .strip("[]")
    )

    port = (
        login_match
        .group("port")
        .strip()
    )

    player_uuid = _pending_login_uuids.pop(
        player_name,
        "",
    )

    if not player_uuid:
        try:
            from backend.player_permissions.player_identity_service import (
                resolve_player_identity,
            )

            identity = resolve_player_identity(
                player_name
            )

            player_uuid = str(
                identity.get("player_uuid")
                or ""
            ).strip()

            print(
                "[PlayerIP] UUID resolved:",
                player_name,
                player_uuid,
            )

        except Exception as error:
            print(
                "[PlayerIP] UUID resolve failed:",
                player_name,
                error,
            )
            return

    if not player_uuid or not ip:
        return

    try:
        from backend.player_permissions.player_identity_service import (
            record_player_login_from_log,
        )

        identity = record_player_login_from_log(
            player_name=player_name,
            player_uuid=player_uuid,
            ip=ip,
            port=port,
        )

        print(
            "[PlayerIP] login recorded:",
            identity,
        )

    except Exception as error:
        print(
            "[PlayerIP] login record failed:",
            error,
        )


def maybe_refresh_player_ban_from_log(line: str) -> None:
    ban_player_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Banned\s+(?P<target>[^:\]\s]+)(?::|\s|\])",
        line,
        re.IGNORECASE,
    )

    pardon_player_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*(?:Pardoned|Unbanned)\s+(?P<target>[^:\]\s]+)(?:\]|\s)",
        line,
        re.IGNORECASE,
    )

    if not ban_player_match and not pardon_player_match:
        return

    matched = ban_player_match or pardon_player_match
    log_operator = matched.group("operator").strip()
    target_name = matched.group("target").strip()

    # 避免 ban-ip / pardon-ip 被玩家 ban 流程吃到
    if target_name.lower() == "ip" or target_name.lower().startswith("ip "):
        return

    is_rcon = log_operator.lower() == "rcon"

    try:
        from backend.player_ban.player_ban_service import (
            sync_ban_player_from_log,
            sync_unban_player_from_log,
            pop_recent_ui_ban_command_if_match,
        )

        action = "add" if ban_player_match else "remove"

        is_ui_command = (
            is_rcon
            and pop_recent_ui_ban_command_if_match(
                action=action,
                player_name=target_name,
            )
        )

        if is_ui_command:
            source = "ui"
            operator_name = "OxOcraft"
        elif is_rcon:
            source = "console_rcon"
            operator_name = "Rcon"
        else:
            source = "player_command"
            operator_name = log_operator

        if ban_player_match:
            if not is_ui_command:
                sync_ban_player_from_log(
                    player_name=target_name,
                    operator_name=operator_name,
                    source=source,
                    detail=line,
                    write_history=True,
                )

                create_notification(
                    title="玩家黑名單已更新",
                    message=(
                        f"{operator_name} 已封鎖玩家 {target_name}"
                    ),
                    type="warning",
                    source="player_ban",
                )

        else:
            if not is_ui_command:
                sync_unban_player_from_log(
                    player_name=target_name,
                    operator_name=operator_name,
                    source=source,
                    detail=line,
                    write_history=True,
                )

                create_notification(
                    title="玩家黑名單已更新",
                    message=f"{operator_name} 解除了玩家 {target_name} 的封鎖",
                    type="success",
                    source="player_ban",
                )


        publish_event("player_ban_should_refresh", {
            "reason": "minecraft_ban_log",
            "line": line,
            "source": source,
        })

        print("[PlayerBan] refresh event published")

    except Exception as error:
        print("[PlayerBan] refresh from log failed:", error)


def maybe_refresh_ip_ban_from_log(line: str) -> None:
    ban_ip_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Banned\s+IP\s+(?P<ip>(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)(?::|\s|\])",
        line,
        re.IGNORECASE,
    )

    unban_ip_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*(?:Unbanned|Pardoned)\s+IP\s+(?P<ip>(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)(?:\]|\s)",
        line,
        re.IGNORECASE,
    )

    if not ban_ip_match and not unban_ip_match:
        return

    matched = ban_ip_match or unban_ip_match
    log_operator = matched.group("operator").strip()
    ip = matched.group("ip").strip()

    is_rcon = log_operator.lower() == "rcon"
    action = "add" if ban_ip_match else "remove"

    try:
        from backend.player_ban.player_ban_service import (
            pop_recent_ui_ban_command_if_match,
        )

        is_ui_command = (
            is_rcon
            and pop_recent_ui_ban_command_if_match(
                action=action,
                ip=ip,
            )
        )
    except Exception:
        is_ui_command = False

    if is_ui_command:
        source = "ui"
        operator_name = "OxOcraft"
        operator_uuid = None
    elif is_rcon:
        source = "console_rcon"
        operator_name = "Rcon"
        operator_uuid = None
    else:
        source = "player_command"
        operator_name = log_operator
        operator_uuid = None

        try:
            from backend.player_permissions.player_identity_service import (
                resolve_player_identity,
            )

            identity = resolve_player_identity(log_operator)

            if identity:
                operator_uuid = identity.get("player_uuid")

        except Exception as error:
            print("[PlayerBan] resolve ip-ban operator failed:", error)

    try:
        from backend.player_ban.player_ban_service import (
            sync_ban_ip_from_log,
            sync_unban_ip_from_log,
        )

        if not is_ui_command:
            if ban_ip_match:
                sync_ban_ip_from_log(
                    ip=ip,
                    operator_name=operator_name,
                    operator_uuid=operator_uuid,
                    source=source,
                    detail=line,
                )

                create_notification(
                    title="IP 黑名單已更新",
                    message=f"{operator_name} 封鎖了 IP {ip}",
                    type="warning",
                    source="player_ban",
                )

            else:
                sync_unban_ip_from_log(
                    ip=ip,
                    operator_name=operator_name,
                    operator_uuid=operator_uuid,
                    source=source,
                    detail=line,
                )

                create_notification(
                    title="IP 黑名單已更新",
                    message=f"{operator_name} 解除了 IP {ip} 的封鎖",
                    type="success",
                    source="player_ban",
                )


        publish_event("player_ban_should_refresh", {
            "reason": "minecraft_ip_ban_log",
            "line": line,
            "source": source,
        })

        print("[PlayerBan] IP refresh event published")

    except Exception as error:
        print("[PlayerBan] IP refresh from log failed:", error)


def maybe_refresh_player_permission_from_log(line: str) -> None:
    remove_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Made\s+(?P<target>.+?)\s+no\s+longer\s+a\s+server\s+operator\]",
        line,
        re.IGNORECASE,
    )

    add_match = None

    if not remove_match:
        add_match = re.search(
            r"\[(?P<operator>[^:\]]+):\s*Made\s+(?P<target>.+?)\s+a\s+server\s+operator\]",
            line,
            re.IGNORECASE,
        )

    if not add_match and not remove_match:
        return

    matched = remove_match or add_match

    action = "remove" if remove_match else "add"
    target_name = matched.group("target").strip()
    log_operator = matched.group("operator").strip()

    is_rcon = log_operator.lower() == "rcon"

    if is_rcon:
        source = "console_rcon"
        operator_name = "Rcon"
        operator_uuid = None
    else:
        source = "player_command"
        operator_name = log_operator
        operator_uuid = None

        try:
            from backend.player_permissions.player_identity_service import (
                resolve_player_identity,
            )

            identity = resolve_player_identity(log_operator)

            if identity:
                operator_uuid = identity.get("player_uuid")

        except Exception as error:
            print(
                "[PlayerPermission] resolve operator identity failed:",
                error,
            )

    try:
        from backend.player_permissions.player_access_history_service import (
            record_player_access,
        )

        record_player_access(
            category="op",
            action=action,
            target_name=target_name,
            operator_uuid=operator_uuid,
            operator_name=operator_name,
            source=source,
            detail=line,
        )

        if action == "add":
            message = f"{operator_name} 將 {target_name} 設為管理員"
            notification_type = "info"
        else:
            message = f"{operator_name} 收回了 {target_name} 的管理員權限"
            notification_type = "warning"

        create_notification(
            title="管理員已更新",
            message=message,
            type=notification_type,
            source="player_permission",
        )

        publish_event("player_permission_should_refresh", {
            "reason": "minecraft_op_log",
            "line": line,
            "source": source,
        })

        print("[PlayerPermission] refresh event published")

    except Exception as error:
        print("[PlayerPermission] refresh from log failed:", error)


def maybe_refresh_player_whitelist_from_log(line: str) -> None:
    remove_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Removed\s+(?P<target>.+?)\s+from\s+the\s+whitelist\]",
        line,
        re.IGNORECASE,
    )

    add_match = None

    if not remove_match:
        add_match = re.search(
            r"\[(?P<operator>[^:\]]+):\s*Added\s+(?P<target>.+?)\s+to\s+the\s+whitelist\]",
            line,
            re.IGNORECASE,
        )

    reload_match = re.search(
        r"\[(?P<operator>[^:\]]+):\s*Reloaded\s+the\s+whitelist\]",
        line,
        re.IGNORECASE,
    )

    if reload_match:
        log_operator = reload_match.group("operator").strip()
        is_rcon = log_operator.lower() == "rcon"

        try:
            from backend.player_permissions.player_whitelist_service import (
                pop_recent_ui_whitelist_reload_if_match,
                sync_whitelist_json_to_players_with_history,
            )

            is_ui_reload = (
                is_rcon
                and pop_recent_ui_whitelist_reload_if_match()
            )

            if is_ui_reload:
                source = "ui_reload"
                operator_name = "OxOcraft"
            elif is_rcon:
                source = "console_rcon_reload"
                operator_name = "Rcon"
            else:
                source = "player_command_reload"
                operator_name = log_operator

            if not is_ui_reload:
                result = sync_whitelist_json_to_players_with_history(
                    operator_name=operator_name,
                    source=source,
                    detail=line,
                )

                create_notification(
                    title="白名單已重新載入",
                    message=(
                        f"{operator_name} 重新載入白名單，"
                        f"新增 {result['added_count']} 位，"
                        f"移除 {result['removed_count']} 位"
                    ),
                    type="info",
                    source="player_whitelist",
                )

            publish_event("player_whitelist_should_refresh", {
                "reason": "minecraft_whitelist_reload_log",
                "line": line,
                "source": source,
            })

            print("[PlayerWhitelist] reload refresh event published")

        except Exception as error:
            print("[PlayerWhitelist] reload from log failed:", error)

        return

    if not add_match and not remove_match:
        return

    matched = remove_match or add_match

    action = "remove" if remove_match else "add"
    target_name = matched.group("target").strip()
    log_operator = matched.group("operator").strip()

    is_rcon = log_operator.lower() == "rcon"

    if is_rcon:
        source = "console_rcon"
        operator_name = "Rcon"
    else:
        source = "player_command"
        operator_name = log_operator

    try:
        from backend.player_permissions.player_access_history_service import (
            record_player_access,
        )

        from backend.player_permissions.player_whitelist_service import (
            sync_whitelist_json_to_players,
        )

        sync_whitelist_json_to_players(source=source)

        record_player_access(
            category="whitelist",
            action=action,
            target_name=target_name,
            operator_name=operator_name,
            source=source,
            detail=line,
        )

        if source != "ui":
            if action == "add":
                message = f"{operator_name} 將 {target_name} 加入白名單"
                notification_type = "success"
            else:
                message = f"{operator_name} 將 {target_name} 移出白名單"
                notification_type = "warning"

            create_notification(
                title="白名單已更新",
                message=message,
                type=notification_type,
                source="player_whitelist",
            )

        publish_event("player_whitelist_should_refresh", {
            "reason": "minecraft_whitelist_log",
            "line": line,
            "source": source,
        })

        print("[PlayerWhitelist] refresh event published")

    except Exception as error:
        print("[PlayerWhitelist] refresh from log failed:", error)


def handle_player_log(
    line: str,
    publish_event_func,
) -> None:
    global publish_event
    publish_event = publish_event_func

    maybe_record_player_ip_from_log(line)

    maybe_refresh_ip_ban_from_log(line)
    maybe_refresh_player_ban_from_log(line)
    maybe_refresh_player_permission_from_log(line)
    maybe_refresh_player_whitelist_from_log(line)