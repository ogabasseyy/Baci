import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

const reservedColorGroups = ['button', 'card', 'footer', 'header', 'input'];
let originalThemeTokenKeys: string[];

function candidate(theme?: unknown) {
  return builderPreviewCandidateConfigSchema.safeParse({
    content: [],
    root: { props: { title: 'Home' } },
    ...(theme === undefined ? {} : { theme }),
  });
}

describe('preview theme policy', () => {
  beforeEach(() => {
    originalThemeTokenKeys = [...builderDesignCapabilities.themeTokenKeys];
  });

  afterEach(() => {
    builderDesignCapabilities.themeTokenKeys.splice(
      0,
      builderDesignCapabilities.themeTokenKeys.length,
      ...originalThemeTokenKeys
    );
    vi.restoreAllMocks();
  });

  it('caches a manifest-derived shape until an in-place token change', () => {
    builderDesignCapabilities.themeTokenKeys.push('cacheProbe');
    const fromEntries = vi.spyOn(Object, 'fromEntries');
    const baseTheme = { colors: { cacheProbe: '#123456' } };

    expect(candidate(baseTheme).success).toBe(true);
    expect(candidate(baseTheme).success).toBe(true);
    expect(fromEntries).toHaveBeenCalledTimes(1);

    builderDesignCapabilities.themeTokenKeys.push('previewSurface');
    expect(candidate({ colors: { previewSurface: '#123456' } }).success).toBe(
      true
    );
    expect(
      candidate({ colors: { previewSurface: 'url(https://bad.test/pixel)' } })
        .success
    ).toBe(false);
    expect(fromEntries).toHaveBeenCalledTimes(2);
  });

  it('does not allocate a theme shape when the candidate supplies no theme', () => {
    const fromEntries = vi.spyOn(Object, 'fromEntries');

    expect(candidate().success).toBe(true);
    expect(fromEntries).not.toHaveBeenCalled();
  });

  it('accepts only the three and six digit hex colors supported by theme projection', () => {
    for (const color of ['#123', '#123456']) {
      expect(candidate({ colors: { primary: color } }).success).toBe(true);
    }
    for (const color of ['#12', '#1234', '#12345', '#1234567', '#12345678']) {
      expect(candidate({ colors: { primary: color } }).success).toBe(false);
    }
  });

  it('rejects reserved manifest token collisions with a clear diagnostic', () => {
    for (const token of reservedColorGroups) {
      builderDesignCapabilities.themeTokenKeys.push(token);
      const result = candidate({ colors: { primary: '#123456' } });

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues[0]?.message).toBe(
          `Preview theme manifest token "${token}" collides with a reserved color group.`
        );
      builderDesignCapabilities.themeTokenKeys.pop();
    }
  });

  it('rejects invalid spacing and easing grammar instead of accepting inert CSS', () => {
    expect(
      candidate({ spacing: { section: { paddingY: 'not-a-length' } } }).success
    ).toBe(false);
    expect(
      candidate({ animations: { easing: { easeIn: 'cubic-bezier(2)' } } })
        .success
    ).toBe(false);
  });

  it('rejects string values that do not match their selected CSS theme field', () => {
    expect(
      candidate({ typography: { fontSize: { base: 'not-a-size' } } }).success
    ).toBe(false);
    expect(
      candidate({ typography: { letterSpacing: { normal: 'bananas' } } })
        .success
    ).toBe(false);
    expect(
      candidate({ borders: { style: { solid: 'bananas' } } }).success
    ).toBe(false);
    expect(candidate({ borders: { width: { normal: '2%' } } }).success).toBe(
      false
    );
    expect(candidate({ shadows: { sm: 'bananas' } }).success).toBe(false);
    expect(
      candidate({ layout: { breakpoints: { sm: 'not-a-breakpoint' } } }).success
    ).toBe(false);
    expect(
      candidate({ typography: { fontSize: { base: 'calc(1rem + bananas)' } } })
        .success
    ).toBe(false);
  });

  it('accepts bounded CSS grammar for each non-color theme string group', () => {
    expect(
      candidate({ typography: { fontFamily: { body: 'Inter, sans-serif' } } })
        .success
    ).toBe(true);
    expect(
      candidate({
        typography: { fontFamily: { body: '"Open Sans", sans-serif' } },
      }).success
    ).toBe(true);
    expect(
      candidate({ typography: { fontSize: { base: '1rem' } } }).success
    ).toBe(true);
    expect(
      candidate({ typography: { fontSize: { base: 'calc(1rem + 2px)' } } })
        .success
    ).toBe(true);
    expect(
      candidate({ typography: { letterSpacing: { tight: '-0.025em' } } })
        .success
    ).toBe(true);
    expect(candidate({ borders: { style: { solid: 'solid' } } }).success).toBe(
      true
    );
    expect(candidate({ borders: { width: { normal: '2px' } } }).success).toBe(
      true
    );
    expect(
      candidate({ borders: { width: { normal: 'calc(1px + 1px)' } } }).success
    ).toBe(true);
    expect(candidate({ borders: { radius: { full: '9999px' } } }).success).toBe(
      true
    );
    expect(
      candidate({ shadows: { sm: '0 1px 2px rgb(0 0 0 / 0.05)' } }).success
    ).toBe(true);
    expect(
      candidate({ layout: { breakpoints: { sm: '640px' } } }).success
    ).toBe(true);
    expect(candidate({ spacing: { md: '1rem' } }).success).toBe(true);
    expect(
      candidate({ spacing: { md: 'clamp(1rem, 2vw, 3rem)' } }).success
    ).toBe(true);
    expect(
      candidate({ animations: { duration: { fast: '150ms' } } }).success
    ).toBe(true);
    expect(
      candidate({ animations: { easing: { easeIn: 'ease-in' } } }).success
    ).toBe(true);
  });

  it('rejects color variables outside the defined theme token set', () => {
    expect(
      candidate({ colors: { primary: 'var(--theme-not-defined)' } }).success
    ).toBe(false);
    expect(
      candidate({ colors: { secondary: 'var(--theme-primary)' } }).success
    ).toBe(true);
  });

  it('accepts only store tokens emitted by the preview theme projection', () => {
    for (const token of [
      'accent',
      'accent-text',
      'background',
      'background-text',
      'border',
      'foreground',
      'on-primary',
      'option-secondary',
      'primary',
      'primary-text',
      'rating',
      'secondary',
      'secondary-text',
    ]) {
      expect(
        candidate({
          colors: {
            [token === 'secondary' ? 'primary' : 'secondary']:
              `var(--store-${token})`,
          },
        }).success
      ).toBe(true);
    }

    expect(
      candidate({ colors: { primary: 'var(--store-not-defined)' } }).success
    ).toBe(false);
  });

  it('rejects colors that directly reference their own emitted store token', () => {
    expect(
      candidate({ colors: { primary: 'var(--store-primary)' } }).success
    ).toBe(false);
    expect(
      candidate({ colors: { background: 'var(--store-background)' } }).success
    ).toBe(false);
  });

  it('rejects indirect cycles among emitted store color tokens', () => {
    expect(
      candidate({
        colors: {
          button: { secondary: { background: 'var(--store-primary)' } },
          primary: 'var(--store-secondary)',
        },
      }).success
    ).toBe(false);
  });

  it('rejects direct and indirect cycles among emitted theme color tokens', () => {
    expect(
      candidate({ colors: { primary: 'var(--theme-primary)' } }).success
    ).toBe(false);
    expect(
      candidate({
        colors: {
          primary: 'var(--theme-secondary)',
          secondary: 'var(--theme-primary)',
        },
      }).success
    ).toBe(false);
  });

  it('enforces the CSS domains for theme number fields', () => {
    expect(
      candidate({ typography: { fontWeight: { normal: 1 } } }).success
    ).toBe(true);
    expect(
      candidate({ typography: { fontWeight: { normal: 1_000 } } }).success
    ).toBe(true);
    expect(
      candidate({ typography: { fontWeight: { normal: 0 } } }).success
    ).toBe(false);
    expect(
      candidate({ typography: { fontWeight: { normal: 1_001 } } }).success
    ).toBe(false);

    expect(
      candidate({ typography: { lineHeight: { normal: 1.5 } } }).success
    ).toBe(true);
    expect(
      candidate({ typography: { lineHeight: { normal: 0 } } }).success
    ).toBe(false);

    expect(candidate({ layout: { zIndex: { modal: 10 } } }).success).toBe(true);
    expect(candidate({ layout: { zIndex: { modal: 1.5 } } }).success).toBe(
      false
    );
  });
});
