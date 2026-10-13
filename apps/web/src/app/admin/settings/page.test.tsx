import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformSettingsResponse } from '@/app/api/admin/settings/route';
import PlatformSettingsPage from './page';
import { settingsResponse } from './settings-test-fixture';

const mocks = vi.hoisted(() => ({
  apiPut: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/lib/api-client', () => ({
  apiPut: mocks.apiPut,
}));

describe('PlatformSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.toast.mockClear();
    mocks.apiPut.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => settingsResponse,
        ok: true,
      })
    );
  });

  it('uses specific accessible names for secret visibility toggles', async () => {
    render(<PlatformSettingsPage />);

    expect(
      await screen.findByRole('button', { name: 'Show GA4 API secret' })
    ).toBeInTheDocument();
  });

  it('updates the secret toggle accessible name when visibility changes', async () => {
    render(<PlatformSettingsPage />);

    const ga4Toggle = await screen.findByRole('button', {
      name: 'Show GA4 API secret',
    });

    expect(
      screen.getByRole('button', {
        name: 'Show Facebook Conversions API token',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show TikTok Events API token' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Show Snapchat Conversions API token',
      })
    ).toBeInTheDocument();

    fireEvent.click(ga4Toggle);

    expect(
      screen.getByRole('button', { name: 'Hide GA4 API secret' })
    ).toBeInTheDocument();
  });

  it('announces initial loading and save progress', async () => {
    let resolveSave!: (value: PlatformSettingsResponse) => void;
    mocks.apiPut.mockReturnValue(
      new Promise<PlatformSettingsResponse>((resolve) => {
        resolveSave = resolve;
      })
    );

    render(<PlatformSettingsPage />);

    expect(
      screen.getByText('Loading platform settings...')
    ).toBeInTheDocument();

    const saveButton = await screen.findByRole('button', {
      name: /save changes/i,
    });
    expect(saveButton).toHaveAttribute('aria-busy', 'false');

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveButton).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Saving platform settings.'
      );
    });

    resolveSave(settingsResponse);
  });

  it('shows the load failure state when settings cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ error: 'Failed to load settings' }),
        ok: false,
      })
    );

    render(<PlatformSettingsPage />);

    expect(
      await screen.findByText(
        'Failed to load settings. Please try refreshing the page.'
      )
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to load platform settings.',
        variant: 'destructive',
      });
    });
  });

  it('does not expose persisted-only feature switches as working controls', async () => {
    render(<PlatformSettingsPage />);

    await screen.findByRole('button', { name: 'Show GA4 API secret' });

    expect(screen.getByRole('tab', { name: /branding/i })).toBeInTheDocument();
    expect(screen.queryByText('Feature Flags')).not.toBeInTheDocument();
    expect(screen.queryByText('Maintenance Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Merchant Signups')).not.toBeInTheDocument();
  });

  it('reports editable field errors before sending an invalid settings update', async () => {
    const user = userEvent.setup();
    render(<PlatformSettingsPage />);

    await user.click(await screen.findByRole('tab', { name: 'Branding' }));
    fireEvent.change(await screen.findByLabelText('Platform Name'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('platform_name');
    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Fix validation errors',
      description: 'Review the highlighted settings and try again.',
      variant: 'destructive',
    });
  });

  it('uses the branding tab trigger to reveal branding settings', async () => {
    const user = userEvent.setup();
    render(<PlatformSettingsPage />);

    await user.click(await screen.findByRole('tab', { name: 'Branding' }));

    expect(await screen.findByLabelText('Platform Name')).toBeVisible();
  });
});
