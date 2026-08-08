from pathlib import Path
from uuid import UUID
from nbt import nbt
from tempfile import NamedTemporaryFile


GAME_MODE_NAMES = {
    0: "survival",
    1: "creative",
    2: "adventure",
    3: "spectator",
}

DIFFICULTY_NAMES = {
    0: "peaceful",
    1: "easy",
    2: "normal",
    3: "hard",
}

NBT_READ_ERRORS = (
    EOFError,
    KeyError,
    OSError,
    TypeError,
    ValueError,
    nbt.MalformedFileError,
    nbt.StructError,
)


def _empty_world_metadata() -> dict:
    return {
        "metadata_readable": False,
        "version_name": None,
        "game_mode": None,
        "difficulty": None,
        "is_hardcore": False,
        "seed": None,
        "world_type": None,
        "generate_structures": None,
        "play_time_ticks": None,
        "last_saved_at": None,
    }


def _compound_get(
    compound,
    key: str,
):
    if compound is None:
        return None

    try:
        return compound.get(key)

    except (
        AttributeError,
        KeyError,
        TypeError,
    ):
        return None


def _tag_value(
    compound,
    key: str,
):
    tag = _compound_get(
        compound,
        key,
    )

    if tag is None:
        return None

    return getattr(
        tag,
        "value",
        None,
    )


def _normalize_difficulty(
    value,
) -> str | None:
    if isinstance(value, str):
        difficulty = value.strip().casefold()

        if difficulty in {
            "peaceful",
            "easy",
            "normal",
            "hard",
        }:
            return difficulty

        return None

    try:
        return DIFFICULTY_NAMES.get(
            int(value)
        )

    except (
        TypeError,
        ValueError,
    ):
        return None


def _read_world_gen_settings(
    world_path: Path,
    level_data,
):
    # Minecraft 26.1 以前
    world_gen_settings = _compound_get(
        level_data,
        "WorldGenSettings",
    )

    if world_gen_settings is not None:
        return world_gen_settings

    # Minecraft 26.1 以後
    world_gen_path = (
        world_path
        / "data"
        / "minecraft"
        / "world_gen_settings.dat"
    )

    if not world_gen_path.is_file():
        return None

    try:
        world_gen_file = nbt.NBTFile(
            str(world_gen_path),
            "rb",
        )

    except NBT_READ_ERRORS:
        return None

    root = world_gen_file

    for root_name in (
        "data",
        "Data",
    ):
        candidate = _compound_get(
            world_gen_file,
            root_name,
        )

        if candidate is not None:
            root = candidate
            break

    for settings_name in (
        "world_gen_settings",
        "WorldGenSettings",
    ):
        candidate = _compound_get(
            root,
            settings_name,
        )

        if candidate is not None:
            return candidate

    return root


def _detect_world_type(
    world_gen_settings,
    level_data,
) -> str | None:
    dimensions = _compound_get(
        world_gen_settings,
        "dimensions",
    )

    overworld = _compound_get(
        dimensions,
        "minecraft:overworld",
    )

    generator = _compound_get(
        overworld,
        "generator",
    )

    generator_type = _tag_value(
        generator,
        "type",
    )

    generator_settings = _tag_value(
        generator,
        "settings",
    )

    generator_type_id = (
        str(generator_type).strip().casefold()
        if isinstance(generator_type, str)
        else ""
    )

    generator_settings_id = (
        str(generator_settings).strip().casefold()
        if isinstance(generator_settings, str)
        else ""
    )

    if generator_type_id in {
        "flat",
        "minecraft:flat",
    }:
        return "flat"

    if generator_type_id in {
        "debug",
        "minecraft:debug",
    }:
        return "debug"

    if generator_type_id in {
        "noise",
        "minecraft:noise",
    }:
        if generator_settings_id in {
            "minecraft:large_biomes",
            "large_biomes",
        }:
            return "large_biomes"

        if generator_settings_id in {
            "minecraft:amplified",
            "amplified",
        }:
            return "amplified"

        if generator_settings_id in {
            "minecraft:overworld",
            "overworld",
        }:
            return "default"

        return "custom"

    # 相容更舊版世界
    legacy_generator = _tag_value(
        level_data,
        "generatorName",
    )

    if not isinstance(
        legacy_generator,
        str,
    ):
        return None

    legacy_generator = (
        legacy_generator.strip().casefold()
    )

    legacy_types = {
        "default": "default",
        "flat": "flat",
        "largebiomes": "large_biomes",
        "amplified": "amplified",
        "debug_all_block_states": "debug",
    }

    return legacy_types.get(
        legacy_generator,
        "custom",
    )


def _read_optional_file(
    file_path: Path,
) -> bytes | None:
    if not file_path.exists():
        return None

    if not file_path.is_file():
        raise OSError(
            f"路徑不是檔案：{file_path}"
        )

    return file_path.read_bytes()


def _write_optional_file(
    file_path: Path,
    content: bytes | None,
) -> None:
    if content is None:
        try:
            file_path.unlink()

        except FileNotFoundError:
            pass

        return

    temporary_path = None

    try:
        with NamedTemporaryFile(
            mode="wb",
            dir=file_path.parent,
            prefix=f".{file_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_file.write(content)

            temporary_path = Path(
                temporary_file.name
            )

        temporary_path.replace(
            file_path
        )

    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()

            except FileNotFoundError:
                pass


def switch_world_icons(
    current_world_path: Path | None,
    target_world_path: Path,
    server_icon_path: Path,
) -> None:
    if (
        current_world_path is not None
        and current_world_path.resolve()
        == target_world_path.resolve()
    ):
        return

    current_world_icon_path = (
        current_world_path
        / "server-icon.png"
        if (
            current_world_path is not None
            and current_world_path.is_dir()
        )
        else None
    )

    target_world_icon_path = (
        target_world_path
        / "server-icon.png"
    )

    original_files = {
        server_icon_path:
            _read_optional_file(
                server_icon_path
            ),

        target_world_icon_path:
            _read_optional_file(
                target_world_icon_path
            ),
    }

    if current_world_icon_path is not None:
        original_files[
            current_world_icon_path
        ] = _read_optional_file(
            current_world_icon_path
        )

    try:
        current_server_icon = (
            original_files[
                server_icon_path
            ]
        )

        target_world_icon = (
            original_files[
                target_world_icon_path
            ]
        )

        # 目前世界仍存在時，
        # 才將根目錄 Icon 保存回目前世界。
        if (
            current_server_icon is not None
            and current_world_icon_path
                is not None
        ):
            _write_optional_file(
                current_world_icon_path,
                current_server_icon,
            )

        # 套用目標世界 Icon。
        #
        # 目標世界沒有保存 Icon 時，
        # 會清除根目錄可能殘留的舊 Icon。
        _write_optional_file(
            server_icon_path,
            target_world_icon,
        )

        _write_optional_file(
            target_world_icon_path,
            None,
        )

    except OSError:
        # 任一步驟失敗時，
        # 還原所有有參與操作的位置。
        for (
            file_path,
            original_content,
        ) in original_files.items():
            _write_optional_file(
                file_path,
                original_content,
            )

        raise


def count_world_players(
    world_path: Path,
) -> int | None:
    playerdata_paths = (
        # Minecraft 26.1 以後
        world_path
        / "players"
        / "data",

        # Minecraft 26.1 以前
        world_path
        / "playerdata",
    )

    player_ids = set()

    for playerdata_path in playerdata_paths:
        if not playerdata_path.is_dir():
            continue

        try:
            for player_file in (
                playerdata_path.iterdir()
            ):
                if (
                    not player_file.is_file()
                    or player_file.suffix.casefold()
                    != ".dat"
                ):
                    continue

                try:
                    player_uuid = UUID(
                        player_file.stem
                    )

                except ValueError:
                    continue

                player_ids.add(
                    player_uuid
                )

        except OSError:
            return None

    return len(player_ids)


def read_world_metadata(
    world_path: Path,
) -> dict:
    metadata = _empty_world_metadata()

    level_dat_path = (
        world_path / "level.dat"
    )

    if not level_dat_path.is_file():
        return metadata

    try:
        level_file = nbt.NBTFile(
            str(level_dat_path),
            "rb",
        )

        data = _compound_get(
            level_file,
            "Data",
        )

        if data is None:
            data = _compound_get(
                level_file,
                "data",
            )

        if data is None:
            return metadata

    except NBT_READ_ERRORS:
        return metadata

    metadata["metadata_readable"] = True

    version = _compound_get(
        data,
        "Version",
    )

    version_name = _tag_value(
        version,
        "Name",
    )

    if version_name is not None:
        metadata["version_name"] = (
            str(version_name).strip()
            or None
        )

    game_type = _tag_value(
        data,
        "GameType",
    )

    if game_type is not None:
        try:
            metadata["game_mode"] = (
                GAME_MODE_NAMES.get(
                    int(game_type),
                    "unknown",
                )
            )

        except (
            TypeError,
            ValueError,
        ):
            metadata["game_mode"] = (
                "unknown"
            )

    difficulty_settings = _compound_get(
        data,
        "difficulty_settings",
    )

    difficulty = _tag_value(
        difficulty_settings,
        "difficulty",
    )

    # 相容 26.1 以前的格式
    if difficulty is None:
        difficulty = _tag_value(
            data,
            "Difficulty",
        )

    metadata["difficulty"] = (
        _normalize_difficulty(
            difficulty
        )
    )

    hardcore = _tag_value(
        difficulty_settings,
        "hardcore",
    )

    # 相容 26.1 以前的格式
    if hardcore is None:
        hardcore = _tag_value(
            data,
            "hardcore",
        )

    if hardcore is not None:
        metadata["is_hardcore"] = bool(
            hardcore
        )


    play_time = _tag_value(
        data,
        "Time",
    )

    if play_time is not None:
        try:
            play_time_ticks = int(
                play_time
            )

            if play_time_ticks >= 0:
                metadata[
                    "play_time_ticks"
                ] = play_time_ticks

        except (
            TypeError,
            ValueError,
        ):
            pass


    last_played = _tag_value(
        data,
        "LastPlayed",
    )

    if last_played is not None:
        try:
            last_saved_at = int(
                last_played
            )

            if last_saved_at > 0:
                metadata["last_saved_at"] = (
                    last_saved_at
                )

        except (
            TypeError,
            ValueError,
        ):
            pass

    world_gen_settings = (
        _read_world_gen_settings(
            world_path,
            data,
        )
    )

    seed = _tag_value(
        world_gen_settings,
        "seed",
    )

    # 相容更舊版世界
    if seed is None:
        seed = _tag_value(
            data,
            "RandomSeed",
        )

    if seed is not None:
        # 必須轉成字串，避免 JavaScript
        # 無法精確表示 64 位元整數
        metadata["seed"] = str(seed)

    generate_structures = _tag_value(
        world_gen_settings,
        "generate_structures",
    )

    # Minecraft 26.1 以前的名稱
    if generate_structures is None:
        generate_structures = _tag_value(
            world_gen_settings,
            "generate_features",
        )

    # 相容更舊版世界
    if generate_structures is None:
        generate_structures = _tag_value(
            data,
            "MapFeatures",
        )

    if generate_structures is not None:
        metadata["generate_structures"] = (
            bool(generate_structures)
        )

    metadata["world_type"] = (
        _detect_world_type(
            world_gen_settings,
            data,
        )
    )

    return metadata