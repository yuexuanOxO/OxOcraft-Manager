from pathlib import Path
import subprocess
from backend.death_rules import parse_death_message,location_pattern
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent          # MineControl/
SERVER_DIR = BASE_DIR.parent                        # MinecraftServer/
SERVER_JAR = SERVER_DIR / "server.jar"              # your server file name

print("SERVER_DIR =", SERVER_DIR)
print("SERVER_JAR =", SERVER_JAR)

now = datetime.now().strftime("%H:%M:%S")

proc = subprocess.Popen(
    ["java", "-Xms2G", "-Xmx4G", "-jar", str(SERVER_JAR), "nogui"],
    cwd=str(SERVER_DIR),
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
    encoding="utf-8",
    errors="replace"
)



def send_command(cmd: str):
    if proc.stdin:
        proc.stdin.write(cmd + "\n")
        proc.stdin.flush()



print("Server starting...\n")

for line in proc.stdout:
    line = line.strip()
    print(line)

    result = parse_death_message(line)
    if result:
        print(f"[{now}] [OxO_MCServerManager DEATH DETECTED]: player: {result['player']}, killer:{result['killer']}, item:{result['item']}")
        #print("type:", result["type"])
        send_command(f"data get entity {result['player']} LastDeathLocation")#使用指令/data get entity <player> LastDeathLocation

        
            

    location_match = location_pattern.search(line)
    if location_match:
        player = location_match.group("player")
        x = int(location_match.group("x"))
        y = int(location_match.group("y"))
        z = int(location_match.group("z"))
        dimension = location_match.group("dimension")

        print(f"[{now}] [OxO_MCServerManager DEATH LOCATION DETECTED]: Player: {player} XYZ:{x}, {y}, {z} dimension:{dimension}")
        

