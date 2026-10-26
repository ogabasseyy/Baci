import { describe, expect, it } from 'vitest';
import {
  interestPayoutSuccessEventSchema,
  piggyvestWebhookEventSchema,
} from './events';
import observedInterestPayout from './interest-payout-success.fixture.json';

describe('bugfix: legacy payout currency validation', () => {
  it.each([
    undefined,
    'NGN',
  ])('accepts provider payout currency %s without rescaling net kobo', (currency) => {
    const input = {
      ...observedInterestPayout,
      eventData: {
        ...observedInterestPayout.eventData,
        ...(currency === undefined ? {} : { currency }),
      },
    };

    for (const schema of [
      interestPayoutSuccessEventSchema,
      piggyvestWebhookEventSchema,
    ]) {
      const parsed = schema.parse(input);

      expect(parsed.eventData).toMatchObject({
        amount: 733,
        ...(currency === undefined ? {} : { currency: 'NGN' }),
      });
    }
  });

  it.each([
    'USD',
    'ngn',
    '',
    null,
    123,
  ])('rejects explicit foreign or malformed currency %s before legacy decoding strips it', (currency) => {
    const input = {
      ...observedInterestPayout,
      eventData: { ...observedInterestPayout.eventData, currency },
    };

    expect(interestPayoutSuccessEventSchema.safeParse(input).success).toBe(
      false
    );
    expect(piggyvestWebhookEventSchema.safeParse(input).success).toBe(false);
  });

  it('continues accepting unrelated provider extension fields', () => {
    const input = {
      ...observedInterestPayout,
      eventData: {
        ...observedInterestPayout.eventData,
        currency: 'NGN',
        provider_extension: 'future-metadata',
      },
    };

    expect(piggyvestWebhookEventSchema.safeParse(input).success).toBe(true);
  });
});
