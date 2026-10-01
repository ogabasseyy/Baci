import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '@/components/ui/tabs';
import { FeesSettingsTab } from './fees-settings-tab';
import { settingsResponse } from './settings-test-fixture';
import type { PlatformSettingsUpdater } from './settings-types';

describe('FeesSettingsTab', () => {
  it('updates the platform percentage and shows the matching calculator preview', () => {
    const onSettingChange = vi.fn() as PlatformSettingsUpdater;

    render(
      <Tabs defaultValue="fees">
        <FeesSettingsTab
          settings={settingsResponse}
          onSettingChange={onSettingChange}
        />
      </Tabs>
    );

    fireEvent.change(screen.getByLabelText('Platform Fee (%)'), {
      target: { value: '3.5' },
    });

    expect(onSettingChange).toHaveBeenCalledWith(
      'platform_fee_percentage',
      3.5
    );
    expect(screen.getByText('₦250.00')).toBeInTheDocument();
    expect(screen.getByText('₦150.00')).toBeInTheDocument();
    expect(screen.getByText('₦9600.00')).toBeInTheDocument();
  });
});
