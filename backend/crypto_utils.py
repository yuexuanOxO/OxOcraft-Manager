import base64
import hashlib
import platform
import getpass

from cryptography.fernet import Fernet


def generate_machine_key() -> bytes:
    raw = (
        platform.node()
        + platform.system()
        + getpass.getuser()
    ).encode("utf-8")

    digest = hashlib.sha256(raw).digest()

    return base64.urlsafe_b64encode(digest)


def get_cipher() -> Fernet:
    return Fernet(generate_machine_key())


def encrypt_text(text: str) -> bytes:
    cipher = get_cipher()
    return cipher.encrypt(text.encode("utf-8"))


def decrypt_text(data: bytes) -> str:
    cipher = get_cipher()
    return cipher.decrypt(data).decode("utf-8")