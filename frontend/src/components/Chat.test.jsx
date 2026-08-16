import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Chat from './Chat.jsx';

afterEach(cleanup);

// sendChat is the only thing Chat.jsx pulls from the store -- stub it out
// rather than standing up the real socket-backed provider.
const sendChat = vi.fn();
vi.mock('../store.jsx', () => ({
  useGame: () => ({ sendChat }),
}));

describe('Chat', () => {
  it('renders a system message (force-resolve transparency notice) distinctly from a normal one', () => {
    const chat = [
      { displayName: 'Alice', message: 'hi everyone', system: false },
      {
        displayName: 'Bob',
        message: "⚡ Force-resolved the assassination as a Pass — Good's win stands.",
        system: true,
      },
    ];
    render(<Chat chat={chat} muted={false} />);

    // Normal message: rendered as "Name: message".
    expect(screen.getByText('Alice:')).toBeInTheDocument();
    expect(screen.getByText('hi everyone')).toBeInTheDocument();

    // System message: no "Name:" prefix: attributed instead as "— Bob, host".
    expect(screen.queryByText('Bob:')).not.toBeInTheDocument();
    expect(screen.getByText(/Force-resolved the assassination as a Pass/)).toBeInTheDocument();
    expect(screen.getByText('— Bob, host')).toBeInTheDocument();
  });

  it('shows a muted notice and hides the send form when muted', () => {
    render(<Chat chat={[]} muted />);
    expect(screen.getByText(/host has muted you/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Say something…')).not.toBeInTheDocument();
  });

  it('shows the send form when not muted', () => {
    render(<Chat chat={[]} muted={false} />);
    expect(screen.getByPlaceholderText('Say something…')).toBeInTheDocument();
  });
});
