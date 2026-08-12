import React from 'react';

// A fixed heraldic/medieval icon per seat, standing in for the old plain
// initials -- purely decorative, but on-theme, and each seat always shows
// the same one for the whole game (a stable identity cue, same job the
// initials used to do). Deliberately disjoint from every *functional*
// emoji marker used elsewhere (👑 leader, ⚔️ Excalibur, ✅❌🔄 quest cards,
// 🏳️ pass, 👁️ view, ✨ use Excalibur, 🌊 Lady of the Lake, 🔀 Lancelot
// swap) so a seat's icon is never mistaken for one of those badges -- the
// leader crown in particular still renders as its own separate badge
// above the circle, never swapped out for or merged with the seat icon.
const SEAT_ICONS = ['🛡️', '🏰', '🐉', '🦁', '🦅', '🐺', '🦌', '🐎', '📯', '🕊️'];

export default function PlayerAvatar({ player, isLeader, isOnTeam, isSelected, isYou, knownLabel, revealTeam, onClick, selectable }) {
  const icon = SEAT_ICONS[player.seat % SEAT_ICONS.length];
  const classes = ['avatar-chip'];
  if (isLeader) classes.push('avatar-leader');
  if (isOnTeam) classes.push('avatar-on-team');
  if (isSelected) classes.push('avatar-selected');
  if (isYou) classes.push('avatar-you');
  if (!player.connected) classes.push('avatar-offline');
  if (selectable) classes.push('avatar-selectable');
  if (revealTeam) classes.push(`avatar-team-${revealTeam}`);

  return (
    <button type="button" className={classes.join(' ')} onClick={onClick} disabled={!selectable}>
      {isLeader && <span className="avatar-crown" title="Leader">👑</span>}
      <span className="avatar-circle" aria-hidden="true">{icon}</span>
      <span className="avatar-name">{player.displayName}</span>
      {knownLabel && <span className="avatar-tag">{knownLabel}</span>}
    </button>
  );
}
