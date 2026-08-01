from pathlib import Path

from nbt import nbt


GAME_MODE_NAMES = {
    0: "survival",
    1: "creative",
    2: "adventure",
    3: "spectator",
}


def _empty_world_metadata() -> dict:
    return {
        "metadata_readable": False,
        "version_name": None,
        "game_mode": None,
        "is_hardcore": False,
        "last_saved_at": None,
    }


def read_world_metadata(
    world_path: Path,
) -> dict:
    metadata = _empty_world_metadata()

    level_dat_path = world_path / "level.dat"

    if not level_dat_path.is_file():
        return metadata

    try:
        level_data = nbt.NBTFile(
            str(level_dat_path),
            "rb",
        )

        data = level_data["Data"]

        metadata["metadata_readable"] = True

        version_tag = data.get("Version")
        version_name_tag = (
            version_tag.get("Name")
            if version_tag is not None
            else None
        )

        if version_name_tag is not None:
            metadata["version_name"] = (
                str(version_name_tag.value).strip()
                or None
            )

        game_type_tag = data.get("GameType")

        if game_type_tag is not None:
            game_type = int(game_type_tag.value)

            metadata["game_mode"] = (
                GAME_MODE_NAMES.get(
                    game_type,
                    "unknown",
                )
            )

        difficulty_settings_tag = data.get(
            "difficulty_settings"
        )

        hardcore_tag = (
            difficulty_settings_tag.get("hardcore")
            if difficulty_settings_tag is not None
            else None
        )

        # 相容 26.1 以前的舊世界格式
        if hardcore_tag is None:
            hardcore_tag = data.get("hardcore")

        if hardcore_tag is not None:
            metadata["is_hardcore"] = bool(
                hardcore_tag.value
            )

        last_played_tag = data.get("LastPlayed")

        if last_played_tag is not None:
            last_saved_at = int(
                last_played_tag.value
            )

            if last_saved_at > 0:
                metadata["last_saved_at"] = (
                    last_saved_at
                )

    except (
        EOFError,
        KeyError,
        OSError,
        TypeError,
        ValueError,
        nbt.MalformedFileError,
        nbt.StructError,
    ):
        return metadata

    return metadata
