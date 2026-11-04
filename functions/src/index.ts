/**
 * Entry Cloud Functions (v2, vùng asia-southeast1). Tên export = tên function khi deploy.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './config.js';

setGlobalOptions({ region: REGION, maxInstances: 20 });

export {
  createRoom,
  joinRoom,
  leaveRoomFn as leaveRoom,
  setReadyFn as setReady,
  updateRoomSettings,
  kickGuestFn as kickGuest,
  requestRematchFn as requestRematch,
  createInvite,
  revokeInvite,
  redeemInvite,
} from './rooms.js';
export { submitMove, matchAction, clockTimeout, sweepDeadlines } from './match.js';
export { mmEnqueueFn as mmEnqueue, mmCancelFn as mmCancel } from './matchmaking.js';
export { onMatchOutbox, reconcileResults } from './results.js';
export { onRoomViewer, dailyCleanup } from './presence.js';
