import asyncio
import json
import ssl
from datetime import datetime

import websockets


HOST = "127.0.0.1"
PORT = 25585
SECRET = "3viIjT4jkPl8iS3sb2wyhVYEYx3ZznZm3Re9A0bO"
TLS_ENABLED = False

RETRY_SECONDS = 2
OPEN_TIMEOUT_SECONDS = 5


def now():
    return datetime.now().strftime("%H:%M:%S")


async def send_rpc(ws, method, params=None, request_id=1):
    payload = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
    }

    if params is not None:
        payload["params"] = params

    await ws.send(json.dumps(payload))


async def listen_management_server():
    scheme = "wss" if TLS_ENABLED else "ws"
    url = f"{scheme}://{HOST}:{PORT}"

    ssl_context = None
    if TLS_ENABLED:
        ssl_context = ssl._create_unverified_context()

    headers = {
        "Authorization": f"Bearer {SECRET}"
    }

    print(f"[{now()}] 嘗試連線 {url}")

    async with websockets.connect(
        url,
        additional_headers=headers,
        ssl=ssl_context,
        open_timeout=OPEN_TIMEOUT_SECONDS,
        ping_interval=None,
    ) as ws:
        print(f"[{now()}] Management Server 已連線")
        print("-" * 60)

        await send_rpc(ws, "minecraft:server/status", request_id=1)

        while True:
            raw = await ws.recv()

            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                print(f"[{now()}] RAW: {raw}")
                continue

            print(f"[{now()}] MESSAGE")
            print(json.dumps(data, indent=2, ensure_ascii=False))
            print("-" * 60)


async def main():
    print("=== Management Server Port 監聽測試 ===")
    print(f"target = {HOST}:{PORT}")
    print("25585 未開啟時會持續等待；開啟後自動連線並監聽通知。")
    print("Ctrl + C 結束")
    print("-" * 60)

    while True:
        try:
            await listen_management_server()

        except ConnectionRefusedError:
            print(f"[{now()}] 25585 尚未開啟，等待中...")

        except TimeoutError:
            print(f"[{now()}] 25585 連線逾時，等待中...")

        except websockets.exceptions.InvalidStatus as error:
            print(f"[{now()}] WebSocket 狀態錯誤，可能 secret / TLS / port 設定不一致")
            print(error)

        except websockets.exceptions.InvalidHandshake as error:
            print(f"[{now()}] WebSocket 握手失敗")
            print(error)

        except websockets.exceptions.ConnectionClosed as error:
            print(f"[{now()}] Management Server 連線關閉")
            print(error)

        except OSError as error:
            print(f"[{now()}] OS 錯誤")
            print(error)

        except Exception as error:
            print(f"[{now()}] 未知錯誤：{type(error).__name__}: {error}")

        await asyncio.sleep(RETRY_SECONDS)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n測試結束")