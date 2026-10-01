import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { socialMediaTestHarness as harness } from '../../__tests__/admin/social-media.test-harness';

describe('SocialMediaScreen merchant lifecycle', () => {
  beforeEach(() => harness.reset());
  afterEach(() => harness.cleanup());

  it('clears an unsaved draft when switching to a different merchant with identical social media', () => {
    let merchant = { id: 'merchant-1', social_media: {} };
    harness.mocks.useMerchant.mockImplementation(() => ({
      merchant,
      isLoading: false,
    }));

    const rendered = harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'merchant_one_draft' },
    });
    merchant = { id: 'merchant-2', social_media: {} };
    rendered.rerender(<harness.Component />);

    expect(screen.getByLabelText('Instagram Handle')).toHaveValue('');
    fireEvent.click(screen.getByText('Save'));
    expect(harness.mocks.updateMerchantSettings).not.toHaveBeenCalled();
  });

  it('refreshes the saved merchant cache when the user returns after switching away', async () => {
    let resolveSave!: () => void;
    harness.mocks.routeParams = { from: 'setup' };
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: { instagram: 'old_insta' } },
      isLoading: false,
    });
    harness.mocks.updateMerchantSettings.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );

    const rendered = harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'new_insta' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(harness.mocks.updateMerchantSettings).toHaveBeenCalledTimes(1)
    );

    harness.mocks.useMerchant.mockReturnValue({
      merchant: {
        id: 'merchant-2',
        social_media: { instagram: 'second_merchant' },
      },
      isLoading: false,
    });
    rendered.rerender(<harness.Component />);
    await act(async () => {
      resolveSave();
      await harness.mocks.lastMutation;
    });
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: { instagram: 'new_insta' } },
      isLoading: false,
    });
    rendered.rerender(<harness.Component />);

    expect(harness.mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant'],
    });
    expect(harness.mocks.invalidateStoreReadiness).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1'
    );
    expect(harness.mocks.back).not.toHaveBeenCalled();
    expect(harness.mocks.alert).not.toHaveBeenCalled();
  });

  it('does not navigate after the merchant switches during readiness invalidation', async () => {
    let releaseReadiness!: () => void;
    harness.mocks.invalidateStoreReadiness.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseReadiness = resolve;
      })
    );
    harness.mocks.routeParams = { from: 'setup' };
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: { instagram: 'old_insta' } },
      isLoading: false,
    });
    harness.mocks.updateMerchantSettings.mockResolvedValueOnce({});

    const rendered = harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'new_insta' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(harness.mocks.invalidateStoreReadiness).toHaveBeenCalledTimes(1)
    );
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-2', social_media: {} },
      isLoading: false,
    });
    rendered.rerender(<harness.Component />);
    await act(async () => {
      releaseReadiness();
      await harness.mocks.lastMutation;
    });

    expect(harness.mocks.back).not.toHaveBeenCalled();
    expect(harness.mocks.alert).not.toHaveBeenCalled();
  });

  it('does not show a save error after the merchant switches during an in-flight save', async () => {
    let rejectSave!: (error: Error) => void;
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-1', social_media: { instagram: 'old_insta' } },
      isLoading: false,
    });
    harness.mocks.updateMerchantSettings.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        })
    );

    const rendered = harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'new_insta' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(harness.mocks.updateMerchantSettings).toHaveBeenCalledTimes(1)
    );
    harness.mocks.useMerchant.mockReturnValue({
      merchant: { id: 'merchant-2', social_media: {} },
      isLoading: false,
    });
    rendered.rerender(<harness.Component />);
    await act(async () => {
      rejectSave(new Error('Save failed'));
      await harness.mocks.lastMutation;
    });

    expect(harness.mocks.alert).not.toHaveBeenCalled();
  });

  it('still refreshes merchant data when success settles without merchant context', async () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: null,
      isLoading: false,
    });
    harness.render();
    const mutationOptions = harness.mocks.useMutation.mock.calls[0]?.[0] as
      | { onSuccess?: (data: unknown) => Promise<void> }
      | undefined;

    await expect(mutationOptions?.onSuccess?.({})).resolves.toBeUndefined();
    expect(harness.mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant'],
    });
    expect(harness.mocks.invalidateStoreReadiness).not.toHaveBeenCalled();
  });
});
