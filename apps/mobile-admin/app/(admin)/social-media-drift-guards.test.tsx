import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { socialMediaTestHarness as harness } from '../../__tests__/admin/social-media.test-harness';

describe('SocialMediaScreen drift guards', () => {
  beforeEach(() => harness.reset());
  afterEach(() => harness.cleanup());

  it('shows a retry state and no Save when the merchant load errored', () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: null,
      isLoading: false,
      error: new Error('Failed to fetch'),
    });
    harness.render();

    expect(screen.getByText("Couldn't load your settings")).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Instagram Handle')).not.toBeInTheDocument();
  });

  it('shows a retry state when settled with no merchant and cannot write', () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: null,
      isLoading: false,
      error: null,
    });
    harness.render();

    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(harness.mocks.updateMerchantSettings).not.toHaveBeenCalled();
  });

  it('keeps the form editable when cached merchant data exists despite a refetch error', () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: {
        id: 'merchant-social-cached',
        social_media: { instagram: 'cached_insta' },
      },
      isLoading: false,
      error: new Error('Background refetch failed'),
    });
    harness.render();

    expect(screen.getByLabelText('Instagram Handle')).toHaveValue(
      'cached_insta'
    );
    expect(
      screen.queryByText("Couldn't load your settings")
    ).not.toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('disables Save until a handle actually changes so it cannot issue a no-op write', () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: {
        id: 'merchant-social-noop',
        social_media: { instagram: 'insta' },
      },
      isLoading: false,
    });
    harness.render();

    const saveButton = screen.getByText('Save').closest('button');
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton as HTMLButtonElement);
    expect(harness.mocks.updateMerchantSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'insta2' },
    });
    expect(screen.getByText('Save').closest('button')).not.toBeDisabled();
  });
});
