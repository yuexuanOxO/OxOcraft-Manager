import asyncio
import json
import websockets

WS_URL = "ws://127.0.0.1:25585"

SECRET = "Dz5cCjcoHqjNfM3YUghit0iTSVL2Jxustde7Jhkr"

async def send(ws, rpc_id, method):
    await ws.send(
        json.dumps({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": method,
        })
    )


async def main():
    headers = {
        "Authorization": f"Bearer {SECRET}"
    }

    async with websockets.connect(
        WS_URL,
        additional_headers=headers,
        ping_interval=None,
    ) as ws:
        print("Connected")

        await send(ws, 1, "minecraft:players")
        await send(ws, 2, "minecraft:server/status")
        await send(ws, 3, "minecraft:serversettings/max_players")

        while True:
            message = await ws.recv()

            print("--------------------------------")
            print(json.dumps(
                json.loads(message),
                indent=2,
                ensure_ascii=False,
            ))


asyncio.run(main())