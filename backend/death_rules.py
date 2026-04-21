import re


LOG_PREFIX = r"\]: "

location_pattern = re.compile(
    r'(?P<player>\S+) has the following entity data: \{pos: \[I; (?P<x>-?\d+), (?P<y>-?\d+), (?P<z>-?\d+)\], dimension: "(?P<dimension>[^"]+)"\}'
)

def build_player_only_rules(messages):
    rules = []
    for msg in messages:
        rules.append({
            "type": "player_only",
            "pattern": re.compile(
                LOG_PREFIX + rf"(?P<player>\S+) {re.escape(msg)}$"
            )
        })
    return rules


def build_player_killer_rules(messages):
    rules = []
    for msg in messages:
        rules.append({
            "type": "player_killer",
            "pattern": re.compile(
                LOG_PREFIX + rf"(?P<player>\S+) {msg}$"
            )
        })
    return rules


def build_player_killer_item_rules(messages):
    rules = []
    for msg in messages:
        rules.append({
            "type": "player_killer_item",
            "pattern": re.compile(
                LOG_PREFIX + rf"(?P<player>\S+) {msg}$"
            )
        })
    return rules


player_only_messages = [
    "was pricked to death",
    "went up in flames",
    "was squished too much",
    "was roasted in dragon's breath",
    "drowned",
    "died from dehydration",
    "hit the ground too hard",
    "blew up",
    "was squashed by a falling anvil",
    "was squashed by a falling block",
    "was skewered by a falling stalactite",
    "went off with a bang",
    "experienced kinetic energy",
    "froze to death",
    "died",
    "was killed",
    "discovered the floor was lava",
    "suffocated in a wall",
    "tried to swim in lava",
    "was struck by lightning",
    "was killed by magic",
    "burned to death",
    "fell out of the world",
    "left the confines of this world",
    "was obliterated by a sonically-charged shriek",
    "was impaled on a stalagmite",
    "starved to death",
    "was stung to death",
    "was poked to death by a sweet berry bush",
    "withered away",
    # 額外保留你原本有用到的常見 fall 訊息
    "fell from a high place",
    
]


player_killer_messages = [
    r"was shot by (?P<killer>\S+)",
    r"walked into a cactus while trying to escape (?P<killer>\S+)",
    r"walked into fire while fighting (?P<killer>\S+)",
    r"was squashed by (?P<killer>\S+)",
    r"was roasted in dragon's breath by (?P<killer>\S+)",
    r"drowned while trying to escape (?P<killer>\S+)",
    r"died from dehydration while trying to escape (?P<killer>\S+)",
    r"hit the ground too hard while trying to escape (?P<killer>\S+)",
    r"was blown up by (?P<killer>\S+)",
    r"was squashed by a falling anvil while fighting (?P<killer>\S+)",
    r"was squashed by a falling block while fighting (?P<killer>\S+)",
    r"was skewered by a falling stalactite while fighting (?P<killer>\S+)",
    r"was fireballed by (?P<killer>\S+)",
    r"went off with a bang while fighting (?P<killer>\S+)",
    r"experienced kinetic energy while trying to escape (?P<killer>\S+)",
    r"was frozen to death by (?P<killer>\S+)",
    r"died because of (?P<killer>\S+)",
    r"was killed while fighting (?P<killer>\S+)",
    r"walked into the danger zone due to (?P<killer>\S+)",
    r"suffocated in a wall while fighting (?P<killer>\S+)",
    r"was killed by (?P<killer>\S+) using magic",
    r"was killed by (?P<killer>\S+)",
    r"was killed by magic while trying to escape (?P<killer>\S+)",
    r"was slain by (?P<killer>\S+)",
    r"was smashed by (?P<killer>\S+)",
    r"didn't want to live in the same world as (?P<killer>\S+)",
    r"left the confines of this world while fighting (?P<killer>\S+)",
    r"was obliterated by a sonically-charged shriek while trying to escape (?P<killer>\S+)",
    r"was speared by (?P<killer>\S+)",
    r"was impaled on a stalagmite while fighting (?P<killer>\S+)",
    r"starved to death while fighting (?P<killer>\S+)",
    r"was stung to death by (?P<killer>\S+)",
    r"was poked to death by a sweet berry bush while trying to escape (?P<killer>\S+)",
    r"was killed while trying to hurt (?P<killer>\S+)",
    r"was pummeled by (?P<killer>\S+)",
    r"was impaled by (?P<killer>\S+)",
    r"was burned to a crisp while fighting (?P<killer>\S+)",
    r"withered away while fighting (?P<killer>\S+)",
    r"was shot by a skull from (?P<killer>\S+)",
    r"fell too far and was finished by (?P<killer>\S+)",
    # 你提供的額外句型
    r"was doomed to fall by (?P<killer>\S+)",

    
]


player_killer_item_messages = [
    r"was shot by (?P<killer>\S+) using (?P<item>.+)",
    r"went off with a bang due to a firework fired from (?P<item>.+) by (?P<killer>\S+)",
    r"was fireballed by (?P<killer>\S+) using (?P<item>.+)",
    r"was killed by (?P<killer>\S+) using (?P<item>.+)",
    r"was slain by (?P<killer>\S+) using (?P<item>.+)",
    r"was blown up by (?P<killer>\S+) using (?P<item>.+)",
    r"was smashed by (?P<killer>\S+) with (?P<item>.+)",
    r"was speared by (?P<killer>\S+) using (?P<item>.+)",
    r"was burned to a crisp while fighting (?P<killer>\S+) wielding (?P<item>.+)",
    r"was obliterated by a sonically-charged shriek while trying to escape (?P<killer>\S+) wielding (?P<item>.+)",
    r"was stung to death by (?P<killer>\S+) using (?P<item>.+)",
    r"was killed by (?P<item>.+) while trying to hurt (?P<killer>\S+)",
    r"was pummeled by (?P<killer>\S+) using (?P<item>.+)",
    r"was impaled by (?P<killer>\S+) with (?P<item>.+)",
    r"was shot by a skull from (?P<killer>\S+) using (?P<item>.+)",
    r"fell too far and was finished by (?P<killer>\S+) using (?P<item>.+)",
    # 你提供的額外句型
    r"was doomed to fall by (?P<killer>\S+) using (?P<item>.+)",
]


death_rules = []
death_rules.extend(build_player_killer_item_rules(player_killer_item_messages))
death_rules.extend(build_player_killer_rules(player_killer_messages))
death_rules.extend(build_player_only_rules(player_only_messages))


def parse_death_message(line: str):
    for rule in death_rules:
        match = rule["pattern"].search(line)
        if match:
            data = match.groupdict()

            death_text = line
            prefix_match = re.search(LOG_PREFIX + r"(?P<death_text>.+)$", line)
            if prefix_match:
                death_text = prefix_match.group("death_text")

            return {
                "type": rule["type"],
                "player": data.get("player"),
                "killer": data.get("killer"),
                "item": data.get("item"),
                "message": line,           # 原始整行 log
                "death_text": death_text,  # 純死亡句子
            }
    return None


# if __name__ == "__main__":
#     test_lines = [
#         "[14:31:09] [Server thread/INFO]: Steve drowned",
#         "[14:31:10] [Server thread/INFO]: Steve was slain by Zombie",
#         "[14:31:11] [Server thread/INFO]: Steve was slain by Zombie using Iron Sword",
#         "[14:31:12] [Server thread/INFO]: Steve went off with a bang due to a firework fired from Super Bow by Skeleton",
#         "[14:31:13] [Server thread/INFO]: Steve was doomed to fall by Zombie",
#         "[14:31:14] [Server thread/INFO]: Steve was doomed to fall by Zombie using Iron Sword",
#         "[14:31:15] [Server thread/INFO]: Steve experienced kinetic energy",
#         "[14:31:16] [Server thread/INFO]: Steve experienced kinetic energy while trying to escape Creeper",
#         "[14:31:17] [Server thread/INFO]: Steve was shot by a skull from Wither",
#         "[14:31:18] [Server thread/INFO]: Steve was shot by a skull from Wither using Dark Staff",
#         "[14:31:19] [Server thread/INFO]: Steve was killed by Diamond Sword while trying to hurt Zombie",
#         "[14:31:20] [Server thread/INFO]: Steve was impaled on a stalagmite",
#         "[14:31:21] [Server thread/INFO]: Steve was impaled on a stalagmite while fighting Zombie",
#         "[14:31:22] [Server thread/INFO]: Steve left the confines of this world",
#         "[14:31:23] [Server thread/INFO]: Steve left the confines of this world while fighting Enderman",
#         "[14:31:24] [Server thread/INFO]: Steve was obliterated by a sonically-charged shriek",
#         "[14:31:25] [Server thread/INFO]: Steve was obliterated by a sonically-charged shriek while trying to escape Warden",
#         "[14:31:26] [Server thread/INFO]: Steve was obliterated by a sonically-charged shriek while trying to escape Warden wielding Ancient Horn",
#     ]

#     for line in test_lines:
#         result = parse_death_message(line)
#         print(line)
#         print(result)
#         print("-" * 60)