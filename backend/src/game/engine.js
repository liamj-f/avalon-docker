const { MISSION_CONFIG } = require('./config');
const { GameError, assignRoles, computeKnowledge, ROLES } = require('./roles');

/**
 * Full state machine for one game of Avalon within a room.
 * Phases: team_building -> team_voting -> (back to team_building on reject,
 * or) mission -> ... -> assassination (if Good hits 3 successes and an
 * Assassin is in play) -> game_over.
 */
class AvalonGame {
  constructor(seats, settings, displayNames) {
    this.settings = settings;
    this.cfg = MISSION_CONFIG[seats.length];
    if (!this.cfg) throw new GameError(`Unsupported player count: ${seats.length}`);

    this.assignments = assignRoles(seats, settings);
    this.knowledge = computeKnowledge(this.assignments);
    this.displayNames = displayNames; // Map<seat, string>, for persistence/history only

    this.seatOrder = seats.slice();
    this.leaderIndex = Math.floor(Math.random() * seats.length);
    this.missionNumber = 0;
    this.rejectionCount = 0;
    this.phase = 'team_building';
    this.proposedTeam = [];
    this.votes = {};
    this.missionVotes = {};
    this.missionResults = [];
    this.voteHistory = [];
    this.winner = null;
    this.winReason = null;
    this.assassinationTarget = null;
    this.createdAt = new Date();
  }

  get leaderSeat() {
    return this.seatOrder[this.leaderIndex];
  }

  get currentTeamSize() {
    return this.cfg.teamSizes[this.missionNumber];
  }

  get currentFailsRequired() {
    return this.cfg.failsRequired[this.missionNumber];
  }

  roleOf(seat) {
    return this.assignments.find((a) => a.seat === seat);
  }

  proposeTeam(seat, team) {
    if (this.phase !== 'team_building') throw new GameError('Not in the team-building phase.');
    if (seat !== this.leaderSeat) throw new GameError('Only the current leader can propose a team.');
    const size = this.currentTeamSize;
    const unique = new Set(team);
    if (unique.size !== team.length || team.length !== size) {
      throw new GameError(`The team must have exactly ${size} distinct players.`);
    }
    for (const s of team) {
      if (!this.seatOrder.includes(s)) throw new GameError('Team includes an unknown seat.');
    }
    this.proposedTeam = team.slice();
    this.phase = 'team_voting';
    this.votes = {};
  }

  submitTeamVote(seat, approve) {
    if (this.phase !== 'team_voting') throw new GameError('Not in the voting phase.');
    if (!this.seatOrder.includes(seat)) throw new GameError('Unknown seat.');
    if (seat in this.votes) throw new GameError('You already voted.');
    this.votes[seat] = !!approve;
    if (Object.keys(this.votes).length === this.seatOrder.length) {
      return this._resolveTeamVote();
    }
    return null;
  }

  _resolveTeamVote() {
    const approvals = Object.values(this.votes).filter(Boolean).length;
    const approved = approvals * 2 > this.seatOrder.length;

    this.voteHistory.push({
      missionNumber: this.missionNumber,
      leaderSeat: this.leaderSeat,
      team: this.proposedTeam.slice(),
      votes: { ...this.votes },
      approved,
    });

    if (approved) {
      this.rejectionCount = 0;
      this.phase = 'mission';
      this.missionVotes = {};
    } else {
      this.rejectionCount += 1;
      this.proposedTeam = [];
      this._advanceLeader();
      if (this.rejectionCount >= 5) {
        this.phase = 'game_over';
        this.winner = 'evil';
        this.winReason = 'vote_track';
      } else {
        this.phase = 'team_building';
      }
    }
    return { approved };
  }

  _advanceLeader() {
    this.leaderIndex = (this.leaderIndex + 1) % this.seatOrder.length;
  }

  submitMissionVote(seat, success) {
    if (this.phase !== 'mission') throw new GameError('Not in the mission phase.');
    if (!this.proposedTeam.includes(seat)) throw new GameError('You are not on this mission.');
    if (seat in this.missionVotes) throw new GameError('You already played a card on this mission.');
    const role = this.roleOf(seat);
    if (role.team === 'good' && !success) {
      throw new GameError('Good players must play Success.');
    }
    this.missionVotes[seat] = !!success;
    if (Object.keys(this.missionVotes).length === this.proposedTeam.length) {
      return this._resolveMission();
    }
    return null;
  }

  _resolveMission() {
    const failCount = Object.values(this.missionVotes).filter((v) => v === false).length;
    const required = this.currentFailsRequired;
    const result = failCount >= required ? 'fail' : 'success';

    this.missionResults.push({
      missionNumber: this.missionNumber,
      teamSize: this.currentTeamSize,
      failsRequired: required,
      team: this.proposedTeam.slice(),
      result,
      failCount,
    });

    const successes = this.missionResults.filter((m) => m.result === 'success').length;
    const fails = this.missionResults.filter((m) => m.result === 'fail').length;

    if (fails >= 3) {
      this.phase = 'game_over';
      this.winner = 'evil';
      this.winReason = 'missions';
      return { result };
    }

    if (successes >= 3) {
      if (this.settings.assassin) {
        this.phase = 'assassination';
      } else {
        this.phase = 'game_over';
        this.winner = 'good';
        this.winReason = 'missions';
      }
      return { result };
    }

    this.missionNumber += 1;
    this.proposedTeam = [];
    this.rejectionCount = 0;
    this._advanceLeader();
    this.phase = 'team_building';
    return { result };
  }

  submitAssassination(seat, targetSeat) {
    if (this.phase !== 'assassination') throw new GameError('Not in the assassination phase.');
    const assassin = this.assignments.find((a) => a.roleId === 'ASSASSIN');
    if (!assassin || assassin.seat !== seat) throw new GameError('Only the Assassin may name a target.');
    if (!this.seatOrder.includes(targetSeat)) throw new GameError('Invalid target.');

    this.assassinationTarget = targetSeat;
    const merlin = this.assignments.find((a) => a.roleId === 'MERLIN');
    const hitMerlin = !!merlin && merlin.seat === targetSeat;

    this.phase = 'game_over';
    this.winner = hitMerlin ? 'evil' : 'good';
    this.winReason = 'assassination';
    return { hitMerlin };
  }

  /** Redacted view of the game for a single seat (or null for a spectator/no-seat view). */
  serializeForSeat(seat) {
    const base = {
      phase: this.phase,
      missionNumber: this.missionNumber,
      teamSizes: this.cfg.teamSizes,
      failsRequired: this.cfg.failsRequired,
      leaderSeat: this.leaderSeat,
      proposedTeam: this.proposedTeam,
      rejectionCount: this.rejectionCount,
      missionResults: this.missionResults,
      voteHistory: this.voteHistory,
      votesInSoFar: Object.keys(this.votes).length,
      missionVotesInSoFar: Object.keys(this.missionVotes).length,
      winner: this.winner,
      winReason: this.winReason,
      assassinationTarget: this.assassinationTarget,
      hasAssassin: !!this.settings.assassin,
    };

    if (this.phase === 'team_voting') {
      base.hasVoted = seat in this.votes;
    }
    if (this.phase === 'mission') {
      base.hasPlayedMissionCard = seat in this.missionVotes;
    }

    if (seat !== null && seat !== undefined) {
      const role = this.roleOf(seat);
      if (role) {
        base.you = {
          seat,
          role: ROLES[role.roleId].name,
          roleId: role.roleId,
          team: role.team,
          description: ROLES[role.roleId].description,
          knowledge: this.knowledge.get(seat) || [],
        };
      }
    }

    if (this.phase === 'game_over') {
      base.reveal = this.assignments.map((a) => ({
        seat: a.seat,
        roleId: a.roleId,
        role: ROLES[a.roleId].name,
        team: a.team,
      }));
    }

    return base;
  }
}

module.exports = { AvalonGame };
