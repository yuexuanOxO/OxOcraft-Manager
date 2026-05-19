from pathlib import Path
from zipfile import ZipFile
import shutil


DATAPACK_FOLDER_NAME = "OxOcraft-Manager"

CORE_ZIP = "OxOcraft-Core.zip"
DEATH_RECORD_ZIP = "OxOcraft-DeathRecord.zip"


class DatapackInstallError(Exception):
    pass


def get_assets_dir() -> Path:
    return Path(__file__).resolve().parent / "assets"


def get_core_zip_path() -> Path:
    path = get_assets_dir() / "core" / CORE_ZIP
    if not path.exists():
        raise DatapackInstallError(f"找不到資料包核心檔案：{path}")
    return path


def get_module_zip_path(module_name: str) -> Path:
    if module_name == "death_record":
        path = get_assets_dir() / "modules" / DEATH_RECORD_ZIP
    else:
        raise DatapackInstallError(f"未知的資料包模組：{module_name}")

    if not path.exists():
        raise DatapackInstallError(f"找不到資料包模組檔案：{path}")

    return path


def get_world_datapacks_dir(world_path: str | Path) -> Path:
    world_path = Path(world_path)
    return world_path / "datapacks"


def get_oxocraft_datapack_dir(world_path: str | Path) -> Path:
    return get_world_datapacks_dir(world_path) / DATAPACK_FOLDER_NAME


def is_core_installed(world_path: str | Path) -> bool:
    datapack_dir = get_oxocraft_datapack_dir(world_path)
    return (
        datapack_dir.exists()
        and (datapack_dir / "pack.mcmeta").exists()
        and (datapack_dir / "data").exists()
    )


def ensure_datapack_dir(world_path: str | Path) -> Path:
    datapacks_dir = get_world_datapacks_dir(world_path)
    datapacks_dir.mkdir(parents=True, exist_ok=True)

    oxocraft_dir = get_oxocraft_datapack_dir(world_path)
    oxocraft_dir.mkdir(parents=True, exist_ok=True)

    return oxocraft_dir


def extract_zip_to_dir(zip_path: Path, target_dir: Path) -> None:
    with ZipFile(zip_path, "r") as zip_file:
        zip_file.extractall(target_dir)


def install_core(world_path: str | Path, overwrite: bool = False) -> dict:
    target_dir = get_oxocraft_datapack_dir(world_path)

    if target_dir.exists() and overwrite:
        shutil.rmtree(target_dir)

    ensure_datapack_dir(world_path)

    if is_core_installed(world_path) and not overwrite:
        return {
            "ok": True,
            "installed": False,
            "message": "OxOcraft-Manager 資料包核心已存在",
            "path": str(target_dir),
        }

    extract_zip_to_dir(get_core_zip_path(), target_dir)

    if not is_core_installed(world_path):
        raise DatapackInstallError("資料包核心安裝後驗證失敗")

    return {
        "ok": True,
        "installed": True,
        "message": "OxOcraft-Manager 資料包核心安裝完成",
        "path": str(target_dir),
    }


def install_module(world_path: str | Path, module_name: str) -> dict:
    if not is_core_installed(world_path):
        install_core(world_path)

    target_dir = get_oxocraft_datapack_dir(world_path)
    module_zip = get_module_zip_path(module_name)

    extract_zip_to_dir(module_zip, target_dir)

    return {
        "ok": True,
        "installed": True,
        "module": module_name,
        "message": f"資料包模組安裝完成：{module_name}",
        "path": str(target_dir),
    }


def install_death_record_datapack(world_path: str | Path) -> dict:
    core_result = install_core(world_path)
    module_result = install_module(world_path, "death_record")

    return {
        "ok": True,
        "world_path": str(Path(world_path)),
        "datapack_path": str(get_oxocraft_datapack_dir(world_path)),
        "core": core_result,
        "module": module_result,
        "message": "死亡紀錄資料包安裝完成",
    }


def get_expected_datapack_name() -> str:
    return f"file/{DATAPACK_FOLDER_NAME}"