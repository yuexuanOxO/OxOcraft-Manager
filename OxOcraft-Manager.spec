# -*- mode: python ; coding: utf-8 -*-
#
# OxOcraft-Manager PyInstaller spec
#
# Build:
#   pyinstaller OxOcraft-Manager.spec
#
# Notes:
# - Use onedir mode. This project has many static/templates/icon/font files.
# - server.jar is NOT bundled. Users should place server.jar beside OxOcraft-Manager.exe.
# - google_credentials.json is bundled.
# - google_token.enc is NOT bundled. It is generated per user/device after Google login.
# - backend/instance/oxocraft.db is NOT bundled. Let the app create/use its own runtime DB.

from PyInstaller.utils.hooks import collect_submodules
from pathlib import Path

block_cipher = None
static_datas = []

legacy_runtime_files = {
    "static/data/config.json",
    "static/data/server_effective_settings.json",
}

for path in Path("static").rglob("*"):
    if not path.is_file():
        continue

    if path.as_posix() in legacy_runtime_files:
        continue

    static_datas.append(
        (str(path), str(path.parent))
    )


datas = [
    ("templates", "templates"),

    # Bundle static files except per-user runtime config.
    *static_datas,

    # Bundle OAuth app credentials, but never bundle user token.
    ("backend/credentials/google_credentials.json", "backend/credentials"),
]






hiddenimports = []
hiddenimports += collect_submodules("googleapiclient")
hiddenimports += collect_submodules("google_auth_oauthlib")
hiddenimports += collect_submodules("google.oauth2")
hiddenimports += collect_submodules("mcstatus")


a = Analysis(
    ["app.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "IPython",
        "jupyter_client",
        "jupyter_core",
        "nbconvert",
        "nbformat",
        "matplotlib",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)


pyz = PYZ(
    a.pure,
    a.zipped_data,
    cipher=block_cipher,
)


exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="OxOcraft-Manager",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Keep console while testing. Change to False later for windowed release.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="static/icons/OxOcraft-Manager_icon/OxOcraft-Manager_icon_256b.ico",
)


coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="OxOcraft-Manager",
)
