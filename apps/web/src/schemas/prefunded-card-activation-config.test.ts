import { describe, expect, it } from 'vitest';
import { createActivationConfigFixture } from '../lib/piggyvest/prefunded-card-activation-config.test-support';
import { prefundedCardActivationConfigSchema } from './prefunded-card-activation-config';

function replayIssuePaths(input: unknown) {
  const result = prefundedCardActivationConfigSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path[0]);
}

describe('prefundedCardActivationConfigSchema deployment agreement', () => {
  it('accepts consistent public, recovery, and receiver replay compositions', () => {
    expect(
      prefundedCardActivationConfigSchema.safeParse(
        createActivationConfigFixture()
      ).success
    ).toBe(true);
  });

  it('rejects a receiver replay treasury binding that differs from checkout scope', () => {
    const input = createActivationConfigFixture();
    Object.assign(input.receiverReplayRuntime.configuration.scope, {
      treasuryBindingId: '99999999-9999-4999-8999-999999999999',
    });
    expect(replayIssuePaths(input)).toContain('receiverReplayRuntime');
  });

  it('rejects a receiver replay PiggyVest API credential mismatch without exposing it', () => {
    const input = createActivationConfigFixture();
    Object.assign(
      input.receiverReplayRuntime.configuration.evidence.piggyvest,
      {
        apiSecret: 'different-synthetic-provider-secret',
      }
    );
    const result = prefundedCardActivationConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(
      'different-synthetic-provider-secret'
    );
  });

  it('requires the receiver replay and background verifier to share the webhook signer', () => {
    const input = createActivationConfigFixture();
    Object.assign(input.receiverReplayRuntime.configuration.evidence, {
      webhookSecret: 'different-synthetic-webhook-secret',
    });
    const result = prefundedCardActivationConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(
      'different-synthetic-webhook-secret'
    );
  });
});
