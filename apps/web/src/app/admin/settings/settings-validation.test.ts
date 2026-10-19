import { describe, expect, it } from 'vitest';
import { EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS } from './settings-payload';
import { settingsResponse } from './settings-test-fixture';
import { validatePlatformSettingsForm } from './settings-validation';

describe('validatePlatformSettingsForm', () => {
  it('returns field errors for invalid editable settings before a network request', () => {
    const result = validatePlatformSettingsForm(
      { ...settingsResponse, platform_name: '', support_email: 'not-an-email' },
      EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS
    );

    expect(result).toEqual({
      errors: expect.objectContaining({
        platform_name: expect.any(Array),
        support_email: expect.any(Array),
      }),
      success: false,
    });
  });

  it('returns the secret-safe payload for valid settings', () => {
    const result = validatePlatformSettingsForm(
      settingsResponse,
      EMPTY_PLATFORM_SETTINGS_SECRET_INPUTS
    );

    expect(result).toMatchObject({
      payload: expect.not.objectContaining({
        ga4_api_secret: expect.anything(),
      }),
      success: true,
    });
  });
});
