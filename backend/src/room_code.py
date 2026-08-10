"""Short, human-friendly room codes."""

import random

# Deliberately excludes visually ambiguous characters (0/O, 1/I).
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _random_code(length: int = 5) -> str:
    return "".join(random.choice(ALPHABET) for _ in range(length))


def generate_unique_code(existing_codes: set[str], length: int = 5) -> str:
    code = _random_code(length)
    attempts = 0
    while code in existing_codes and attempts < 50:
        code = _random_code(length)
        attempts += 1
    return code
