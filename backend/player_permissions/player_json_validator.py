import uuid

from backend.db import (
    get_player_by_uuid_and_name_exact,
    get_invalid_player_json_identity,
    add_invalid_player_json_identity,
    remove_invalid_player_json_identity,
)

from backend.player_permissions.player_identity_service import (
    get_offline_player_uuid,
    is_valid_minecraft_player_name,
    query_mojang_player_profile,
)


INVALID_IDENTITY_MESSAGES = {
    "missing_uuid":"缺少玩家UUID",
    "missing_name":"缺少玩家名稱",
    "invalid_uuid":"玩家UUID格式錯誤",
    "invalid_name":"玩家名稱格式錯誤",
    "identity_mismatch":"玩家名稱與UUID不符合",
    "invalid_entry": "玩家資料格式錯誤",
}


def build_validation_result(
    *,
    valid: bool,
    status: str,
    player_uuid: str,
    player_name: str,
    account_type: str | None = None,
    valid_for_current_mode: bool = False,
    error_code: str | None = None,
    verification_error_type: str | None = None,
    message: str = "",
) -> dict:
    return {
        "valid": valid,
        "status": status,
        "player_uuid": player_uuid,
        "player_name": player_name,
        "account_type": account_type,
        "valid_for_current_mode":valid_for_current_mode,
        "error_code": error_code,
        "verification_error_type":verification_error_type,
        "message": message,
    }


def is_valid_player_uuid(
    player_uuid: str,
) -> bool:
    try:
        uuid.UUID(player_uuid)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def is_account_type_valid_for_mode(
    account_type: str,
    online_mode: bool,
) -> bool:
    if online_mode:
        return account_type == "premium"

    return account_type == "offline"


def build_valid_result(
    player_uuid: str,
    player_name: str,
    account_type: str,
    online_mode: bool,
) -> dict:
    return build_validation_result(
        valid=True,
        status="valid",
        player_uuid=player_uuid,
        player_name=player_name,
        account_type=account_type,
        valid_for_current_mode=(
            is_account_type_valid_for_mode(
                account_type,
                online_mode,
            )
        ),
    )


def validate_offline_identity(
    player_uuid: str,
    player_name: str,
    online_mode: bool,
) -> dict | None:
    expected_uuid = get_offline_player_uuid(
        player_name
    )

    if expected_uuid.lower() != player_uuid.lower():
        return None

    return build_valid_result(
        player_uuid=player_uuid,
        player_name=player_name,
        account_type="offline",
        online_mode=online_mode,
    )


def validate_premium_identity(
    player_uuid: str,
    player_name: str,
    online_mode: bool,
) -> dict | None:
    result = query_mojang_player_profile(
        player_name
    )

    if result["status"] == "unavailable":
        return build_validation_result(
            valid=False,
            status="verification_unavailable",
            player_uuid=player_uuid,
            player_name=player_name,
            valid_for_current_mode=False,
            error_code="premium_verification_unavailable",
            verification_error_type=result.get(
                "error_type"
            ),
            message="目前無法驗證正版玩家資料",
        )

    if result["status"] != "found":
        return None

    profile = result["profile"]

    profile_uuid = str(profile.get("uuid", "")).strip()

    profile_name = str(profile.get("name", "")).strip()

    if (profile_uuid.lower() != player_uuid.lower()):
        return None

    if (profile_name.lower() != player_name.lower()):
        return None

    return build_valid_result(
        player_uuid=player_uuid,
        player_name=profile_name,
        account_type="premium",
        online_mode=online_mode,
    )


def validate_player_json_identity(
    player_uuid: str,
    player_name: str,
    online_mode: bool,
) -> dict:
    player_uuid = str(
        player_uuid or ""
    ).strip()

    player_name = str(
        player_name or ""
    ).strip()

    if not player_uuid:
        return build_validation_result(
            valid=False,
            status="invalid",
            player_uuid="",
            player_name=player_name,
            error_code="missing_uuid",
            message="缺少玩家 UUID",
        )

    if not player_name:
        return build_validation_result(
            valid=False,
            status="invalid",
            player_uuid=player_uuid,
            player_name="",
            error_code="missing_name",
            message="缺少玩家名稱",
        )

    if not is_valid_player_uuid(player_uuid):
        return build_validation_result(
            valid=False,
            status="invalid",
            player_uuid=player_uuid,
            player_name=player_name,
            error_code="invalid_uuid",
            message="玩家 UUID 格式錯誤",
        )

    if not is_valid_minecraft_player_name(
        player_name
    ):
        return build_validation_result(
            valid=False,
            status="invalid",
            player_uuid=player_uuid,
            player_name=player_name,
            error_code="invalid_name",
            message="玩家名稱格式錯誤",
        )

    existing_player = get_player_by_uuid_and_name_exact(
        player_uuid=player_uuid,
        player_name=player_name,
    )

    if existing_player:
        account_type = str(
            existing_player.get(
                "account_type",
                "unknown",
            )
        )

        if account_type in (
            "premium",
            "offline",
        ):
            return build_valid_result(
                player_uuid=player_uuid,
                player_name=player_name,
                account_type=account_type,
                online_mode=online_mode,
            )

    if online_mode:
        validators = (
            validate_premium_identity,
            validate_offline_identity,
        )
    else:
        validators = (
            validate_offline_identity,
            validate_premium_identity,
        )

    verification_unavailable = None

    for validator in validators:
        result = validator(
            player_uuid=player_uuid,
            player_name=player_name,
            online_mode=online_mode,
        )

        if result is None:
            continue

        if result["status"] == "valid":
            return result

        if (
            result["status"]
            == "verification_unavailable"
        ):
            verification_unavailable = result

    if verification_unavailable:
        return verification_unavailable

    return build_validation_result(
        valid=False,
        status="invalid",
        player_uuid=player_uuid,
        player_name=player_name,
        valid_for_current_mode=False,
        error_code="identity_mismatch",
        message="玩家名稱與 UUID 不符合",
    )


def validate_cached_player_json_identity(
    player_uuid: str,
    player_name: str,
    online_mode: bool,
    source: str,
) -> dict:
    player_uuid = str(
        player_uuid or ""
    ).strip()

    player_name = str(
        player_name or ""
    ).strip()

    source = str(
        source or ""
    ).strip()

    cached_invalid = (
        get_invalid_player_json_identity(
            player_uuid=player_uuid,
            player_name=player_name,
            source=source,
        )
    )

    if cached_invalid:
        error_code = (
            cached_invalid.get("error_code")
            or "identity_mismatch"
        )

        return build_validation_result(
            valid=False,
            status="invalid",
            player_uuid=player_uuid,
            player_name=player_name,
            valid_for_current_mode=False,
            error_code=error_code,
            message=INVALID_IDENTITY_MESSAGES.get(
                error_code,"玩家資料驗證失敗",
            ),
        )

    result = validate_player_json_identity(
        player_uuid=player_uuid,
        player_name=player_name,
        online_mode=online_mode,
    )

    if result["status"] == "invalid":
        add_invalid_player_json_identity(
            player_uuid=player_uuid,
            player_name=player_name,
            source=source,
            error_code=(
                result.get("error_code")
                or "identity_mismatch"
            ),
        )

    elif result["status"] == "valid":
        remove_invalid_player_json_identity(
            player_uuid=player_uuid,
            player_name=player_name,
            source=source,
        )

    return result


def validate_cached_player_json_entry(
    entry,
    online_mode: bool,
    source: str,
) -> dict:
    if not isinstance(entry, dict):
        return build_validation_result(
            valid=False,
            status="invalid",
            player_uuid="",
            player_name="",
            valid_for_current_mode=False,
            error_code="invalid_entry",
            message="玩家資料格式錯誤",
        )

    player_uuid = str(
        entry.get("uuid") or ""
    ).strip()

    player_name = str(
        entry.get("name") or ""
    ).strip()

    return validate_cached_player_json_identity(
        player_uuid=player_uuid,
        player_name=player_name,
        online_mode=online_mode,
        source=source,
    )


def validate_cached_player_json_entries(
    entries: list,
    online_mode: bool,
    source: str,
) -> dict:
    valid_entries = []
    invalid_entries = []
    unavailable_entries = []

    for entry_index, entry in enumerate(
        entries
    ):
        validation = (
            validate_cached_player_json_entry(
                entry=entry,
                online_mode=online_mode,
                source=source,
            )
        )

        item = {
            "entry_index": entry_index,
            "entry": entry,
            "validation": validation,
        }

        if validation["status"] == "valid":
            valid_entries.append(item)

        elif validation["status"] == "invalid":
            invalid_entries.append(item)

        elif (
            validation["status"]
            == "verification_unavailable"
        ):
            unavailable_entries.append(item)

    return {
        "valid": valid_entries,
        "invalid": invalid_entries,
        "verification_unavailable":
            unavailable_entries,
    }


def split_duplicate_valid_player_entries(
    valid_entries: list[dict],
) -> dict:
    unique_entries = []
    duplicate_entries = []

    seen_uuid_set = set()

    for item in valid_entries:
        validation = (
            item.get("validation")
            if isinstance(item, dict)
            else {}
        ) or {}

        player_uuid = str(
            validation.get(
                "player_uuid",
                "",
            )
        ).strip().lower()

        if not player_uuid:
            unique_entries.append(item)
            continue

        if player_uuid in seen_uuid_set:
            duplicate_entries.append(item)
            continue

        seen_uuid_set.add(player_uuid)
        unique_entries.append(item)

    return {
        "unique_entries": unique_entries,
        "duplicate_entries":
            duplicate_entries,
    }