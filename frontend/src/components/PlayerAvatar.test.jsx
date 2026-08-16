import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import PlayerAvatar from './PlayerAvatar.jsx';

afterEach(cleanup);

const basePlayer = { seat: 0, displayName: 'Alice', connected: true };

describe('PlayerAvatar', () => {
  it('shows the Excalibur badge, not the nomination badge, when a seat is both', () => {
    // Excalibur takes priority when a seat is both on the team and holding
    // Excalibur -- it's the more specific, more consequential fact about
    // that seat this quest (see the comment above topBadge in the
    // component itself).
    render(<PlayerAvatar player={basePlayer} isOnTeam isExcaliburHolder />);
    expect(screen.getByTitle('Holds Excalibur this quest')).toBeInTheDocument();
    expect(screen.queryByTitle('Nominated for this quest')).not.toBeInTheDocument();
  });

  it('shows only the nomination badge when on the team without Excalibur', () => {
    render(<PlayerAvatar player={basePlayer} isOnTeam />);
    expect(screen.getByTitle('Nominated for this quest')).toBeInTheDocument();
    expect(screen.queryByTitle('Holds Excalibur this quest')).not.toBeInTheDocument();
  });

  it('shows neither badge when off the team', () => {
    render(<PlayerAvatar player={basePlayer} />);
    expect(screen.queryByTitle('Nominated for this quest')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Holds Excalibur this quest')).not.toBeInTheDocument();
  });

  it('marks a disconnected player with the offline class', () => {
    render(<PlayerAvatar player={{ ...basePlayer, connected: false }} />);
    expect(screen.getByRole('button')).toHaveClass('avatar-offline');
  });

  it('does not mark a connected player as offline', () => {
    render(<PlayerAvatar player={basePlayer} />);
    expect(screen.getByRole('button')).not.toHaveClass('avatar-offline');
  });

  it('is only clickable when selectable, and calls onClick when clicked', () => {
    const onClick = vi.fn();
    const { rerender } = render(<PlayerAvatar player={basePlayer} onClick={onClick} />);
    expect(screen.getByRole('button')).toBeDisabled();

    rerender(<PlayerAvatar player={basePlayer} onClick={onClick} selectable />);
    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the leader crown only when isLeader', () => {
    render(<PlayerAvatar player={basePlayer} isLeader />);
    expect(screen.getByTitle('Leader')).toBeInTheDocument();
  });
});
