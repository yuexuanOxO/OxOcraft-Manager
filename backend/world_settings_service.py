import json
from pathlib import Path
from tempfile import NamedTemporaryFile

from backend.world_service import (
    read_world_metadata,
)


WORLD_SETTINGS_FILE_NAME = (
    "oxocraft-world-settings.json"
)

WORLD_SETTINGS_SCHEMA_VERSION = 1

DEFAULT_WORLD_PROPERTIES = {
    "hardcore": False,
    "level-seed": "",
    "level-type": "minecraft:normal",
    "generator-settings": {},
    "generate-structures": True,
}

ALLOWED_WORLD_TYPES = {
    "minecraft:normal",
    "minecraft:flat",
    "minecraft:large_biomes",
    "minecraft:amplified",
    "minecraft:single_biome_surface",
}

METADATA_WORLD_TYPES = {
    "default": "minecraft:normal",
    "flat": "minecraft:flat",
    "large_biomes": "minecraft:large_biomes",
    "amplified": "minecraft:amplified",
    "single_biome_surface":
        "minecraft:single_biome_surface",
}


def _normalize_boolean(
    value,
    property_name: str,
) -> bool:
    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        normalized_value = (
            value.strip().casefold()
        )

        if normalized_value == "true":
            return True

        if normalized_value == "false":
            return False

    raise ValueError(
        f"{property_name} 必須是布林值"
    )


def _normalize_world_type(
    value,
) -> str:
    world_type = str(
        value or ""
    ).strip().replace("\\:", ":")

    if world_type not in ALLOWED_WORLD_TYPES:
        raise ValueError(
            "不支援的世界類型"
        )

    return world_type


def _normalize_generator_settings(
    value,
) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)

        except json.JSONDecodeError as error:
            raise ValueError(
                "世界生成設定不是合法 JSON"
            ) from error

    if not isinstance(value, dict):
        raise ValueError(
            "世界生成設定必須是 JSON 物件"
        )

    return value


def normalize_world_properties(
    properties,
) -> dict:
    if not isinstance(properties, dict):
        raise ValueError(
            "世界設定格式無效"
        )

    seed = str(
        properties.get(
            "level-seed",
            "",
        )
    )

    if len(seed) > 128:
        raise ValueError(
            "世界種子碼不能超過 128 個字元"
        )

    return {
        "hardcore": _normalize_boolean(
            properties.get(
                "hardcore",
                False,
            ),
            "極限模式",
        ),

        "level-seed": seed,

        "level-type": _normalize_world_type(
            properties.get(
                "level-type",
                "minecraft:normal",
            )
        ),

        "generator-settings":
            _normalize_generator_settings(
                properties.get(
                    "generator-settings",
                    {},
                )
            ),

        "generate-structures":
            _normalize_boolean(
                properties.get(
                    "generate-structures",
                    True,
                ),
                "生成結構",
            ),
    }


def _write_json_atomic(
    file_path: Path,
    data: dict,
) -> None:
    temporary_path = None

    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=file_path.parent,
            prefix=f".{file_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            json.dump(
                data,
                temporary_file,
                ensure_ascii=False,
                indent=2,
            )

            temporary_file.write("\n")

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


def save_world_properties(
    world_path: Path,
    properties,
) -> dict:
    if not world_path.is_dir():
        raise FileNotFoundError(
            f"找不到世界資料夾：{world_path}"
        )

    normalized_properties = (
        normalize_world_properties(
            properties
        )
    )

    document = {
        "schema_version":
            WORLD_SETTINGS_SCHEMA_VERSION,

        "properties":
            normalized_properties,
    }

    _write_json_atomic(
        world_path
        / WORLD_SETTINGS_FILE_NAME,

        document,
    )

    return normalized_properties


def load_world_properties(
    world_path: Path,
) -> dict:
    settings_path = (
        world_path
        / WORLD_SETTINGS_FILE_NAME
    )

    try:
        with settings_path.open(
            "r",
            encoding="utf-8",
        ) as settings_file:
            document = json.load(
                settings_file
            )

    except json.JSONDecodeError as error:
        raise ValueError(
            "世界設定 JSON 格式錯誤："
            f"{settings_path}"
        ) from error

    if not isinstance(document, dict):
        raise ValueError(
            "世界設定 JSON 格式無效"
        )

    if (
        document.get("schema_version")
        != WORLD_SETTINGS_SCHEMA_VERSION
    ):
        raise ValueError(
            "不支援的世界設定 JSON 版本"
        )

    return normalize_world_properties(
        document.get("properties")
    )


def _properties_from_server(
    server_properties: dict,
) -> dict:
    generator_settings = (
        server_properties.get(
            "generator-settings",
            "{}",
        )
    )

    try:
        generator_settings = (
            _normalize_generator_settings(
                generator_settings
            )
        )

    except ValueError:
        generator_settings = {}

    world_type = (
        server_properties.get(
            "level-type",
            "minecraft\\:normal",
        )
    )

    try:
        world_type = _normalize_world_type(
            world_type
        )

    except ValueError:
        world_type = "minecraft:normal"

    return {
        "hardcore": str(
            server_properties.get(
                "hardcore",
                "false",
            )
        ).strip().casefold() == "true",

        "level-seed": str(
            server_properties.get(
                "level-seed",
                "",
            )
        ),

        "level-type": world_type,

        "generator-settings":
            generator_settings,

        "generate-structures": str(
            server_properties.get(
                "generate-structures",
                "true",
            )
        ).strip().casefold() == "true",
    }


def build_legacy_world_properties(
    world_path: Path,
    current_server_properties:
        dict | None = None,
) -> dict:
    if current_server_properties is not None:
        properties = _properties_from_server(
            current_server_properties
        )

    else:
        properties = (
            DEFAULT_WORLD_PROPERTIES.copy()
        )

    metadata = read_world_metadata(
        world_path
    )

    if metadata.get("metadata_readable"):
        properties["hardcore"] = bool(
            metadata.get("is_hardcore")
        )

        seed = metadata.get("seed")

        if isinstance(seed, str):
            properties["level-seed"] = seed

        generate_structures = (
            metadata.get(
                "generate_structures"
            )
        )

        if isinstance(
            generate_structures,
            bool,
        ):
            properties[
                "generate-structures"
            ] = generate_structures

        metadata_world_type = (
            METADATA_WORLD_TYPES.get(
                metadata.get("world_type")
            )
        )

        if metadata_world_type is not None:
            properties[
                "level-type"
            ] = metadata_world_type

    return normalize_world_properties(
        properties
    )


def load_or_create_world_properties(
    world_path: Path,
    current_server_properties:
        dict | None = None,
) -> dict:
    settings_path = (
        world_path
        / WORLD_SETTINGS_FILE_NAME
    )

    if settings_path.is_file():
        return load_world_properties(
            world_path
        )

    properties = (
        build_legacy_world_properties(
            world_path,
            current_server_properties,
        )
    )

    return save_world_properties(
        world_path,
        properties,
    )


def apply_world_properties(
    server_properties: dict,
    world_properties: dict,
) -> dict:
    normalized_properties = (
        normalize_world_properties(
            world_properties
        )
    )

    next_properties = (
        server_properties.copy()
    )

    next_properties["hardcore"] = (
        "true"
        if normalized_properties[
            "hardcore"
        ]
        else "false"
    )

    next_properties["level-seed"] = (
        normalized_properties[
            "level-seed"
        ]
    )

    next_properties["level-type"] = (
        normalized_properties[
            "level-type"
        ].replace(":", "\\:")
    )

    next_properties[
        "generator-settings"
    ] = json.dumps(
        normalized_properties[
            "generator-settings"
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )

    next_properties[
        "generate-structures"
    ] = (
        "true"
        if normalized_properties[
            "generate-structures"
        ]
        else "false"
    )

    return next_properties