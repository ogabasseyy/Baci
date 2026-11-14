import type { NextRequest } from 'next/server';
import { handlePrimaryProvisioning } from '../handle-primary-provisioning';

/**
 * Finishes setup for a goal created before primary goal-wallet provisioning
 * existed (or whose provisioning failed). Status-gated and idempotent; see
 * setupPrimarySavingsGoal.
 */
export const POST = (request: NextRequest) =>
  handlePrimaryProvisioning(request, 'setup');
