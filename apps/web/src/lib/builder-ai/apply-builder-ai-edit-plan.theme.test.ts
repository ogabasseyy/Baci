import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@/lib/color-utils';
import { defaultTheme } from '@/lib/theme-config';
import {
  applyBuilderAiEditPlan,
  BuilderAiEditPlanError,
} from './apply-builder-ai-edit-plan';

const config: BuilderData = {
  content: [{ props: { id: 'hero', title: 'Welcome' }, type: 'Hero' }],
  root: { title: 'Home' },
  theme: defaultTheme as unknown as Record<string, unknown>,
};

function plan(operation: unknown): BuilderAiProposedPlan {
  return {
    operations: [operation] as BuilderAiProposedPlan['operations'],
    status: 'proposed',
    summary: 'Apply a visual theme',
  };
}

describe('applyBuilderAiEditPlan theme operations', () => {
  it('expands all five base colors into a complete ThemeConfiguration', () => {
    const result = applyBuilderAiEditPlan(
      config,
      plan({
        colors: {
          accent: '#F59E0B',
          background: '#FFFFFF',
          foreground: '#000000',
          primary: '#0047AB',
          secondary: '#F1F5F9',
        },
        kind: 'update_theme',
      })
    );
    const theme = result.candidateConfig
      .theme as unknown as typeof defaultTheme;

    expect(theme.typography.fontFamily.heading).toBeTruthy();
    expect(theme.colors.button.primary).toEqual(
      expect.objectContaining({ background: '#0047AB' })
    );
    expect(
      getContrastRatio(theme.colors.background, theme.colors.foreground)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(theme.colors.primary, theme.colors.button.primary.text)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('fails closed for unknown preset or color tokens and inaccessible explicit pairs', () => {
    for (const operation of [
      { kind: 'update_theme', preset: 'unknown' },
      { colors: { button: '#FFFFFF' }, kind: 'update_theme' },
      {
        colors: { background: '#FFFFFF', foreground: '#EEEEEE' },
        kind: 'update_theme',
      },
    ]) {
      expect(() => applyBuilderAiEditPlan(config, plan(operation))).toThrow();
    }
  });

  it('derives button, header, and footer text colors on visual presets', () => {
    const result = applyBuilderAiEditPlan(
      config,
      plan({ kind: 'update_theme', preset: 'luxury' })
    );
    const theme = result.candidateConfig
      .theme as unknown as typeof defaultTheme;

    expect(theme.colors.button.primary.text).toMatch(/^#[0-9A-F]{6}$/);
    expect(theme.colors.header.text).toBe(theme.colors.foreground);
    expect(theme.colors.footer.text).toBe(theme.colors.button.primary.text);
  });

  it('warns when a theme operation produces no change', () => {
    const first = applyBuilderAiEditPlan(
      config,
      plan({ kind: 'update_theme', preset: 'luxury' })
    );
    const repeated = applyBuilderAiEditPlan(
      first.candidateConfig,
      plan({ kind: 'update_theme', preset: 'luxury' })
    );

    expect(repeated.warnings).toContain('No safe changes for theme.');
  });

  it('wraps internal theme failures in the public edit-plan error', () => {
    expect(() =>
      applyBuilderAiEditPlan(
        config,
        plan({
          colors: { background: '#FFFFFF', foreground: '#EEEEEE' },
          kind: 'update_theme',
        })
      )
    ).toThrow(BuilderAiEditPlanError);
  });
});
