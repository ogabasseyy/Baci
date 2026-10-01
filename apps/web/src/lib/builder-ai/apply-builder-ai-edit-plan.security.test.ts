import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyBuilderAiEditPlan,
  BuilderAiEditPlanError,
} from './apply-builder-ai-edit-plan';

const config: BuilderData = {
  content: [
    { props: { id: 'header' }, type: 'Header' },
    { props: { id: 'hero', title: 'Original' }, type: 'Hero' },
    { props: { id: 'footer' }, type: 'Footer' },
  ],
  root: { title: 'Home' },
};

function plan(
  operations: BuilderAiProposedPlan['operations']
): BuilderAiProposedPlan {
  return { operations, status: 'proposed', summary: 'Safe request' };
}

describe('applyBuilderAiEditPlan security', () => {
  it('rejects missing targets, duplicate ids, unknown destinations, and non-allowlisted components', () => {
    const invalidPlans = [
      plan([{ componentId: 'missing', kind: 'remove_component' }]),
      plan([
        {
          componentId: 'hero',
          destination: { componentId: 'missing', position: 'after' },
          kind: 'move_component',
        },
      ]),
      plan([
        {
          initialContent: { componentType: 'CodeEmbed', code: '<script>' },
          kind: 'insert_component',
          placement: { position: 'first_content' },
        },
      ] as unknown as BuilderAiProposedPlan['operations']),
      plan([
        {
          componentId: 'hero',
          kind: 'update_component',
          patch: { componentType: 'Image', title: 'Not allowed' },
        },
      ] as unknown as BuilderAiProposedPlan['operations']),
    ];
    const duplicateConfig = {
      ...config,
      content: [...config.content, { props: { id: 'hero' }, type: 'Text' }],
    };

    for (const invalidPlan of invalidPlans) {
      expect(() => applyBuilderAiEditPlan(config, invalidPlan)).toThrow(
        BuilderAiEditPlanError
      );
    }
    expect(() =>
      applyBuilderAiEditPlan(
        duplicateConfig,
        plan([{ componentId: 'hero', kind: 'remove_component' }])
      )
    ).toThrow(BuilderAiEditPlanError);
  });

  it('rejects an update that targets a non-allowlisted legacy component', () => {
    const imageConfig: BuilderData = {
      content: [{ props: { id: 'image', src: '/private.jpg' }, type: 'Image' }],
      root: { title: 'Home' },
    };
    const imageUpdate = plan([
      {
        componentId: 'image',
        kind: 'update_component',
        patch: { componentType: 'Image', title: 'Not allowed' },
      },
    ] as unknown as BuilderAiProposedPlan['operations']);

    expect(() => applyBuilderAiEditPlan(imageConfig, imageUpdate)).toThrow(
      BuilderAiEditPlanError
    );
  });

  it('rejects an unsafe URL supplied to an insert instead of persisting it', () => {
    const unsafeInsert = plan([
      {
        initialContent: {
          componentType: 'Hero',
          ctaLink: 'javascript:alert(1)',
          id: 'model-selected',
        },
        kind: 'insert_component',
        placement: { position: 'first_content' },
      },
    ] as unknown as BuilderAiProposedPlan['operations']);

    expect(() => applyBuilderAiEditPlan(config, unsafeInsert)).toThrow(
      BuilderAiEditPlanError
    );
  });

  it('ignores a model supplied insert id and uses the server id factory', () => {
    const result = applyBuilderAiEditPlan(
      config,
      plan([
        {
          initialContent: {
            componentType: 'Text',
            content: 'A safe block',
            id: 'model-selected',
          },
          kind: 'insert_component',
          placement: { position: 'first_content' },
        },
      ] as unknown as BuilderAiProposedPlan['operations']),
      () => 'server-selected'
    );

    expect(
      result.candidateConfig.content.find(
        (component) => component.props.id === 'server-selected'
      )
    ).toBeTruthy();
  });

  it('normalizes malformed untrusted plans to the stable executor error', () => {
    expect(() =>
      applyBuilderAiEditPlan(config, {
        operations: [],
        status: 'proposed',
        summary: 'Invalid',
      } as unknown as BuilderAiProposedPlan)
    ).toThrow('Invalid builder AI edit plan');
  });

  it('rejects a collision from the server id factory', () => {
    const insert = plan([
      {
        initialContent: { componentType: 'Text', content: 'A block' },
        kind: 'insert_component',
        placement: { position: 'first_content' },
      },
    ]);

    expect(() => applyBuilderAiEditPlan(config, insert, () => 'hero')).toThrow(
      BuilderAiEditPlanError
    );
  });

  it('preserves carousel images and untouched slides during a safe slide update', () => {
    const carouselConfig: BuilderData = {
      ...config,
      content: [
        ...config.content.slice(0, 2),
        {
          props: {
            id: 'carousel',
            slides: [
              { image: '/one.jpg', title: 'One' },
              { image: '/two.jpg', title: 'Two' },
            ],
          },
          type: 'HeroCarousel',
        },
        config.content[2],
      ],
    };
    const result = applyBuilderAiEditPlan(
      carouselConfig,
      plan([
        {
          componentId: 'carousel',
          kind: 'update_carousel_slide',
          slideIndex: 0,
          title: 'Updated',
        },
      ])
    );

    expect(result.candidateConfig.content[2].props.slides).toEqual([
      { image: '/one.jpg', title: 'Updated' },
      { image: '/two.jpg', title: 'Two' },
    ]);
  });

  it('warns when a carousel patch repeats the existing safe value', () => {
    const carouselConfig: BuilderData = {
      ...config,
      content: [
        ...config.content.slice(0, 2),
        {
          props: {
            id: 'carousel',
            slides: [{ image: '/one.jpg', title: 'One' }],
          },
          type: 'HeroCarousel',
        },
        config.content[2],
      ],
    };
    const result = applyBuilderAiEditPlan(
      carouselConfig,
      plan([
        {
          componentId: 'carousel',
          kind: 'update_carousel_slide',
          slideIndex: 0,
          title: 'One',
        },
      ])
    );

    expect(result.warnings).toContain('No safe changes for HeroCarousel.');
  });
});
