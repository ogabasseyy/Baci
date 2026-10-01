import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyBuilderAiEditPlan,
  BuilderAiEditPlanError,
} from './apply-builder-ai-edit-plan';

function block(type: string, id: string) {
  return { props: { id }, type };
}

function config(content: BuilderData['content']): BuilderData {
  return { content, root: { title: 'Home' } };
}

function plan(
  operations: BuilderAiProposedPlan['operations']
): BuilderAiProposedPlan {
  return {
    operations,
    status: 'proposed',
    summary: 'Keep protected anchors in place',
  };
}

function ids(result: ReturnType<typeof applyBuilderAiEditPlan>): string[] {
  return result.candidateConfig.content.map((component) =>
    String(component.props.id)
  );
}

describe('applyBuilderAiEditPlan protected anchors', () => {
  it('rejects moving zoned content across a zoned protected anchor', () => {
    const input: BuilderData = {
      content: [block('Header', 'root-header'), block('Footer', 'root-footer')],
      root: { title: 'Home' },
      zones: {
        aside: [
          block('Text', 'before-zone-header'),
          block('Header', 'zone-header'),
          block('Text', 'after-zone-header'),
        ],
      },
    };

    expect(() =>
      applyBuilderAiEditPlan(
        input,
        plan([
          {
            componentId: 'before-zone-header',
            destination: {
              componentId: 'after-zone-header',
              position: 'after',
            },
            kind: 'move_component',
          },
        ])
      )
    ).toThrow('Component moved across a protected anchor');
  });

  it('allows inserts immediately before and after a non-leading Header', () => {
    const result = applyBuilderAiEditPlan(
      config([
        block('Text', 'before'),
        block('Header', 'header'),
        block('Text', 'after'),
      ]),
      plan([
        {
          initialContent: { componentType: 'Text', content: 'Before header' },
          kind: 'insert_component',
          placement: { componentId: 'before', position: 'after' },
        },
        {
          initialContent: { componentType: 'Text', content: 'After header' },
          kind: 'insert_component',
          placement: { componentId: 'header', position: 'after' },
        },
      ]),
      (() => {
        let sequence = 0;
        return (type) => `${type.toLowerCase()}-inserted-${++sequence}`;
      })()
    );

    expect(ids(result)).toEqual([
      'before',
      'text-inserted-1',
      'header',
      'text-inserted-2',
      'after',
    ]);
  });

  it('rejects moving a block across a non-leading Header', () => {
    const input = config([
      block('Text', 'before'),
      block('Header', 'header'),
      block('Text', 'after'),
    ]);

    expect(() =>
      applyBuilderAiEditPlan(
        input,
        plan([
          {
            componentId: 'before',
            destination: { componentId: 'after', position: 'after' },
            kind: 'move_component',
          },
        ])
      )
    ).toThrow(BuilderAiEditPlanError);
  });

  it('rejects moving a block across a non-trailing Footer', () => {
    const input = config([
      block('Text', 'before'),
      block('Footer', 'footer'),
      block('Text', 'after'),
    ]);

    expect(() =>
      applyBuilderAiEditPlan(
        input,
        plan([
          {
            componentId: 'after',
            destination: { componentId: 'before', position: 'after' },
            kind: 'move_component',
          },
        ])
      )
    ).toThrow(BuilderAiEditPlanError);
  });

  it('rejects moving a block across any one of multiple anchors', () => {
    const input = config([
      block('Text', 'first'),
      block('Header', 'header-one'),
      block('Text', 'second'),
      block('Footer', 'footer-one'),
      block('Text', 'third'),
      block('Header', 'header-two'),
      block('Text', 'fourth'),
    ]);

    expect(() =>
      applyBuilderAiEditPlan(
        input,
        plan([
          {
            componentId: 'second',
            destination: { componentId: 'fourth', position: 'after' },
            kind: 'move_component',
          },
        ])
      )
    ).toThrow(BuilderAiEditPlanError);
  });

  it('allows moves that remain within an anchor-bounded region', () => {
    const result = applyBuilderAiEditPlan(
      config([
        block('Text', 'first'),
        block('Header', 'header'),
        block('Text', 'second'),
        block('Text', 'third'),
        block('Footer', 'footer'),
        block('Text', 'fourth'),
        block('Text', 'fifth'),
      ]),
      plan([
        {
          componentId: 'second',
          destination: { componentId: 'third', position: 'after' },
          kind: 'move_component',
        },
        {
          componentId: 'fourth',
          destination: { componentId: 'fifth', position: 'after' },
          kind: 'move_component',
        },
      ])
    );

    expect(ids(result)).toEqual([
      'first',
      'header',
      'third',
      'second',
      'footer',
      'fifth',
      'fourth',
    ]);
  });

  it('keeps zero-anchor documents movable', () => {
    const result = applyBuilderAiEditPlan(
      config([block('Text', 'first'), block('Text', 'second')]),
      plan([
        {
          componentId: 'first',
          destination: { componentId: 'second', position: 'after' },
          kind: 'move_component',
        },
      ])
    );

    expect(ids(result)).toEqual(['second', 'first']);
  });
});
