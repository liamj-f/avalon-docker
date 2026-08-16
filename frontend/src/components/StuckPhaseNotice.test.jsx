import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StuckPhaseNotice from './StuckPhaseNotice.jsx';

afterEach(cleanup);

// The one behavior every StuckPhaseNotice caller depends on: it's a wrapper
// around window.confirm, and onClick only ever fires if the user actually
// confirms. These are irreversible, host-only actions taken on someone
// else's behalf -- AssassinPanel's is the sharpest case, ending the game
// outright -- so a regression here (confirm skipped, or the wrong message
// shown) is exactly the kind of thing worth pinning down with a test.
describe('StuckPhaseNotice', () => {
  it('calls onClick when the user confirms', () => {
    const onClick = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <StuckPhaseNotice
        message="Someone is stuck."
        buttonLabel="Force-resolve"
        confirmMessage="Are you sure?"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Force-resolve/ }));

    expect(window.confirm).toHaveBeenCalledWith('Are you sure?');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when the user cancels the confirmation', () => {
    const onClick = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <StuckPhaseNotice
        message="Someone is stuck."
        buttonLabel="Force-resolve"
        confirmMessage="Are you sure?"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Force-resolve/ }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders disabled and does not respond to clicks when disabled', () => {
    const onClick = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <StuckPhaseNotice
        message="Pick a target first."
        buttonLabel="Force-resolve: pass to …"
        confirmMessage="Are you sure?"
        onClick={onClick}
        disabled
      />,
    );
    const button = screen.getByRole('button', { name: /Force-resolve/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
