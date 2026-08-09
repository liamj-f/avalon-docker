import React from 'react';

export default function PlayerAvatar({ player, isLeader, isOnTeam, isSelected, isYou, knownLabel, revealTeam, onClick, selectable }) {
  const initials = player.displayName.slice(0, 2).toUpperCase();
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
      <span className="avatar-circle">{initials}</span>
      <span className="avatar-name">{player.displayName}</span>
      {knownLabel && <span className="avatar-tag">{knownLabel}</span>}
    </button>
  );
}
