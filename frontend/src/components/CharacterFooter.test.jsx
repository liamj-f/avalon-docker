import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CharacterFooter, { activeRoster } from './CharacterFooter.jsx';

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

describe('activeRoster', () => {
  it('returns null when the room has no settings yet', () => {
    expect(activeRoster(null)).toBeNull();
    expect(activeRoster({})).toBeNull();
  });

  it('returns only the enabled characters, in FULL_ROSTER order', () => {
    const roster = activeRoster({ settings: baseSettings });
    expect(roster.map((r) => r.key)).toEqual(['merlin', 'assassin']);
  });

  it('returns null when nothing is enabled', () => {
    const allOff = Object.fromEntries(Object.keys(baseSettings).map((k) => [k, false]));
    expect(activeRoster({ settings: allOff })).toBeNull();
  });
});

describe('CharacterFooter', () => {
  it('renders nothing when there is no active roster', () => {
    const { container } = render(<CharacterFooter room={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a button per enabled character and no description by default', () => {
    render(<CharacterFooter room={{ settings: baseSettings }} />);
    expect(screen.getByRole('button', { name: 'Merlin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assassin' })).toBeInTheDocument();
    expect(screen.queryByText(/Sees all Evil/)).not.toBeInTheDocument();
  });

  it('shows the description on click, and hides it again on a second click', () => {
    render(<CharacterFooter room={{ settings: baseSettings }} />);
    const merlinButton = screen.getByRole('button', { name: 'Merlin' });

    fireEvent.click(merlinButton);
    expect(screen.getByText(/Sees all Evil/)).toBeInTheDocument();
    expect(merlinButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(merlinButton);
    expect(screen.queryByText(/Sees all Evil/)).not.toBeInTheDocument();
    expect(merlinButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('only shows one description at a time', () => {
    render(<CharacterFooter room={{ settings: baseSettings }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Merlin' }));
    expect(screen.getByText(/Sees all Evil/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assassin' }));
    expect(screen.queryByText(/Sees all Evil/)).not.toBeInTheDocument();
    expect(screen.getByText(/Gets one shot at naming Merlin/)).toBeInTheDocument();
  });
});
