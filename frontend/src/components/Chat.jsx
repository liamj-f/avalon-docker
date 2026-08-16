import React, { useEffect, useRef, useState } from 'react';
import { useGame } from '../store.jsx';

export default function Chat({ chat, muted }) {
  const { sendChat } = useGame();
  const [message, setMessage] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chat.length]);

  const submit = (e) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    sendChat(trimmed);
    setMessage('');
  };

  return (
    <div className="chat-box">
      <h3 className="section-title">Table Talk</h3>
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && <p className="hint">No messages yet.</p>}
        {chat.map((m, i) => (
          <div key={i} className="chat-line">
            <strong>{m.displayName}:</strong> {m.message}
          </div>
        ))}
      </div>
      {muted ? (
        <p className="hint">🔇 The host has muted you — you can still read the table, but not send messages.</p>
      ) : (
        <form onSubmit={submit} className="chat-form">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Say something…"
            maxLength={500}
          />
          <button type="submit" className="btn btn-ghost">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
