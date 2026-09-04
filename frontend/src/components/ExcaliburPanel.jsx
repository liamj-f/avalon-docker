import React, { useState } from 'react';
import PlayerAvatar from './PlayerAvatar.jsx';
import StuckPhaseNotice from './StuckPhaseNotice.jsx';

const CARD_LABEL = { success: '✅ Success', fail: '❌ Fail', reverse: '🔄 Reverse' };

function cardKind(card) {
  if (card.reversed) return 'reverse';
  return card.success ? 'success' : 'fail';
}

export default function ExcaliburPanel({ room, onView, onDecide, onForceDecline }) {
  const { game, players, you } = room;
  const isHolder = you.seat === game.excaliburHolderSeat;
  const holder = players.find((p) => p.seat === game.excaliburHolderSeat);
  const holderName = holder?.displayName;
  const proposedSet = new Set(game.proposedTeam);

  // The holder can only ever see the one card they've committed to viewing
  // (you.excaliburViewing, set server-side by sp_excalibur_view) -- there's
  // no "browse everyone's card" step anymore, matching the real rule.
  const viewing = you.excaliburViewing || null;
  const [pendingTarget, setPendingTarget] = useState(null);
  // Only meaningful when the viewed card is Reverse -- there's no natural
  // "opposite" to flip it to, so the holder picks explicitly.
  const [reverseChoice, setReverseChoice] = useState(null); // 'success' | 'fail'

  const viewedIsReverse = Boolean(viewing?.reversed);
  const canUse = !viewedIsReverse || reverseChoice !== null;

  const view = () => {
    if (pendingTarget === null) return;
    onView(pendingTarget);
  };

  const use = () => {
    if (!canUse) return;
    onDecide(true, viewedIsReverse ? reverseChoice === 'success' : undefined);
  };

  return (
    <div className="phase-panel">
      <h2 className="phase-title">⚔️ Excalibur</h2>
      <p className="phase-lead">
        {isHolder
          ? viewing
            ? 'You may change this card — using it spends Excalibur for the rest of the game, so choose carefully.'
            : 'Pick one participant to look at their real card. You only get to see one — choose wisely.'
          : `${holderName} holds Excalibur and is deciding whether to change this quest's outcome.`}
      </p>

      {!isHolder && (
        <div className="avatar-grid">
          {players.map((p) => (
            <PlayerAvatar
              key={p.seat}
              player={p}
              isOnTeam={proposedSet.has(p.seat)}
              isExcaliburHolder={p.seat === game.excaliburHolderSeat}
              isYou={p.seat === you.seat}
            />
          ))}
        </div>
      )}

      {you.isHost && !isHolder && holder && !holder.connected && (
        <StuckPhaseNotice
          message={`${holderName} is disconnected and can't decide. You can force it through — this always resolves as declining to use Excalibur, never a forced swap of anyone's card.`}
          buttonLabel="Force-resolve: decline Excalibur"
          confirmMessage="Force-resolve this Excalibur decision? This will resolve as declining to use it — nobody's card gets swapped."
          onClick={onForceDecline}
        />
      )}

      {isHolder && !viewing && (
        <>
          <div className="avatar-grid">
            {/* Never yourself -- Excalibur can't be used on your own card, same
                restriction as the leader not being able to hold it themselves. */}
            {game.proposedTeam.filter((seat) => seat !== you.seat).map((seat) => {
              const p = players.find((pl) => pl.seat === seat);
              return (
                <PlayerAvatar
                  key={seat}
                  player={p}
                  isSelected={pendingTarget === seat}
                  selectable
                  onClick={() => setPendingTarget(seat)}
                />
              );
            })}
          </div>
          <div className="vote-buttons">
            <button type="button" className="btn btn-primary" disabled={pendingTarget === null} onClick={view}>
              👁️ View{pendingTarget !== null ? ` ${players.find((p) => p.seat === pendingTarget)?.displayName}'s` : ''}{' '}
              card
            </button>
          </div>
        </>
      )}

      {isHolder && viewing && (
        <>
          <p className="hint">{players.find((p) => p.seat === viewing.targetSeat)?.displayName}&rsquo;s actual card:</p>
          <div className="excalibur-cards">
            {(() => {
              const kind = cardKind(viewing);
              return (
                <div className={`excalibur-card excalibur-card-${kind} excalibur-card-selected`}>
                  <span className="excalibur-card-name">
                    {players.find((p) => p.seat === viewing.targetSeat)?.displayName}
                  </span>
                  <span className="excalibur-card-value">{CARD_LABEL[kind]}</span>
                </div>
              );
            })()}
          </div>

          {viewedIsReverse && (
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
              ✨ Use Excalibur to change it
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onDecide(false)}>
              Leave it as is
            </button>
          </div>
        </>
      )}
    </div>
  );
}
