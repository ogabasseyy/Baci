import { deviceChangeFixture } from '@baci/shared/test-fixtures/piggyvest-device-change';
import { draftClosureReviewFixture } from '@baci/shared/test-fixtures/piggyvest-draft-closure';
import { protectedOfferFixture } from '@baci/shared/test-fixtures/piggyvest-protected-offer';
import { purchaseFixture } from '@baci/shared/test-fixtures/piggyvest-purchase';
import { scheduleJourneyFixture } from '@baci/shared/test-fixtures/piggyvest-schedule';

describe('shared piggyvest fixtures (Jest smoke)', () => {
  it('constructs every exported fixture without a Vitest runtime', async () => {
    expect(purchaseFixture()).toBeDefined();
    expect(deviceChangeFixture()).toBeDefined();
    expect(protectedOfferFixture()).toBeDefined();
    await expect(draftClosureReviewFixture()).resolves.toBeDefined();
    const schedule = scheduleJourneyFixture();
    await expect(schedule.read()).resolves.toBeDefined();
    expect(schedule.options.isCurrent()).toBe(true);
  });
});
