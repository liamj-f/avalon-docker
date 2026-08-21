import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CharacterFooter from './CharacterFooter.jsx';

afterEach(cleanup);

const baseSettings = {
  merlin: true,
  percival: false,
  morgana: false,
  mordred: false,
  oberon: false,
  assassin: true,
  agravain: false,
  arthur: false,
  gawain: false,
  tristanIseult: false,
  lancelot: false,
  lancelotPair: false,
  guinevere: false,
  ladyOfLake: false,
  excalibur: false,
};

// 5 players -> 3 Good / 2 Evil slots (see MISSION_CONFIG). baseSettings
// claims 1 of each (Merlin, Assassin), leaving 2 Loyal Servants + 1 Minion
// to fill the rest -- exercised below via CharacterFooter, since
// fullRoster()/specialSlotCounts() already have their own dedicated tests
// in gameData.test.js.
const fivePlayers = [0, 1, 2, 3, 4].map((seat) => ({ seat, displayName: `P${seat}` }));

describe('CharacterFooter', () => {
  it('renders nothing when there is no room', () => {
    const { container } = render(<CharacterFooter room={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing during the lobby phase, even with an active roster', () => {
    // The Roles panel already shows the same info, more fully, while
    // still in the lobby -- a compact footer duplicating it there is
    // clutter, not a reference. Only shown once phase is 'in_game'.
    const { container } = render(
      <CharacterFooter room={{ phase: 'lobby', settings: baseSettings, players: fivePlayers }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the player count is unsupported', () => {
    const { container } = render(
      <CharacterFooter room={{ phase: 'in_game', settings: baseSettings, players: fivePlayers.slice(0, 3) }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Good/Evil headcount for the current player count', () => {
    render(<CharacterFooter room={{ phase: 'in_game', settings: baseSettings, players: fivePlayers }} />);
    expect(screen.getByText('3 Good')).toBeInTheDocument();
    expect(screen.getByText('2 Evil')).toBeInTheDocument();
  });

  it('renders a button per named character plus the filler Loyal Servants and Minions', () => {
    render(<CharacterFooter room={{ phase: 'in_game', settings: baseSettings, players: fivePlayers }} />);
    expect(screen.getByRole('button', { name: 'Merlin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assassin' })).toBeInTheDocument();
    // 2 Loyal Servants (3 Good slots - Merlin) and 1 Minion (2 Evil slots - Assassin).
    expect(screen.getByRole('button', { name: 'Loyal Servant of Arthur ×2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minion of Mordred' })).toBeInTheDocument();
    expect(screen.queryByText(/Sees all Evil/)).not.toBeInTheDocument();
  });

  it('omits a filler entirely once specials claim every slot on that team', () => {
    // 5 players, 3 Good slots, all claimed by named specials -- no Loyal
    // Servant left to fill.
    const settings = { ...baseSettings, percival: true, gawain: true };
    render(<CharacterFooter room={{ phase: 'in_game', settings, players: fivePlayers }} />);
    expect(screen.queryByRole('button', { name: /Loyal Servant/ })).not.toBeInTheDocument();
  });

  it('includes active extensions alongside the role roster', () => {
    const settings = { ...baseSettings, excalibur: true };
    render(<CharacterFooter room={{ phase: 'in_game', settings, players: fivePlayers }} />);
    expect(screen.getByRole('button', { name: 'Excalibur' })).toBeInTheDocument();
  });

  it('shows the description on click, and hides it again on a second click', () => {
    render(<CharacterFooter room={{ phase: 'in_game', settings: baseSettings, players: fivePlayers }} />);
    const merlinButton = screen.getByRole('button', { name: 'Merlin' });

    fireEvent.click(merlinButton);
    expect(screen.getByText(/Sees all Evil/)).toBeInTheDocument();
    expect(merlinButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(merlinButton);
    expect(screen.queryByText(/Sees all Evil/)).not.toBeInTheDocument();
    expect(merlinButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('only shows one description at a time', () => {
    render(<CharacterFooter room={{ phase: 'in_game', settings: baseSettings, players: fivePlayers }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Merlin' }));
    expect(screen.getByText(/Sees all Evil/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assassin' }));
    expect(screen.queryByText(/Sees all Evil/)).not.toBeInTheDocument();
    expect(screen.getByText(/Gets one shot at naming who you believe is Merlin/)).toBeInTheDocument();
  });

  it('shows a description for a filler role too', () => {
    render(<CharacterFooter room={{ phase: 'in_game', settings: baseSettings, players: fivePlayers }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Minion of Mordred' }));
    expect(screen.getByText(/A plain servant of Evil/)).toBeInTheDocument();
  });
});
