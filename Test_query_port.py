from mcstatus import JavaServer
import json

server = JavaServer.lookup("127.0.0.1:25565")

try:
    query = server.query()

    data = {
        "online": True,
        "motd": query.motd.raw,
        "map_name": query.map_name,
        "players_online": query.players.online,
        "players_max": query.players.max,
        "players": query.players.list,
        "version": query.software.version,
        "brand": query.software.brand,
        "plugins": query.software.plugins,
        "ip": query.ip,
        "port": query.port,
        "game_type": query.game_type,
        "game_id": query.game_id,
        "raw": query.raw,
    }

except Exception as e:
    data = {
        "online": False,
        "error": str(e)
    }

print(json.dumps(data, indent=4, ensure_ascii=False))