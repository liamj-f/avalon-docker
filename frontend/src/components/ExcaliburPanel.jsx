import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';

const CARD_LABEL = { success: '✅ Success', fail: '❌ Fail', reverse: '🔄 Reverse' };

function cardKind(card) {
  if (card.reversed) return 'reverse';
  return card.success ? 'success' : 'fail';
}

export default function ExcaliburPanel({ room, onDecide }) {
  const { game, players, you } = room;
  const isHolder = you.seat === game.excaliburHolderSeat;
  const holderName = players.find((p) => p.seat === game.excaliburHolderSeat)?.displayName;
  const proposedSet = new Set(game.proposedTeam);
  const [target, setTarget] = useState(null);
  // Only meaningful when the target's card is Reverse -- there's no natural
  // "opposite" to flip it to, so the holder picks explicitly.
  const [reverseChoice, setReverseChoice] = useState(null); // 'success' | 'fail'

  const participants = you.excaliburParticipants || [];
  const targetCard = participants.find((c) => c.seat === target);
  const targetIsReverse = Boolean(targetCard?.reversed);
  const canUse = target !== null && (!targetIsReverse || reverseChoice !== null);

  const selectTarget = (seat) => {
    setTarget(seat);
    setReverseChoice(null);
  };

  const use = () => {
    if (!canUse) return;
    onDecide(true, target, targetIsReverse ? reverseChoice === 'success' : undefined);
  };

  return (
    <div className="phase-panel">
      <h2 className="phase-title">⚔️ Excalibur</h2>
      <p className="phase-lead">
        {isHolder
          ? 'You may change exactly one participant’s card — using it spends Excalibur for the rest of the game, so choose carefully.'
          : `${holderName} holds Excalibur and is deciding whether to change this quest's outcome.`}
      </p>

      {!isHolder && (
        <div className="avatar-grid">
          {players.map((p) => (
            <PlayerAvatar key={p.seat} player={p} isOnTeam={proposedSet.has(p.seat)} isYou={p.seat === you.seat} />
          ))}
        </div>
      )}

      {isHolder && (
        <>
          <p className="hint">Everyone&rsquo;s actual card, just for you — pick who (if anyone) to change:</p>
          <div className="excalibur-cards">
            {participants.map((card) => {
              const player = players.find((p) => p.seat === card.seat);
              const kind = cardKind(card);
              return (
                <button
                  type="button"
                  key={card.seat}
                  className={`excalibur-card excalibur-card-${kind} ${target === card.seat ? 'excalibur-card-selected' : ''}`}
                  onClick={() => selectTarget(card.seat)}
                >
                  <span className="excalibur-card-name">{player?.displayName}</span>
                  <span className="excalibur-card-value">{CARD_LABEL[kind]}</span>
                </button>
              );
            })}
          </div>

          {targetIsReverse && (
            <div className="vote-buttons">
              <p className="hint">Reverse has no natural opposite — choose what it becomes:</p>
              <button
                type="button"
                className={`btn ${reverseChoice === 'success' ? 'btn-approve' : 'btn-ghost'}`}
                onClick={() => setReverseChoice('success')}
              >
                Set to Success
              </button>
              <button
                type="button"
                className={`btn ${reverseChoice === 'fail' ? 'btn-reject' : 'btn-ghost'}`}
                onClick={() => setReverseChoice('fail')}
              >
                Set to Fail
              </button>
            </div>
          )}

          <div className="vote-buttons">
            <button type="button" className="btn btn-approve" disabled={!canUse} onClick={use}>
              ✨ Use Excalibur{target !== null ? ` on ${players.find((p) => p.seat === target)?.displayName}` : ''}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onDecide(false)}>
              Don&rsquo;t use it
            </button>
          </div>
        </>
      )}
    </div>
  );
}
