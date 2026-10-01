import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { socialMediaTestHarness as harness } from '../../__tests__/admin/social-media.test-harness';

describe('SocialMediaScreen core behaviour', () => {
  beforeEach(() => harness.reset());
  afterEach(() => harness.cleanup());

  it('renders loading skeleton when merchant data is loading', () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: null,
      isLoading: true,
    });

    harness.render();

    expect(screen.getByTestId('screen-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('stack-screen')).toHaveAttribute(
      'data-title',
      'Social Media'
    );
  });

  it('renders all social media inputs and populates values', () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: {
        id: 'merchant-1',
        social_media: { instagram: 'baci_insta', twitter: 'baci_tweets' },
      },
      isLoading: false,
    });

    harness.render();

    expect(screen.getByText('Social Profiles')).toBeInTheDocument();
    expect(screen.getByLabelText('Instagram Handle')).toHaveValue('baci_insta');
    expect(screen.getByLabelText('Twitter/X Handle')).toHaveValue(
      'baci_tweets'
    );
    expect(screen.getByLabelText('Facebook URL')).toHaveValue('');
  });

  it('re-seeds form values when merchant social media changes', () => {
    let socialMedia = { instagram: 'initial_insta', twitter: 'initial_tweets' };
    harness.mocks.useMerchant.mockImplementation(() => ({
      merchant: { id: 'merchant-social-reseed', social_media: socialMedia },
      isLoading: false,
    }));

    const rendered = harness.render();
    expect(screen.getByLabelText('Instagram Handle')).toHaveValue(
      'initial_insta'
    );
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'draft_insta' },
    });

    socialMedia = { instagram: 'server_insta', twitter: 'server_tweets' };
    rendered.rerender(<harness.Component />);
    expect(screen.getByLabelText('Instagram Handle')).toHaveValue(
      'server_insta'
    );
    expect(screen.getByLabelText('Twitter/X Handle')).toHaveValue(
      'server_tweets'
    );
  });

  it('calls save mutation and handles success flow', async () => {
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
      expect(harness.mocks.updateMerchantSettings).toHaveBeenCalledWith(
        'merchant-1',
        {
          social_media: expect.objectContaining({ instagram: 'new_insta' }),
        }
      )
    );
    await waitFor(() =>
      expect(harness.mocks.alert).toHaveBeenCalledWith(
        'Success',
        'Social media links updated',
        expect.any(Array)
      )
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('returns to the checklist without a success alert after a checklist save', async () => {
    harness.mocks.routeParams = { from: 'setup' };
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

    await waitFor(() => expect(harness.mocks.back).toHaveBeenCalledTimes(1));
    expect(harness.mocks.alert).not.toHaveBeenCalledWith(
      'Success',
      expect.any(String),
      expect.any(Array)
    );
  });

  it('handles save errors gracefully', async () => {
    harness.mocks.useMerchant.mockReturnValue({
      merchant: {
        id: 'merchant-social-error',
        social_media: { instagram: 'insta' },
      },
      isLoading: false,
    });
    harness.mocks.updateMerchantSettings.mockRejectedValueOnce(
      new Error('Unable to save social links')
    );

    harness.render();
    fireEvent.change(screen.getByLabelText('Instagram Handle'), {
      target: { value: 'insta_changed' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(harness.mocks.alert).toHaveBeenCalledWith(
        'Error',
        'Unable to save social links'
      )
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(harness.mocks.invalidateStoreReadiness).not.toHaveBeenCalled();
  });
});
