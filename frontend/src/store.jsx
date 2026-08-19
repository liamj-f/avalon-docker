import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { socket } from './socket';

export const TOKEN_KEY = 'avalon.token'; // exported so tests can check localStorage against the same key

const GameContext = createContext(null);

const initialState = {
  connected: false,
  token: localStorage.getItem(TOKEN_KEY),
  room: null,
  error: null,
};

// Exported for testing -- a pure function, no reason not to.
export function reducer(state, action) {
  switch (action.type) {
    case 'CONNECTED':
      return { ...state, connected: true };
    case 'DISCONNECTED':
      return { ...state, connected: false };
    case 'JOINED':
      localStorage.setItem(TOKEN_KEY, action.token);
      return { ...state, token: action.token };
    case 'ROOM_STATE':
      return { ...state, room: action.room, error: null };
    case 'ERROR':
      return { ...state, error: action.message };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'LEFT':
      localStorage.removeItem(TOKEN_KEY);
      return { ...state, token: null, room: null };
    case 'SESSION_INVALID':
      // Distinct from a plain 'error' toast on purpose -- this fires when
      // room:rejoin itself fails (most commonly: the host kicked this
      // player while they were disconnected), meaning there's no real room
      // left to show. Leaving `room` in place and only toasting a message
      // over it would leave a frozen, stale lobby/game view on screen with
      // nothing actually working -- reset all the way back to Home, same
      // as LEFT, with the reason carried along as the toast.
      localStorage.removeItem(TOKEN_KEY);
      return { ...state, token: null, room: null, error: action.message };
    default:
      return state;
  }
}

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const tokenRef = useRef(state.token);
  tokenRef.current = state.token;

  useEffect(() => {
    const onConnect = () => {
      dispatch({ type: 'CONNECTED' });
      if (tokenRef.current) {
        socket.emit('room:rejoin', { token: tokenRef.current });
      }
    };
    const onDisconnect = (reason) => {
      dispatch({ type: 'DISCONNECTED' });
      if (reason === 'io server disconnect') {
        // Socket.IO's own documented behavior: a *server*-initiated
        // disconnect (e.g. sio.disconnect() after a kick) is the one
        // disconnect reason the client never auto-reconnects from on its
        // own, unlike every other reason (network drop, etc.) -- so
        // without this, someone kicked back to Home would be stuck unable
        // to create/join a new room at all until they manually refreshed
        // the page. This re-arms a normal connection attempt explicitly.
        socket.connect();
      }
    };
    const onJoined = (payload) => dispatch({ type: 'JOINED', token: payload.token });
    const onRoomState = (room) => dispatch({ type: 'ROOM_STATE', room });
    const onError = (payload) => dispatch({ type: 'ERROR', message: payload.message });
    const onRejoinFailed = (payload) => dispatch({ type: 'SESSION_INVALID', message: payload.message });
    // Delivered directly, over the still-open connection, right before the
    // server closes it (see the design note on the emit itself,
    // handle_kick_player) -- the disconnect that follows is what
    // onDisconnect's reason check above is for.
    const onKicked = (payload) => dispatch({ type: 'SESSION_INVALID', message: payload.message });

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:joined', onJoined);
    socket.on('room:state', onRoomState);
    socket.on('error', onError);
    socket.on('room:rejoinFailed', onRejoinFailed);
    socket.on('room:kicked', onKicked);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:joined', onJoined);
      socket.off('room:state', onRoomState);
      socket.off('error', onError);
      socket.off('room:rejoinFailed', onRejoinFailed);
      socket.off('room:kicked', onKicked);
    };
  }, []);

  const actions = useMemoActions(dispatch);

  return <GameContext.Provider value={{ state, ...actions }}>{children}</GameContext.Provider>;
}

function useMemoActions(dispatch) {
  const createRoom = useCallback((displayName) => {
    socket.emit('room:create', { displayName });
  }, []);
  const joinRoom = useCallback((code, displayName) => {
    socket.emit('room:join', { code, displayName });
  }, []);
  const updateSettings = useCallback((settings) => {
    socket.emit('room:updateSettings', { settings });
  }, []);
  const startGame = useCallback(() => {
    socket.emit('room:start', {});
  }, []);
  const resetToLobby = useCallback(() => {
    socket.emit('room:resetToLobby', {});
  }, []);
  const leaveRoom = useCallback(() => {
    socket.emit('room:leave', {});
    dispatch({ type: 'LEFT' });
  }, [dispatch]);
  const proposeTeam = useCallback((seats, excaliburSeat) => {
    socket.emit('game:proposeTeam', { seats, excaliburSeat });
  }, []);
  const forceAdvanceLeader = useCallback(() => {
    socket.emit('game:forceAdvanceLeader', {});
  }, []);
  const submitTeamVote = useCallback((approve) => {
    socket.emit('game:submitTeamVote', { approve });
  }, []);
  const forceResolveTeamVote = useCallback(() => {
    socket.emit('game:forceResolveTeamVote', {});
  }, []);
  const submitMissionVote = useCallback((success, reverse = false) => {
    socket.emit('game:submitMissionVote', { success, reverse });
  }, []);
  const forceResolveMission = useCallback(() => {
    socket.emit('game:forceResolveMission', {});
  }, []);
  const submitAssassination = useCallback((targetSeats) => {
    socket.emit('game:submitAssassination', { targetSeats });
  }, []);
  const forcePassAssassination = useCallback(() => {
    socket.emit('game:forcePassAssassination', {});
  }, []);
  const revealArthur = useCallback(() => {
    socket.emit('game:revealArthur', {});
  }, []);
  const useLadyOfLake = useCallback((targetSeat) => {
    socket.emit('game:useLadyOfLake', { targetSeat });
  }, []);
  const forceResolveLadyOfLake = useCallback((targetSeat) => {
    socket.emit('game:forceResolveLadyOfLake', { targetSeat });
  }, []);
  const submitExcaliburView = useCallback((targetSeat) => {
    socket.emit('game:excaliburView', { targetSeat });
  }, []);
  const submitExcaliburDecision = useCallback((use, newSuccess) => {
    socket.emit('game:excaliburDecision', { use, newSuccess });
  }, []);
  const forceDeclineExcalibur = useCallback(() => {
    socket.emit('game:forceDeclineExcalibur', {});
  }, []);
  const setRolePreference = useCallback((key, want) => {
    socket.emit('room:setRolePreference', { key, want });
  }, []);
  const transferHost = useCallback((targetSeat) => {
    socket.emit('room:transferHost', { targetSeat });
  }, []);
  const kickPlayer = useCallback((targetSeat) => {
    socket.emit('room:kickPlayer', { targetSeat });
  }, []);
  const setMuted = useCallback((targetSeat, muted) => {
    socket.emit('room:setMuted', { targetSeat, muted });
  }, []);
  const sendChat = useCallback((message) => {
    socket.emit('chat:send', { message });
  }, []);
  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), [dispatch]);

  return {
    createRoom,
    joinRoom,
    updateSettings,
    startGame,
    resetToLobby,
    leaveRoom,
    proposeTeam,
    forceAdvanceLeader,
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
    setRolePreference,
    transferHost,
    kickPlayer,
    setMuted,
    sendChat,
    clearError,
  };
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
