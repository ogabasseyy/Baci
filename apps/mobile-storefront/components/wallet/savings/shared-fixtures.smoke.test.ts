import { deviceChangeFixture } from '@baci/shared/test-fixtures/piggyvest-device-change';
import { draftClosureReviewFixture } from '@baci/shared/test-fixtures/piggyvest-draft-closure';
import { protectedOfferFixture } from '@baci/shared/test-fixtures/piggyvest-protected-offer';
import { purchaseFixture } from '@baci/shared/test-fixtures/piggyvest-purchase';
import { scheduleJourneyFixture } from '@baci/shared/test-fixtures/piggyvest-schedule';

describe('shared piggyvest fixtures (Jest smoke)', () => {
  it('resolves every fixture subpath through the package exports map', () => {
    // Node resolution (createRequire) honors package.json exports and
    // bypasses Jest's path mapper, so a missing or mistyped
    // ./test-fixtures/* exports entry fails here even though Jest's
    // mapper would mask it. Metro itself, which consumes the same
    // exports map (unstable_enablePackageExports), is not exercised.
    const { createRequire } =
      require('node:module') as typeof import('node:module');
    const nodeRequire = createRequire(__filename);
    for (const name of [
      'piggyvest-purchase',
      'piggyvest-device-change',
      'piggyvest-protected-offer',
      'piggyvest-draft-closure',
      'piggyvest-schedule',
      'builder-ai-edit',
    ]) {
      expect(
        nodeRequire.resolve(`@baci/shared/test-fixtures/${name}`)
      ).toContain(`test-fixtures/${name}.`);
    }
    expect(nodeRequire.resolve('@baci/shared/vtu')).toContain('vtu');
  });

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
