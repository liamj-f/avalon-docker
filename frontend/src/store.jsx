import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { socket } from './socket';

const TOKEN_KEY = 'avalon.token';

const GameContext = createContext(null);

const initialState = {
  connected: false,
  token: localStorage.getItem(TOKEN_KEY),
  room: null,
  error: null,
};

function reducer(state, action) {
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
    const onDisconnect = () => dispatch({ type: 'DISCONNECTED' });
    const onJoined = (payload) => dispatch({ type: 'JOINED', token: payload.token });
    const onRoomState = (room) => dispatch({ type: 'ROOM_STATE', room });
    const onError = (payload) => dispatch({ type: 'ERROR', message: payload.message });

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:joined', onJoined);
    socket.on('room:state', onRoomState);
    socket.on('error', onError);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:joined', onJoined);
      socket.off('room:state', onRoomState);
      socket.off('error', onError);
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
