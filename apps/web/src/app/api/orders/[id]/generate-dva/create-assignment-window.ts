import { PAYSTACK_DVA_WINDOW_MS } from './paystack-dva-window';

export function createAssignmentWindow(now = new Date()) {
  return {
    assignedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PAYSTACK_DVA_WINDOW_MS).toISOString(),
  };
}
