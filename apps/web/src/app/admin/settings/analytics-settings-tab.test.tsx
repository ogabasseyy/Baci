import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '@/components/ui/tabs';
import { AnalyticsSettingsTab } from './analytics-settings-tab';
import { EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS } from './settings-payload';
import { settingsResponse } from './settings-test-fixture';
import type { PlatformSettingsUpdater } from './settings-types';

describe('AnalyticsSettingsTab', () => {
  it('retains the stored-secret guidance and visibility controls for each provider', () => {
    const onToggleSecret = vi.fn();

    render(
      <Tabs defaultValue="analytics">
        <AnalyticsSettingsTab
          settings={settingsResponse}
          secretInputs={EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS}
          showSecrets={{}}
          onSettingChange={vi.fn() as PlatformSettingsUpdater}
          onSecretChange={vi.fn()}
          onToggleSecret={onToggleSecret}
        />
      </Tabs>
    );

    expect(
      screen.getByText(
        'GA4 API secret is already stored. Leave this blank to keep the current value.'
      )
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Show GA4 API secret' })
    );

    expect(onToggleSecret).toHaveBeenCalledWith('ga4_secret');
  });
});
