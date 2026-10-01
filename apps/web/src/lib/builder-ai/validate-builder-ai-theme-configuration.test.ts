import { describe, expect, it } from 'vitest';
import { defaultTheme } from '@/lib/theme-config';
import { validateBuilderAiThemeConfiguration } from './validate-builder-ai-theme-configuration';

describe('validateBuilderAiThemeConfiguration', () => {
  it('accepts the complete canonical theme and rejects incomplete nested configuration', () => {
    expect(validateBuilderAiThemeConfiguration(defaultTheme)).toEqual(
      defaultTheme
    );
    expect(
      validateBuilderAiThemeConfiguration({ ...defaultTheme, colors: {} })
    ).toBeUndefined();
  });
});
