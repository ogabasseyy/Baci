import { describe, expect, it } from 'vitest';
import {
  completionConfirmationSecret,
  makeReadySession,
  validHumanConfirmation,
} from './route-complete-test-helpers';

describe('route-complete-test-helpers', () => {
  it('builds a signed human confirmation and ready session fixture', () => {
    const confirmation = validHumanConfirmation(250000);
    expect(confirmation.amount).toBe(250000);
    expect(confirmation.signature).toHaveLength(64);
    expect(completionConfirmationSecret).toHaveLength(64);
    expect(makeReadySession()).toMatchObject({
      merchant_id: 'merchant-1',
      session_id: 'agentic_session_1',
      status: 'processing',
    });
  });
});
