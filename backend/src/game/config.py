"""Standard Avalon mission tables by player count.

team_sizes / fails_required are indexed by mission number (0-4).
good / evil are the total number of players on each side.
"""

MISSION_CONFIG = {
    5: {"team_sizes": [2, 3, 2, 3, 3], "fails_required": [1, 1, 1, 1, 1], "good": 3, "evil": 2},
    6: {"team_sizes": [2, 3, 4, 3, 4], "fails_required": [1, 1, 1, 1, 1], "good": 4, "evil": 2},
    7: {"team_sizes": [2, 3, 3, 4, 4], "fails_required": [1, 1, 1, 2, 1], "good": 4, "evil": 3},
    8: {"team_sizes": [3, 4, 4, 5, 5], "fails_required": [1, 1, 1, 2, 1], "good": 5, "evil": 3},
    9: {"team_sizes": [3, 4, 4, 5, 5], "fails_required": [1, 1, 1, 2, 1], "good": 6, "evil": 3},
    10: {"team_sizes": [3, 4, 4, 5, 5], "fails_required": [1, 1, 1, 2, 1], "good": 6, "evil": 4},
}

MIN_PLAYERS = 5
MAX_PLAYERS = 10
