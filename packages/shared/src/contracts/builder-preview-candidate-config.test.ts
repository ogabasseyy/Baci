import { describe, expect, it } from 'vitest';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

const curatedTheme = {
  animations: {
    duration: { fast: '150ms', normal: '300ms', slow: '500ms' },
    easing: {
      easeIn: 'ease-in',
      easeInOut: 'ease-in-out',
      easeOut: 'ease-out',
      linear: 'linear',
    },
  },
  borders: {
    radius: {
      '2xl': '1.5rem',
      full: '9999px',
      lg: '0.75rem',
      md: '0.5rem',
      none: '0',
      sm: '0.25rem',
      xl: '1rem',
    },
    style: { dashed: 'dashed', dotted: 'dotted', solid: 'solid' },
    width: { none: '0', normal: '2px', thick: '4px', thin: '1px' },
  },
  colors: {
    accent: '#FFC107',
    background: '#FFFFFF',
    border: '#E0E0E0',
    foreground: '#000000',
    muted: '#F5F5F5',
    mutedForeground: '#000000',
    primary: '#3F51B5',
    secondary: '#F5F5F5',
    button: {
      accent: { background: '#FFC107', hover: '#FFC107', text: '#000000' },
      primary: { background: '#3F51B5', hover: '#3F51B5', text: '#FFFFFF' },
      secondary: { background: '#F5F5F5', hover: '#F5F5F5', text: '#000000' },
    },
    card: { background: '#FFFFFF', border: '#E0E0E0', text: '#000000' },
    footer: {
      background: '#3F51B5',
      linkColor: '#FFFFFF',
      linkHoverColor: '#FFFFFF',
      text: '#FFFFFF',
    },
    header: {
      background: '#FFFFFF',
      iconColor: '#000000',
      searchBackground: '#FFFFFF',
      searchBorder: '#3F51B5',
      text: '#000000',
    },
    input: {
      background: '#FFFFFF',
      border: '#E0E0E0',
      focusBorder: '#3F51B5',
      placeholder: '#999999',
      text: '#000000',
    },
  },
  layout: {
    breakpoints: {
      '2xl': '1536px',
      lg: '1024px',
      md: '768px',
      sm: '640px',
      xl: '1280px',
    },
    zIndex: {
      dropdown: 1000,
      fixed: 1030,
      modal: 1050,
      modalBackdrop: 1040,
      popover: 1060,
      sticky: 1020,
      tooltip: 1070,
    },
  },
  shadows: {
    '2xl': '0 25px 50px rgb(0 0 0 / .25)',
    inner: 'inset 0 2px 4px rgb(0 0 0 / .05)',
    lg: '0 10px 15px rgb(0 0 0 / .1)',
    md: '0 4px 6px rgb(0 0 0 / .1)',
    none: 'none',
    sm: '0 1px 2px rgb(0 0 0 / .05)',
    xl: '0 20px 25px rgb(0 0 0 / .1)',
  },
  spacing: {
    '2xl': '3rem',
    '3xl': '4rem',
    lg: '1.5rem',
    md: '1rem',
    sm: '0.5rem',
    xl: '2rem',
    xs: '0.25rem',
    container: { maxWidth: '1280px', paddingX: '1rem' },
    footer: { paddingX: '1rem', paddingY: '3rem' },
    header: { height: '4rem', paddingX: '1rem', paddingY: '0.5rem' },
    section: { paddingX: '1rem', paddingY: '3rem' },
  },
  typography: {
    fontFamily: {
      body: 'Inter, sans-serif',
      heading: 'Inter, sans-serif',
      mono: 'Menlo, monospace',
    },
    fontSize: {
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
      '5xl': '3rem',
      '6xl': '3.75rem',
      base: '1rem',
      lg: '1.125rem',
      sm: '0.875rem',
      xl: '1.25rem',
      xs: '0.75rem',
    },
    fontWeight: {
      bold: 700,
      extrabold: 800,
      light: 300,
      medium: 500,
      normal: 400,
      semibold: 600,
    },
    letterSpacing: { normal: '0', tight: '-0.025em', wide: '0.025em' },
    lineHeight: { loose: 2, normal: 1.5, relaxed: 1.75, tight: 1.25 },
  },
};

describe('builder preview candidate configuration', () => {
  it('accepts the complete bounded shape emitted by the curated storefront', () => {
    const result = builderPreviewCandidateConfigSchema.safeParse({
      content: [],
      root: { props: { title: 'Home' } },
      theme: curatedTheme,
      zones: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unbound legacy Puck zone that the preview cannot mount', () => {
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [],
        root: { props: { title: 'Home' } },
        zones: { aside: [] },
      }).success
    ).toBe(false);
  });

  it('normalizes the minimal client fallback root title into Puck root props', () => {
    const result = builderPreviewCandidateConfigSchema.safeParse({
      content: [],
      root: { title: 'Mobile storefront' },
    });

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.root).toEqual({
        props: { title: 'Mobile storefront' },
      });
  });

  it('normalizes a supported root title while discarding unrelated legacy metadata', () => {
    const result = builderPreviewCandidateConfigSchema.safeParse({
      content: [],
      root: { legacyRootFlag: true, title: 'Home' },
    });

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.root).toEqual({ props: { title: 'Home' } });
  });

  it('does not discard sensitive legacy root metadata during normalization', () => {
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        content: [],
        root: { apiKey: 'must-not-survive', title: 'Home' },
      }).success
    ).toBe(false);
  });

  it('normalizes empty persisted Puck roots to a safe default title', () => {
    for (const root of [{}, { props: {} }]) {
      const result = builderPreviewCandidateConfigSchema.safeParse({
        content: [],
        root,
      });

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data.root).toEqual({ props: { title: 'Home' } });
    }
  });

  it('normalizes the supported update_root output without accepting hybrid roots', () => {
    const result = builderPreviewCandidateConfigSchema.safeParse({
      content: [],
      root: { title: 'Updated storefront' },
    });

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.root).toEqual({
        props: { title: 'Updated storefront' },
      });
    const hybrid = builderPreviewCandidateConfigSchema.safeParse({
      content: [],
      root: { props: { title: 'Home' }, title: 'Hybrid root' },
    });
    expect(hybrid.success).toBe(true);
    if (hybrid.success)
      expect(hybrid.data.root).toEqual({ props: { title: 'Hybrid root' } });
  });

  it('normalizes hybrid roots preserved by update_root into canonical props', () => {
    const result = builderPreviewCandidateConfigSchema.safeParse({
      content: [],
      root: { props: { title: 'Old' }, title: 'Updated storefront' },
    });

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.root).toEqual({
        props: { title: 'Updated storefront' },
      });
  });

  it('accepts a bounded partial theme while rejecting hostile or unknown supplied keys', () => {
    const candidate = {
      content: [],
      root: { props: { title: 'Home' } },
    };

    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        ...candidate,
        theme: { colors: { background: '#14532d', primary: '#166534' } },
      }).success
    ).toBe(true);
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        ...candidate,
        theme: { colors: { background: 'rgb(20 83 45)' } },
      }).success
    ).toBe(false);
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        ...candidate,
        theme: { colors: { primary: '#14532d', unreviewed: '#ffffff' } },
      }).success
    ).toBe(false);
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        ...candidate,
        theme: {
          colors: { background: 'url(https://bad.test/pixel)' },
        },
      }).success
    ).toBe(false);
    expect(
      builderPreviewCandidateConfigSchema.safeParse({
        ...candidate,
        theme: {
          colors: { primary: 'red; background: url(https://bad.test)' },
        },
      }).success
    ).toBe(false);
  });
});
