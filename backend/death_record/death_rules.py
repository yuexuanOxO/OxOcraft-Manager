import re


LOG_PREFIX = r"\]: "

PLAYER = r"(?P<player>\S+)"
KILLER = r"(?P<killer>.+?)"
ITEM = r"(?P<item>.+?)"

location_pattern = re.compile(
    r'(?P<player>\S+) has the following entity data: \{pos: \[I; (?P<x>-?\d+), (?P<y>-?\d+), (?P<z>-?\d+)\], dimension: "(?P<dimension>[^"]+)"\}'
)


def make_rule(rule_type: str, message_pattern: str):
    return {
        "type": rule_type,
        "pattern": re.compile(
            LOG_PREFIX + rf"{PLAYER} {message_pattern}$"
        )
    }


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
    "fell from a high place",
]


player_killer_messages = [
    rf"was shot by {KILLER}",
    rf"walked into a cactus while trying to escape {KILLER}",
    rf"walked into fire while fighting {KILLER}",
    rf"was squashed by {KILLER}",
    rf"was roasted in dragon's breath by {KILLER}",
    rf"drowned while trying to escape {KILLER}",
    rf"died from dehydration while trying to escape {KILLER}",
    rf"hit the ground too hard while trying to escape {KILLER}",
    rf"was blown up by {KILLER}",
    rf"was squashed by a falling anvil while fighting {KILLER}",
    rf"was squashed by a falling block while fighting {KILLER}",
    rf"was skewered by a falling stalactite while fighting {KILLER}",
    rf"was fireballed by {KILLER}",
    rf"went off with a bang while fighting {KILLER}",
    rf"experienced kinetic energy while trying to escape {KILLER}",
    rf"was frozen to death by {KILLER}",
    rf"died because of {KILLER}",
    rf"was killed while fighting {KILLER}",
    rf"walked into the danger zone due to {KILLER}",
    rf"suffocated in a wall while fighting {KILLER}",
    rf"tried to swim in lava to escape {KILLER}",
    rf"was struck by lightning while fighting {KILLER}",
    rf"was killed by {KILLER} using magic",
    rf"was killed by {KILLER}",
    rf"was killed by magic while trying to escape {KILLER}",
    rf"was slain by {KILLER}",
    rf"was smashed by {KILLER}",
    rf"didn't want to live in the same world as {KILLER}",
    rf"left the confines of this world while fighting {KILLER}",
    rf"was obliterated by a sonically-charged shriek while trying to escape {KILLER}",
    rf"was speared by {KILLER}",
    rf"was impaled on a stalagmite while fighting {KILLER}",
    rf"starved to death while fighting {KILLER}",
    rf"was stung to death by {KILLER}",
    rf"was poked to death by a sweet berry bush while trying to escape {KILLER}",
    rf"was killed while trying to hurt {KILLER}",
    rf"was pummeled by {KILLER}",
    rf"was impaled by {KILLER}",
    rf"was burned to a crisp while fighting {KILLER}",
    rf"withered away while fighting {KILLER}",
    rf"was shot by a skull from {KILLER}",
    rf"fell too far and was finished by {KILLER}",
    rf"was doomed to fall by {KILLER}",
]


player_killer_item_messages = [
    rf"was shot by {KILLER} using {ITEM}",
    rf"went off with a bang due to a firework fired from {ITEM} by {KILLER}",
    rf"was fireballed by {KILLER} using {ITEM}",
    rf"was killed by {KILLER} using {ITEM}",
    rf"was slain by {KILLER} using {ITEM}",
    rf"was blown up by {KILLER} using {ITEM}",
    rf"was smashed by {KILLER} with {ITEM}",
    rf"was speared by {KILLER} using {ITEM}",
    rf"was burned to a crisp while fighting {KILLER} wielding {ITEM}",
    rf"was obliterated by a sonically-charged shriek while trying to escape {KILLER} wielding {ITEM}",
    rf"was stung to death by {KILLER} using {ITEM}",
    rf"was killed by {ITEM} while trying to hurt {KILLER}",
    rf"was pummeled by {KILLER} using {ITEM}",
    rf"was impaled by {KILLER} with {ITEM}",
    rf"was shot by a skull from {KILLER} using {ITEM}",
    rf"fell too far and was finished by {KILLER} using {ITEM}",
    rf"was doomed to fall by {KILLER} using {ITEM}",
]


fixed_killer_messages = {
    "was obliterated by a sonically-charged shriek": "Warden",
    "was stung to death": "Bee",
}


death_rules = []

for message in player_killer_item_messages:
    death_rules.append(make_rule("player_killer_item", message))

for message in player_killer_messages:
    death_rules.append(make_rule("player_killer", message))

for message in player_only_messages:
    death_rules.append(make_rule("player_only", re.escape(message)))


def parse_death_message(line: str):
    for rule in death_rules:
        match = rule["pattern"].search(line)

        if not match:
            continue

        data = match.groupdict()

        death_text = line
        prefix_match = re.search(LOG_PREFIX + r"(?P<death_text>.+)$", line)
        if prefix_match:
            death_text = prefix_match.group("death_text")

        player = data.get("player")
        death_message = death_text

        if player and death_message.startswith(player + " "):
            death_message = death_message[len(player) + 1:]

        fixed_killer = fixed_killer_messages.get(death_message)
        killer = data.get("killer") or fixed_killer

        return {
            "type": rule["type"],
            "player": player,
            "killer": killer,
            "item": data.get("item"),
            "message": line,
            "death_text": death_text,
        }

    return None


