import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gamingSelectionPreviewPersistence } from './gaming-selection-preview-persistence';

const key = 'jumia-gaming-preview:merchant-persistence:category-1';
const older = {
  selectionId: '00000000-0000-4000-8000-000000000031',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const newer = {
  selectionId: '00000000-0000-4000-8000-000000000032',
  expiresAt: '2099-02-01T00:00:00.000Z',
};

describe('Gaming selection preview persistence', () => {
  beforeEach(() => localStorage.clear());

  it('does not evict a newer snapshot when an older request is rejected', async () => {
    gamingSelectionPreviewPersistence.write(key, older);
    let rejectOldRequest!: (error: Error) => void;
    const load = gamingSelectionPreviewPersistence.loadFirstValid(
      'merchant-persistence',
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOldRequest = reject;
        })
    );
    await vi.waitFor(() => expect(rejectOldRequest).toBeTypeOf('function'));
    gamingSelectionPreviewPersistence.write(key, newer);
    rejectOldRequest(
      Object.assign(new Error('Selection is no longer available'), {
        status: 410,
      })
    );

    await expect(load).resolves.toBe(false);
    expect(gamingSelectionPreviewPersistence.read(key)).toEqual(newer);
  });

  it('keeps a usable in-memory cache when persistence fails and reports the failure', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage quota exceeded');
    });

    expect(gamingSelectionPreviewPersistence.write(key, newer)).toBe(false);
    expect(gamingSelectionPreviewPersistence.read(key)).toEqual(newer);
  });

  it('separates acknowledged unpersisted success from an older cache entry', () => {
    gamingSelectionPreviewPersistence.write(key, older);

    expect(
      gamingSelectionPreviewPersistence.findKnownSuccessfulSelection(
        'merchant-persistence'
      )
    ).toBeNull();
    gamingSelectionPreviewPersistence.rememberKnownSuccessfulSelection(
      'merchant-persistence',
      key,
      newer
    );

    expect(
      gamingSelectionPreviewPersistence.findKnownSuccessfulSelection(
        'merchant-persistence'
      )
    ).toEqual({ cacheKey: key, selection: newer });
    gamingSelectionPreviewPersistence.clearKnownSuccessfulSelection(
      'merchant-persistence'
    );
    expect(
      gamingSelectionPreviewPersistence.findKnownSuccessfulSelection(
        'merchant-persistence'
      )
    ).toBeNull();
  });
});
