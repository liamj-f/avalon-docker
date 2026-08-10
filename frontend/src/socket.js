import { io } from 'socket.io-client';

// Same-origin by default: nginx (Docker) or the Vite dev proxy both forward
// /socket.io to the backend, so no explicit host is needed here.
export const socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });
