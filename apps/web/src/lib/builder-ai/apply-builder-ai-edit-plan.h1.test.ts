import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { applyBuilderAiEditPlan } from './apply-builder-ai-edit-plan';

const legacyH1Config: BuilderData = {
  content: [
    { props: { id: 'legacy-hero', title: 'Welcome' }, type: 'Hero' },
    { props: { id: 'copy', title: 'About' }, type: 'Text' },
  ],
  root: { title: 'Home' },
};

describe('applyBuilderAiEditPlan legacy Hero heading semantics', () => {
  it.each([
    undefined,
    null,
    '',
  ])('does not remove the last renderer-defaulted H1 with headingLevel %o', (headingLevel) => {
    const config: BuilderData = {
      ...legacyH1Config,
      content: [
        {
          props: {
            id: 'legacy-hero',
            ...(headingLevel === undefined ? {} : { headingLevel }),
            title: 'Welcome',
          },
          type: 'Hero',
        },
        legacyH1Config.content[1],
      ],
    };
    const plan: BuilderAiProposedPlan = {
      operations: [{ componentId: 'legacy-hero', kind: 'remove_component' }],
      status: 'proposed',
      summary: 'Remove the hero',
    };

    expect(() => applyBuilderAiEditPlan(config, plan)).toThrow(
      'Cannot remove the final H1 Hero'
    );
  });

  it('does not remove the final rendered H1 stored in a zone', () => {
    const config: BuilderData = {
      content: [],
      root: { title: 'Home' },
      zones: {
        aside: [{ props: { id: 'zone-hero', title: 'Welcome' }, type: 'Hero' }],
      },
    };
    const plan: BuilderAiProposedPlan = {
      operations: [{ componentId: 'zone-hero', kind: 'remove_component' }],
      status: 'proposed',
      summary: 'Remove the hero',
    };

    expect(() => applyBuilderAiEditPlan(config, plan)).toThrow(
      'Cannot remove the final H1 Hero'
    );
  });
});
