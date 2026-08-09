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
  const proposeTeam = useCallback((seats) => {
    socket.emit('game:proposeTeam', { seats });
  }, []);
  const submitTeamVote = useCallback((approve) => {
    socket.emit('game:submitTeamVote', { approve });
  }, []);
  const submitMissionVote = useCallback((success) => {
    socket.emit('game:submitMissionVote', { success });
  }, []);
  const submitAssassination = useCallback((targetSeat) => {
    socket.emit('game:submitAssassination', { targetSeat });
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
    submitMissionVote,
    submitAssassination,
    sendChat,
    clearError,
  };
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
