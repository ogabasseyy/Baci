import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { socialMediaTestHarness as harness } from './social-media.test-harness';

describe('SocialMediaScreen merchant-switch save lifecycle', () => {
  beforeEach(() => harness.reset());
  afterEach(() => harness.cleanup());

  it('does not disable merchant B save while merchant A social links are saving', async () => {
    let activeMerchantId = 'merchant-a';
    let resolveSave!: () => void;
    harness.mocks.useMerchant.mockImplementation(() => ({
      merchant: {
        id: activeMerchantId,
        social_media: { instagram: `${activeMerchantId}-instagram` },
      },
      isLoading: false,
    }));
    harness.mocks.updateMerchantSettings.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );

    const rendered = harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'merchant-a-updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(harness.mocks.updateMerchantSettings).toHaveBeenCalledWith(
        'merchant-a',
        expect.anything()
      )
    );
    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await act(async () => {
      activeMerchantId = 'merchant-b';
      rendered.rerender(<harness.Component />);
    });
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'merchant-b-updated' },
    });

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    await act(async () => {
      resolveSave();
      await harness.mocks.lastMutation;
    });
  });
});
