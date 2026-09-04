"""Role metadata, dealing, and knowledge computation.

NOTE on Tristan & Iseult: this is the classic "Lovers" variant where both
are Loyal Servants of Arthur who are told each other's identity at the
start of the game (but not their own or each other's alignment beyond
"good", since here they are always good). It's one of a few documented fan
variants of this pair -- see README for the design note and how you'd swap
in a different interpretation.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from .config import MISSION_CONFIG


class GameError(Exception):
    """Raised for any invalid player action or lobby configuration; the message is shown to the player."""


# Every character this build supports. `optional` roles are toggled by the
# host in the lobby; the two base roles (LOYAL_SERVANT / MINION) silently
# fill whatever slots are left over.
ROLES: dict[str, dict[str, Any]] = {
    "MERLIN": {
        "id": "MERLIN",
        "name": "Merlin",
        "team": "good",
        "optional": True,
        "description": "Knows the identities of all Evil players (except Mordred, if he is in play). Stay subtle — the Assassin wins the game by identifying you at the end.",
    },
    "PERCIVAL": {
        "id": "PERCIVAL",
        "name": "Percival",
        "team": "good",
        "optional": True,
        "description": "Knows who Merlin is. If Morgana is in play, Percival instead sees two candidates and must work out which is which.",
    },
    "TRISTAN": {
        "id": "TRISTAN",
        "name": "Tristan",
        "team": "good",
        "optional": True,
        "description": "A Loyal Servant of Arthur who knows the identity of Iseult, their beloved.",
    },
    "ISEULT": {
        "id": "ISEULT",
        "name": "Iseult",
        "team": "good",
        "optional": False,  # always paired with Tristan, never toggled independently
        "description": "A Loyal Servant of Arthur who knows the identity of Tristan, their beloved.",
    },
    "LOYAL_SERVANT": {
        "id": "LOYAL_SERVANT",
        "name": "Loyal Servant of Arthur",
        "team": "good",
        "optional": False,
        "description": "A plain member of Arthur’s court. No special knowledge — vote wisely and watch the table.",
    },
    "MORGANA": {
        "id": "MORGANA",
        "name": "Morgana",
        "team": "evil",
        "optional": True,
        "description": "Appears to Percival as a possible Merlin, muddying the water.",
    },
    "MORDRED": {
        "id": "MORDRED",
        "name": "Mordred",
        "team": "evil",
        "optional": True,
        "description": "Hidden from Merlin — Merlin does not see you as Evil.",
    },
    "OBERON": {
        "id": "OBERON",
        "name": "Oberon",
        "team": "evil",
        "optional": True,
        "description": "Does not know the other Evil players, and they do not know you. You are on your own.",
    },
    "ASSASSIN": {
        "id": "ASSASSIN",
        "name": "Assassin",
        "team": "evil",
        "optional": True,
        "description": "If Good wins three missions, you get one shot at identifying Merlin. Guess correctly and Evil steals the win.",
    },
    "AGRAVAIN": {
        "id": "AGRAVAIN",
        "name": "Agravain",
        "team": "evil",
        "optional": True,
        "description": "A zealous Minion of Mordred — you must play Fail on every quest you’re sent on. No choice, no bluffing.",
    },
    "ARTHUR": {
        "id": "ARTHUR",
        "name": "Arthur",
        "team": "good",
        "optional": True,
        "description": "Once two quests have failed, you may publicly reveal yourself as Arthur to rally Good — at the cost of painting a target on your back.",
    },
    "GAWAIN": {
        "id": "GAWAIN",
        "name": "Gawain",
        "team": "good",
        "optional": True,
        "description": "A plain Loyal knight with no special knowledge — but if the Assassin mistakes you for Merlin, you win the game for yourself, not Good or Evil.",
    },
    "LANCELOT": {
        "id": "LANCELOT",
        "name": "Lancelot",
        "team": "good",
        "optional": True,
        "description": "If Merlin is in play, appears to him as Evil, a built-in red herring — otherwise this passes quietly. Holds a single Reverse card — while on a quest, may play it instead of Success to flip that quest’s outcome.",
    },
    "LANCELOT_GOOD": {
        "id": "LANCELOT_GOOD",
        "name": "Lancelot",
        "team": "good",
        "optional": True,
        "description": "One of a pair of Lancelots, starting Good. Unlike solo Lancelot, does not appear Evil to Merlin — only your Evil counterpart does. At a random, secret point in the game the two Lancelots swap allegiance for the rest of the game.",
    },
    "LANCELOT_EVIL": {
        "id": "LANCELOT_EVIL",
        "name": "Lancelot",
        "team": "evil",
        "optional": True,
        "description": "One of a pair of Lancelots, starting Evil. If Merlin is in play he sees you as Evil, same as any other Evil player — your Good counterpart is not shown to him. At a random, secret point in the game the two Lancelots swap allegiance for the rest of the game.",
    },
    "GUINEVERE": {
        "id": "GUINEVERE",
        "name": "Guinevere",
        "team": "good",
        "optional": True,
        "description": "Knows the identities of both Lancelots, but never which one is currently Good or Evil. Requires the Good & Evil Lancelot pair.",
    },
    "MINION": {
        "id": "MINION",
        "name": "Minion of Mordred",
        "team": "evil",
        "optional": False,
        "description": "A plain servant of Evil. Knows its fellow Minions (except Oberon) — sabotage missions without getting caught.",
    },
}

# Roles the lobby UI can toggle on/off. Order matters for display.
TOGGLEABLE_ROLES = [
    "MERLIN", "PERCIVAL", "MORGANA", "MORDRED", "OBERON", "ASSASSIN", "AGRAVAIN", "ARTHUR", "GAWAIN", "TRISTAN",
]


def default_settings() -> dict[str, bool]:
    return {
        "merlin": True,
        "percival": True,
        "morgana": True,
        "mordred": False,
        "oberon": False,
        "assassin": True,
        "agravain": False,
        "arthur": False,
        "gawain": False,
        "tristanIseult": False,
        "lancelot": False,
        "lancelotPair": False,
        "guinevere": False,
        # Extensions — game-flow modifiers rather than characters, so they
        # don't consume a good/evil slot the way the roles above do.
        "ladyOfLake": False,
        "excalibur": False,
    }


# Characters that only make sense once another one is already in play --
# same relationships validate_settings checks below, just phrased as "what
# this needs" so Room.update_settings can also use it to auto-clear a
# toggle the instant its dependency goes away, instead of leaving a stale,
# invalid combination sitting there until the host notices the error list.
# `any: True` means only one of `requires` need be on (the Assassin just
# needs *a* target, not all three). Lancelot/lancelotPair aren't here --
# they don't require Merlin (see validate_settings' comment on that).
ROLE_DEPENDENCIES: dict[str, dict[str, Any]] = {
    "percival": {"requires": ["merlin"]},
    "morgana": {"requires": ["percival"]},
    "mordred": {"requires": ["merlin"]},
    "guinevere": {"requires": ["lancelotPair"]},
    "assassin": {"requires": ["merlin", "gawain", "tristanIseult"], "any": True},
}


def cascade_deselect(settings: dict[str, bool]) -> dict[str, bool]:
    """Clears any toggle whose ROLE_DEPENDENCIES requirement is no longer
    satisfied, repeating until stable so a chain -- Merlin off should take
    Percival off, which should then take Morgana off too -- fully unwinds
    in one call rather than leaving the host to notice and clear each link
    by hand. Never touches a toggle whose dependency is still satisfied."""
    settings = dict(settings)
    changed = True
    while changed:
        changed = False
        for key, dep in ROLE_DEPENDENCIES.items():
            if not settings.get(key):
                continue
            requires = dep["requires"]
            satisfied = any(settings.get(r) for r in requires) if dep.get("any") else all(settings.get(r) for r in requires)
            if not satisfied:
                settings[key] = False
                changed = True
    return settings


def validate_settings(player_count: int, settings: dict[str, bool]) -> list[str]:
    """Cross-role dependency + capacity checks. Returns human-readable errors (empty = valid)."""
    errors: list[str] = []
    cfg = MISSION_CONFIG.get(player_count)
    if not cfg:
        errors.append(f"Player count must be between 5 and 10 (got {player_count}).")
        return errors

    if settings.get("assassin") and not (settings.get("merlin") or settings.get("gawain") or settings.get("tristanIseult")):
        errors.append(
            "The Assassin needs at least one valid target in play: Merlin, Gawain, or the Tristan & Iseult pair."
        )
    if settings.get("percival") and not settings.get("merlin"):
        errors.append("Percival requires Merlin to be in play.")
    if settings.get("morgana") and not settings.get("percival"):
        errors.append("Morgana requires Percival to be in play (otherwise she has nothing to fool).")
    if settings.get("mordred") and not settings.get("merlin"):
        errors.append("Mordred requires Merlin to be in play (otherwise there is nothing to hide from).")
    # Lancelot (solo or the pair) does NOT require Merlin -- unlike
    # Percival/Morgana/Mordred, whose entire mechanic is about what Merlin
    # sees, a Lancelot's Reverse card and allegiance swap both work fine
    # with no Merlin at the table. Merlin being in play just adds a side
    # effect on top (see compute_knowledge): solo Lancelot becomes a red
    # herring, and the pair's genuinely-Evil half shows up in Merlin's
    # sight same as any other Evil player.
    if settings.get("guinevere") and not settings.get("lancelotPair"):
        errors.append("Guinevere requires the Good & Evil Lancelot pair to be in play.")
    if settings.get("lancelot") and settings.get("lancelotPair"):
        errors.append("Lancelot (solo) and the Good & Evil Lancelot pair cannot both be in play — pick one.")

    try:
        build_role_list(player_count, settings)
    except GameError as err:
        errors.append(str(err))

    return errors


def build_role_list(player_count: int, settings: dict[str, bool]) -> list[str]:
    """Builds the flat list of role ids to shuffle and deal for a game. Raises GameError if it doesn't fit."""
    cfg = MISSION_CONFIG.get(player_count)
    if not cfg:
        raise GameError(f"Unsupported player count: {player_count}")

    evil_special: list[str] = []
    if settings.get("mordred"):
        evil_special.append("MORDRED")
    if settings.get("morgana"):
        evil_special.append("MORGANA")
    if settings.get("oberon"):
        evil_special.append("OBERON")
    if settings.get("assassin"):
        evil_special.append("ASSASSIN")
    if settings.get("agravain"):
        evil_special.append("AGRAVAIN")
    if settings.get("lancelotPair"):
        evil_special.append("LANCELOT_EVIL")

    good_special: list[str] = []
    if settings.get("tristanIseult"):
        good_special += ["TRISTAN", "ISEULT"]
    if settings.get("merlin"):
        good_special.append("MERLIN")
    if settings.get("percival"):
        good_special.append("PERCIVAL")
    if settings.get("arthur"):
        good_special.append("ARTHUR")
    if settings.get("gawain"):
        good_special.append("GAWAIN")
    if settings.get("lancelot"):
        good_special.append("LANCELOT")
    if settings.get("lancelotPair"):
        good_special.append("LANCELOT_GOOD")
    if settings.get("guinevere"):
        good_special.append("GUINEVERE")

    if len(evil_special) > cfg["evil"]:
        raise GameError(
            f"Too many Evil special roles selected ({len(evil_special)}) for only {cfg['evil']} Evil slots at {player_count} players."
        )
    if len(good_special) > cfg["good"]:
        raise GameError(
            f"Too many Good special roles selected ({len(good_special)}) for only {cfg['good']} Good slots at {player_count} players."
        )

    evil_roles = list(evil_special)
    while len(evil_roles) < cfg["evil"]:
        evil_roles.append("MINION")

    good_roles = list(good_special)
    while len(good_roles) < cfg["good"]:
        good_roles.append("LOYAL_SERVANT")

    return evil_roles + good_roles


@dataclass
class RoleAssignment:
    seat: int
    role_id: str
    team: str


def assign_roles(seats: list[int], settings: dict[str, bool]) -> list[RoleAssignment]:
    """Deals roles to seats. `seats` is a list of seat numbers (0-indexed)."""
    role_ids = build_role_list(len(seats), settings)
    random.shuffle(role_ids)
    return [RoleAssignment(seat=seat, role_id=role_ids[i], team=ROLES[role_ids[i]]["team"]) for i, seat in enumerate(seats)]


def compute_knowledge(assignments: list[RoleAssignment]) -> dict[int, list[dict[str, Any]]]:
    """Computes what each seat is allowed to know at role-reveal time. Returns {seat: [{seat, label}, ...]}."""
    knowledge: dict[int, list[dict[str, Any]]] = {a.seat: [] for a in assignments}

    by_role = {a.role_id: a for a in assignments}
    merlin = by_role.get("MERLIN")
    morgana = by_role.get("MORGANA")
    percival = by_role.get("PERCIVAL")
    tristan = by_role.get("TRISTAN")
    iseult = by_role.get("ISEULT")
    guinevere = by_role.get("GUINEVERE")
    lancelot_good = by_role.get("LANCELOT_GOOD")
    lancelot_evil = by_role.get("LANCELOT_EVIL")
    evil_non_oberon = [a for a in assignments if a.team == "evil" and a.role_id != "OBERON"]
    # Evil Lancelot is visible *to* the rest of Evil (they're still one of
    # evil_non_oberon above, so everyone else's knowledge list below
    # includes them, labeled same as any other Evil role) but doesn't see
    # back -- one-way, unlike Oberon's fully mutual blindness. Represents
    # that only the *other* evils are let in on which seat is secretly
    # going to swap sides later; Evil Lancelot themselves gets nothing here.
    evil_seers = [a for a in evil_non_oberon if a.role_id != "LANCELOT_EVIL"]

    if merlin:
        # Evil (minus Mordred) is Merlin's usual sight. Solo Lancelot is a
        # built-in red herring on top of that: though actually Good, he
        # shows up here regardless. The swapping pair is NOT a double
        # red herring, though -- only the genuinely-Evil half is Evil by
        # team (already covered by the filter below); the Good-starting
        # half is not additionally added the way solo Lancelot is, so
        # Merlin only ever sees the one Lancelot who's actually Evil at
        # the start. (The swap itself happens later and isn't reflected
        # here -- this is a one-time reveal, not a live feed.)
        seen_as_evil = {a.seat for a in assignments if a.team == "evil" and a.role_id != "MORDRED"}
        seen_as_evil |= {a.seat for a in assignments if a.role_id == "LANCELOT"}
        knowledge[merlin.seat] = [{"seat": a.seat, "label": "Evil"} for a in assignments if a.seat in seen_as_evil]

    for a in evil_seers:
        others = [o for o in evil_non_oberon if o.seat != a.seat]
        knowledge[a.seat] = [{"seat": o.seat, "label": ROLES[o.role_id]["name"]} for o in others]

    if percival:
        candidates = [c for c in (merlin, morgana) if c is not None]
        if len(candidates) == 1:
            knowledge[percival.seat] = [{"seat": candidates[0].seat, "label": "Merlin"}]
        elif len(candidates) == 2:
            knowledge[percival.seat] = [
                {"seat": c.seat, "label": "Merlin or Morgana (unclear which)"} for c in candidates
            ]

    if guinevere and lancelot_good and lancelot_evil:
        knowledge[guinevere.seat] = [
            {"seat": lancelot_good.seat, "label": "A Lancelot (allegiance hidden)"},
            {"seat": lancelot_evil.seat, "label": "A Lancelot (allegiance hidden)"},
        ]

    if tristan and iseult:
        knowledge[tristan.seat] = knowledge[tristan.seat] + [
            {"seat": iseult.seat, "label": "Iseult, your beloved (Good)"}
        ]
        knowledge[iseult.seat] = knowledge[iseult.seat] + [
            {"seat": tristan.seat, "label": "Tristan, your beloved (Good)"}
        ]

    return knowledge
