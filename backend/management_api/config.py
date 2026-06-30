from backend.paths import SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import (
    read_properties_file,
)


def load_management_config() -> dict:
    if not SERVER_PROPERTIES_PATH.exists():
        return {
            "host": "127.0.0.1",
            "port": 25585,
            "secret": "",
            "tls_enabled": False,
        }

    props = read_properties_file(
        SERVER_PROPERTIES_PATH
    )

    return {
        "host": (
            props.get(
                "management-server-host",
                "127.0.0.1",
            )
            or "127.0.0.1"
        ),
        "port": int(
            props.get(
                "management-server-port",
                25585,
            )
            or 25585
        ),
        "secret": props.get(
            "management-server-secret",
            "",
        ),
        "tls_enabled": str(
            props.get(
                "management-server-tls-enabled",
                "false",
            )
        ).lower() == "true",
    }