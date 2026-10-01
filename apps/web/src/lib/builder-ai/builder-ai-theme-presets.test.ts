import {
  builderDesignCapabilities,
  createBuilderAiModelOperationSchema,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@/lib/color-utils';
import { defaultTheme } from '@/lib/theme-config';
import { applyBuilderAiTheme } from './builder-ai-theme-presets';

describe('applyBuilderAiTheme', () => {
  it.each([
    'modern',
    'minimal',
    'luxury',
    'playful',
    'bold',
    'calm',
  ] as const)('expands the %s preset into a complete accessible theme', (preset) => {
    const result = applyBuilderAiTheme(defaultTheme, { preset });

    expect(result.theme).toHaveProperty('typography.fontFamily.heading');
    expect(
      getContrastRatio(
        result.theme.colors.background,
        result.theme.colors.foreground
      )
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(
        result.theme.colors.primary,
        result.theme.colors.button.primary.text
      )
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('fails closed for unknown presets and inaccessible explicit foreground/background pairs', () => {
    expect(() =>
      applyBuilderAiTheme(defaultTheme, { preset: 'unknown' as never })
    ).toThrow();
    expect(() =>
      applyBuilderAiTheme(defaultTheme, {
        colors: { background: '#ffffff', foreground: '#eeeeee' },
      })
    ).toThrow();
  });

  it('applies only manifest-authorized theme tokens from an injected policy', () => {
    const themeTokenKeys = [
      ...builderDesignCapabilities.themeTokenKeys,
      'surface',
    ];
    const result = applyBuilderAiTheme(
      defaultTheme,
      { colors: { surface: '#123456' } },
      themeTokenKeys
    );

    expect((result.theme.colors as Record<string, unknown>).surface).toBe(
      '#123456'
    );
    expect(() =>
      applyBuilderAiTheme(
        defaultTheme,
        { colors: { undeclared: '#123456' } },
        themeTokenKeys
      )
    ).toThrow('Unknown or invalid base color token');
  });

  it('parses and applies a manifest-added token while rejecting undeclared tokens', () => {
    const manifest = structuredClone(builderDesignCapabilities);
    manifest.themeTokenKeys.push('surface');
    const schema = createBuilderAiModelOperationSchema(manifest);

    expect(
      schema.safeParse({
        colors: { surface: '#123456' },
        kind: 'update_theme',
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        colors: { undeclared: '#123456' },
        kind: 'update_theme',
      }).success
    ).toBe(false);
    expect(
      (
        applyBuilderAiTheme(
          defaultTheme,
          { colors: { surface: '#123456' } },
          manifest.themeTokenKeys
        ).theme.colors as Record<string, unknown>
      ).surface
    ).toBe('#123456');
  });

  it('derives dependent colors instead of accepting model-owned button or footer colors', () => {
    const result = applyBuilderAiTheme(defaultTheme, {
      colors: { primary: '#0047ab' },
    });

    expect(result.theme.colors.button.primary.background).toBe('#0047ab');
    expect(result.theme.colors.button.primary.text).toBe('#FFFFFF');
    expect(result.theme.colors.footer.background).toBe('#0047ab');
  });

  it('rejects invalid hex without echoing the untrusted value', () => {
    expect(() =>
      applyBuilderAiTheme(defaultTheme, {
        colors: { primary: '#bad-value' } as never,
      })
    ).toThrow('Unknown or invalid base color token');
    try {
      applyBuilderAiTheme(defaultTheme, {
        colors: { primary: '#bad-value' } as never,
      });
    } catch (error) {
      expect(error).not.toHaveProperty(
        'message',
        expect.stringContaining('#bad-value')
      );
    }
  });

  it('lets explicit base colors override a visual preset', () => {
    const result = applyBuilderAiTheme(defaultTheme, {
      colors: { primary: '#0047AB' },
      preset: 'modern',
    });

    expect(result.theme.colors.primary).toBe('#0047AB');
  });

  it('does not merge prototype keys from untrusted theme patches', () => {
    const currentTheme = JSON.parse(
      '{"colors":{"__proto__":{"builderAiPolluted":true}}}'
    ) as Record<string, unknown>;

    applyBuilderAiTheme(currentTheme, { colors: { primary: '#0047AB' } });

    expect({}).not.toHaveProperty('builderAiPolluted');
  });

  it('preserves unknown legacy nested theme keys during a valid edit', () => {
    const extension = { source: 'legacy-theme', value: 1 };
    const theme = applyBuilderAiTheme(
      {
        ...defaultTheme,
        colors: { ...defaultTheme.colors, merchantExtension: extension },
      },
      { colors: { primary: '#0047AB' } }
    ).theme;

    expect(theme).toHaveProperty('colors.merchantExtension', extension);
  });

  it('uses WCAG AA text for every derived surface with a mid-gray accent', () => {
    const theme = applyBuilderAiTheme(defaultTheme, {
      colors: { accent: '#7F7F7F' },
    }).theme;

    for (const [background, text] of [
      [theme.colors.background, theme.colors.foreground],
      [
        theme.colors.button.primary.background,
        theme.colors.button.primary.text,
      ],
      [theme.colors.button.accent.background, theme.colors.button.accent.text],
      [theme.colors.card.background, theme.colors.card.text],
      [theme.colors.footer.background, theme.colors.footer.text],
      [theme.colors.header.background, theme.colors.header.text],
      [theme.colors.input.background, theme.colors.input.text],
    ]) {
      expect(getContrastRatio(background, text)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('repairs published primary, accent, and footer interactive contrast pairs', () => {
    const theme = applyBuilderAiTheme(defaultTheme, {
      colors: {
        background: '#000000',
        foreground: '#FFFFFF',
        primary: '#FFFFFF',
      },
    }).theme;

    expect(theme.colors.button.primary.hover).toBe('#FFFFFF');
    expect(theme.colors.footer.linkHoverColor).toBe('#000000');
    for (const [background, text] of [
      [theme.colors.button.primary.hover, theme.colors.button.primary.text],
      [theme.colors.button.accent.hover, theme.colors.button.accent.text],
      [theme.colors.footer.background, theme.colors.footer.linkColor],
      [theme.colors.footer.background, theme.colors.footer.linkHoverColor],
    ]) {
      expect(getContrastRatio(background, text)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    { typography: { fontFamily: { heading: 42 } } },
    { spacing: { header: { height: 42 } } },
    { borders: { radius: { md: 42 } } },
    { shadows: { lg: 42 } },
    { animations: { duration: { normal: 42 } } },
    { layout: { zIndex: { modal: 'top' } } },
    { colors: { muted: 42 } },
  ])('rejects malformed legacy nested theme values: %o', (legacyTheme) => {
    expect(() =>
      applyBuilderAiTheme(legacyTheme, { preset: 'modern' })
    ).toThrow('Invalid builder AI theme configuration');
  });
});
