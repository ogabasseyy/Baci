import { describe, expect, it } from 'vitest';
import { SUMMARY_SPEC_PRIORITIES } from './spec-summary-priorities';

describe('summary spec priorities', () => {
  it('prioritizes camera internal storage before card slot type', () => {
    const storagePriority = SUMMARY_SPEC_PRIORITIES.find(
      (entry) => entry.label === 'Storage'
    );
    if (!storagePriority) {
      expect.fail('expected Storage summary priority');
      return;
    }
    const internalStorageIndex = storagePriority.candidates.findIndex(
      (candidate) =>
        candidate[0] === 'Storage' && candidate[1] === 'Internal Storage'
    );
    const cardSlotIndex = storagePriority.candidates.findIndex(
      (candidate) => candidate[0] === 'Storage' && candidate[1] === 'Card Slot'
    );

    expect(internalStorageIndex).toBeGreaterThanOrEqual(0);
    expect(cardSlotIndex).toBeGreaterThanOrEqual(0);
    expect(internalStorageIndex).toBeLessThan(cardSlotIndex);
  });
});
