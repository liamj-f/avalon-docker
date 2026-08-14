import React, { useId } from 'react';

// A small hand-drawn coat of arms per seat, standing in for the old plain
// initials (and, before that, a grab-bag of unrelated animal/object
// emoji) -- every seat gets its own heater-shield shield, differenced the
// way real heraldry differences a family's arms for a relation: 5 base
// tinctures (Or/gold, Azure/blue, Gules/red, Vert/green, Argent/silver),
// each shown plain for seats 0-4 and with a bend (a wide diagonal band)
// added for seats 5-9 -- 10 unique, unmistakably shield-shaped icons for
// the 10 possible seats. Purely decorative and stable for the whole game,
// same identity-cue job the initials used to do. Deliberately disjoint
// from every *functional* emoji marker used elsewhere (👑 leader,
// ⚔️ Excalibur, ✅❌🔄 quest cards, 🏳️ pass, 👁️ view, ✨ use Excalibur,
// 🌊 Lady of the Lake, 🔀 Lancelot swap) -- the leader crown in particular
// still renders as its own separate badge above the shield, never merged
// into it.
const TINCTURES = ['#d9b464', '#4f8fe8', '#c0433f', '#4c9a6a', '#c9d3e0'];
const SHIELD_PATH = 'M32,8 L56,8 L56,36 C56,54 46,64 32,70 C18,64 8,54 8,36 L8,8 Z';

// The shield graphic on its own, for spots that just want the per-seat
// heraldry (e.g. the lobby's player list) without the full avatar-chip
// (name, crown, selection state) that PlayerAvatar below wraps it in.
export function PlayerShield({ seat, size = 36, dim }) {
  const clipId = useId();
  const tincture = TINCTURES[seat % TINCTURES.length];
  const hasBend = Math.floor(seat / TINCTURES.length) % 2 === 1;

  return (
    <svg viewBox="0 0 64 76" width={size} height={size} className={dim ? 'player-shield-dim' : undefined}>
      <defs>
        <clipPath id={clipId}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>
      <path d={SHIELD_PATH} fill={tincture} stroke="#0f1420" strokeWidth="2.5" />
      {hasBend && (
        <g clipPath={`url(#${clipId})`}>
          <rect x="-20" y="28" width="100" height="18" fill="#0f1420" transform="rotate(-35 32 39)" />
        </g>
      )}
    </svg>
  );
}

export default function PlayerAvatar({ player, isLeader, isOnTeam, isSelected, isYou, knownLabel, revealTeam, onClick, selectable }) {
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
      <span className="avatar-circle" aria-hidden="true">
        <PlayerShield seat={player.seat} />
      </span>
      <span className="avatar-name">{player.displayName}</span>
      {knownLabel && <span className="avatar-tag">{knownLabel}</span>}
    </button>
  );
}
