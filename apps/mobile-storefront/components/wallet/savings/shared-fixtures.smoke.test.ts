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

  it('fixture mocks satisfy Jest matcher semantics', async () => {
    const schedule = scheduleJourneyFixture();
    expect(schedule.read).not.toHaveBeenCalled();
    await schedule.read();
    await schedule.read();
    expect(schedule.read).toHaveBeenCalledTimes(2);
    schedule.read.mockClear();
    expect(schedule.read).not.toHaveBeenCalled();

    schedule.options.isCurrent.mockReturnValueOnce(false);
    expect(schedule.options.isCurrent()).toBe(false);
    expect(schedule.options.isCurrent()).toBe(true);

    schedule.read.mockRejectedValue(new Error('jest-boom'));
    await expect(schedule.read()).rejects.toThrow('jest-boom');

    expect(schedule.submit.mock.calls).toHaveLength(0);
    schedule.submit.mockImplementationOnce(
      async () => ({ kind: 'ready' }) as never
    );
    await schedule.submit({} as never);
    expect(schedule.submit.mock.calls).toHaveLength(1);

    expect(schedule.options.nextOperationId()).toContain('22222222');
    schedule.read.mockImplementationOnce(
      async () =>
        ({
          kind: 'ready',
        }) as never
    );
    await expect(schedule.read()).resolves.toEqual({ kind: 'ready' });
    schedule.read.mockReset();
    expect(schedule.read()).toBeUndefined();
  });
});
