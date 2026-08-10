import React from 'react';
import { useGame } from '../store.jsx';
import MissionTrack from '../components/MissionTrack.jsx';
import TeamBuilder from '../components/TeamBuilder.jsx';
import VotePanel from '../components/VotePanel.jsx';
import MissionPanel from '../components/MissionPanel.jsx';
import AssassinPanel from '../components/AssassinPanel.jsx';
import LadyOfLakePanel from '../components/LadyOfLakePanel.jsx';
import ExcaliburPanel from '../components/ExcaliburPanel.jsx';
import EndScreen from '../components/EndScreen.jsx';
import RoleCard from '../components/RoleCard.jsx';
import ArthurReveal from '../components/ArthurReveal.jsx';
import Chat from '../components/Chat.jsx';

const PHASE_LABEL = {
  team_building: 'Team Building',
  team_voting: 'Team Vote',
  mission: 'Mission',
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
    submitMissionVote,
    submitAssassination,
    revealArthur,
    useLadyOfLake,
    submitExcaliburDecision,
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

  return (
    <div className="game-layout">
      {game.you && <RoleCard you={game.you} players={room.players} />}

      <div className="game-main">
        <div className="card">
          <div className="phase-badge-row">
            <span className="phase-badge">{PHASE_LABEL[game.phase]}</span>
            <span className="hint">Mission {Math.min(game.missionNumber + 1, 5)} of 5</span>
          </div>
          <MissionTrack game={game} />
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
          {game.phase === 'team_voting' && <VotePanel room={viewRoom} onVote={submitTeamVote} />}
          {game.phase === 'mission' && <MissionPanel room={viewRoom} onPlayCard={submitMissionVote} />}
          {game.phase === 'lady_of_lake' && <LadyOfLakePanel room={viewRoom} onUse={useLadyOfLake} />}
          {game.phase === 'excalibur_decision' && (
            <ExcaliburPanel room={viewRoom} onDecide={submitExcaliburDecision} />
          )}
          {game.phase === 'assassination' && <AssassinPanel room={viewRoom} onAssassinate={submitAssassination} />}
          {game.phase === 'game_over' && <EndScreen room={viewRoom} />}
        </div>
      </div>

      <div className="game-sidebar">
        <Chat chat={room.chat} />
      </div>
    </div>
  );
}

function findPlayer(players, seat) {
  if (seat === null || seat === undefined) return null;
  return players.find((p) => p.seat === seat) || null;
}
