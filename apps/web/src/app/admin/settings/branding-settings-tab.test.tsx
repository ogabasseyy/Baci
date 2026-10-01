import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '@/components/ui/tabs';
import { BrandingSettingsTab } from './branding-settings-tab';
import { settingsResponse } from './settings-test-fixture';
import type { PlatformSettingsUpdater } from './settings-types';

describe('BrandingSettingsTab', () => {
  it('keeps platform names as strings while clearing optional contact values to null', () => {
    const onSettingChange = vi.fn() as PlatformSettingsUpdater;

    render(
      <Tabs defaultValue="branding">
        <BrandingSettingsTab
          settings={settingsResponse}
          onSettingChange={onSettingChange}
        />
      </Tabs>
    );

    fireEvent.change(screen.getByLabelText('Platform Name'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Support Email'), {
      target: { value: '' },
    });

    expect(onSettingChange).toHaveBeenNthCalledWith(1, 'platform_name', '');
    expect(onSettingChange).toHaveBeenNthCalledWith(2, 'support_email', null);
  });
});
