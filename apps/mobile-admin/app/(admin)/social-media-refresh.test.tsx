import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { socialMediaTestHarness as harness } from '../../__tests__/admin/social-media.test-harness';

describe('SocialMediaScreen refresh resilience', () => {
  beforeEach(() => harness.reset());
  afterEach(() => harness.cleanup());

  it('waits for merchant and readiness invalidation before presenting success', async () => {
    let releaseReadiness!: () => void;
    harness.mocks.invalidateStoreReadiness.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseReadiness = resolve;
      })
    );
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: { instagram: 'old_insta' } },
      isLoading: false,
    });
    harness.mocks.updateMerchantSettings.mockResolvedValueOnce({});

    harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'new_insta' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(harness.mocks.invalidateStoreReadiness).toHaveBeenCalledWith(
        expect.anything(),
        'merchant-1'
      )
    );
    expect(harness.mocks.alert).not.toHaveBeenCalledWith(
      'Success',
      expect.any(String),
      expect.any(Array)
    );
    releaseReadiness();
    await waitFor(() =>
      expect(harness.mocks.alert).toHaveBeenCalledWith(
        'Success',
        'Social media links updated',
        expect.any(Array)
      )
    );
  });

  it('preserves save success when only the readiness refresh fails', async () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: { instagram: 'insta' } },
      isLoading: false,
    });
    harness.mocks.updateMerchantSettings.mockResolvedValueOnce({});
    harness.mocks.invalidateStoreReadiness.mockRejectedValueOnce(
      new Error('Readiness refresh failed')
    );

    harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'insta_changed' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(harness.mocks.alert).toHaveBeenCalledWith(
        'Success',
        'Social media links updated',
        expect.any(Array)
      )
    );
    expect(harness.mocks.alert).not.toHaveBeenCalledWith(
      'Error',
      expect.any(String)
    );
  });

  it('preserves save success when merchant invalidation rejects after a successful save', async () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: { instagram: 'insta' } },
      isLoading: false,
    });
    harness.mocks.updateMerchantSettings.mockResolvedValueOnce({});
    harness.mocks.invalidateQueries.mockRejectedValueOnce(
      new Error('Merchant refresh failed')
    );

    harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'insta_changed' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(harness.mocks.alert).toHaveBeenCalledWith(
        'Success',
        'Social media links updated',
        expect.any(Array)
      )
    );
    expect(harness.mocks.alert).not.toHaveBeenCalledWith(
      'Error',
      'Merchant refresh failed'
    );
  });
});
