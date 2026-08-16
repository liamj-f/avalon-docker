import React, { useEffect, useRef, useState } from 'react';
import { useGame } from '../store.jsx';
import MissionTrack from '../components/MissionTrack.jsx';
import TeamBuilder from '../components/TeamBuilder.jsx';
import VotePanel from '../components/VotePanel.jsx';
import MissionPanel from '../components/MissionPanel.jsx';
import AssassinPanel from '../components/AssassinPanel.jsx';
import LadyOfLakePanel from '../components/LadyOfLakePanel.jsx';
import ExcaliburPanel from '../components/ExcaliburPanel.jsx';
import EndScreen from '../components/EndScreen.jsx';
import ArthurReveal from '../components/ArthurReveal.jsx';
import Chat from '../components/Chat.jsx';
import PlayerRoster from '../components/PlayerRoster.jsx';
import VoteHistory from '../components/VoteHistory.jsx';
import QuestResultModal from '../components/QuestResultModal.jsx';
import { QUEST_FLAVOR } from '../gameData.js';

const PHASE_LABEL = {
  team_building: 'Team Building',
  team_voting: 'Team Vote',
  mission: 'Quest',
  lady_of_lake: 'Lady of the Lake',
  excalibur_decision: 'Excalibur',
  assassination: 'Assassination',
  game_over: 'Game Over',
};

export default function Game() {
  const {
    state,
    proposeTeam,
    submitTeamVote,
    forceResolveTeamVote,
    submitMissionVote,
    forceResolveMission,
    submitAssassination,
    forcePassAssassination,
    revealArthur,
    useLadyOfLake,
    forceResolveLadyOfLake,
    submitExcaliburView,
    submitExcaliburDecision,
    forceDeclineExcalibur,
    setMuted,
  } = useGame();
  const { room } = state;
  const { game } = room;

  // room.you carries identity (name/host/token); game.you carries the
  // in-game secret (role/team/knowledge/etc). Merge them so child
  // components have one consistent "you" to read from.
  const you = { ...room.you, ...(game.you || {}) };
  const viewRoom = { ...room, you };

  const ladyHolder = game.hasLadyOfLake && findPlayer(room.players, game.ladyHolderSeat);
  const excaliburHolder = game.hasExcalibur && findPlayer(room.players, game.excaliburHolderSeat);

  // Which resolved quest's result modal (if any) is open. Doubles as the
  // "just resolved" auto-popup (results.length growing opens the newest
  // one) and the click-to-reopen history view from MissionTrack's pips --
  // one piece of state, one modal, instead of duplicating the UI.
  const results = game.missionResults;
  const seenResultCountRef = useRef(results.length);
  const [openQuestNumber, setOpenQuestNumber] = useState(null);

  useEffect(() => {
    if (results.length > seenResultCountRef.current) {
      setOpenQuestNumber(results[results.length - 1].missionNumber);
    }
    seenResultCountRef.current = results.length;
    // Only the count matters for "did a new one just land" -- re-running
    // this for every unrelated game update would be wasted work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length]);

  const openResult = results.find((m) => m.missionNumber === openQuestNumber);

  return (
    <div className="game-layout">
      {openResult && (
        <QuestResultModal result={openResult} players={room.players} onClose={() => setOpenQuestNumber(null)} />
      )}

      <div className="game-main">
        <div className="card">
          <div className="phase-badge-row">
            <span className="phase-badge">{PHASE_LABEL[game.phase]}</span>
            <span className="hint" title={QUEST_FLAVOR[Math.min(game.missionNumber, 4)].blurb}>
              Quest {Math.min(game.missionNumber + 1, 5)} of 5 · {QUEST_FLAVOR[Math.min(game.missionNumber, 4)].name}
            </span>
          </div>
          <MissionTrack game={game} onSelectQuest={setOpenQuestNumber} />
          <div className="avatar-legend">
            <span className="avatar-legend-item">👑 Leader</span>
            <span className="avatar-legend-item">🧭 Nominated for this quest</span>
            {game.hasExcalibur && <span className="avatar-legend-item">⚔️ Holds Excalibur</span>}
          </div>
          {(ladyHolder || excaliburHolder) && (
            <div className="extension-strip">
              {ladyHolder && (
                <span className="extension-badge">
                  🌊 Lady of the Lake: <strong>{ladyHolder.displayName}</strong>
                </span>
              )}
              {excaliburHolder && (
                <span className="extension-badge">
                  ⚔️ Excalibur: <strong>{excaliburHolder.displayName}</strong>
                  {game.excaliburUsed && ' (spent)'}
                </span>
              )}
            </div>
          )}
          {game.lancelotsSwapped && (
            <p className="swap-banner">🔀 The Lancelots have swapped allegiance — nobody knows who's who now.</p>
          )}
          {game.publicReveals.length > 0 && (
            <p className="public-reveal-strip">
              👑 Revealed:{' '}
              {game.publicReveals
                .map((r) => `${findPlayer(room.players, r.seat)?.displayName} (${r.role})`)
                .join(', ')}
            </p>
          )}
          <ArthurReveal game={game} you={you} onReveal={revealArthur} />
        </div>

        <div className="card">
          {game.phase === 'team_building' && <TeamBuilder room={viewRoom} onPropose={proposeTeam} />}
          {game.phase === 'team_voting' && (
            <VotePanel room={viewRoom} onVote={submitTeamVote} onForceResolve={forceResolveTeamVote} />
          )}
          {game.phase === 'mission' && (
            <MissionPanel room={viewRoom} onPlayCard={submitMissionVote} onForceResolve={forceResolveMission} />
          )}
          {game.phase === 'lady_of_lake' && (
            <LadyOfLakePanel room={viewRoom} onUse={useLadyOfLake} onForceResolve={forceResolveLadyOfLake} />
          )}
          {game.phase === 'excalibur_decision' && (
            <ExcaliburPanel
              room={viewRoom}
              onView={submitExcaliburView}
              onDecide={submitExcaliburDecision}
              onForceDecline={forceDeclineExcalibur}
            />
          )}
          {game.phase === 'assassination' && (
            <AssassinPanel room={viewRoom} onAssassinate={submitAssassination} onForcePass={forcePassAssassination} />
          )}
          {game.phase === 'game_over' && <EndScreen room={viewRoom} />}
        </div>

        <VoteHistory room={viewRoom} />
      </div>

      <div className="game-sidebar">
        <PlayerRoster room={viewRoom} onSetMuted={setMuted} />
        <Chat chat={room.chat} muted={you.muted} />
      </div>
    </div>
  );
}

function findPlayer(players, seat) {
  if (seat === null || seat === undefined) return null;
  return players.find((p) => p.seat === seat) || null;
}
