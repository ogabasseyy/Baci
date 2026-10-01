import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyBuilderAiEditPlan,
  BuilderAiEditPlanError,
} from './apply-builder-ai-edit-plan';

function block(type: string, id: string, props: Record<string, unknown> = {}) {
  return { props: { ...props, id }, type };
}

function currentConfig(): BuilderData {
  return {
    content: [
      block('Header', 'header-1'),
      block('Hero', 'hero-1', { headingLevel: 'h1', title: 'Original' }),
      block('Text', 'text-1', { content: 'Keep this', legacy: 'preserve' }),
      block('Text', 'text-2', { content: 'Remove this' }),
      block('ProductGrid', 'products-1'),
      block('Footer', 'footer-1'),
    ],
    root: { retained: true, title: 'Home' },
    theme: { retainedTheme: 'yes' },
    zones: { legacy: [{ untouched: true }] },
  };
}

function plan(
  operations: BuilderAiProposedPlan['operations']
): BuilderAiProposedPlan {
  return {
    operations,
    status: 'proposed',
    summary: 'Apply safe storefront edits',
  };
}

describe('applyBuilderAiEditPlan structure', () => {
  it('resolves updates by stable id after a component moves', () => {
    const result = applyBuilderAiEditPlan(
      currentConfig(),
      plan([
        {
          componentId: 'hero-1',
          destination: { componentId: 'products-1', position: 'after' },
          kind: 'move_component',
        },
        {
          componentId: 'hero-1',
          kind: 'update_component',
          patch: { componentType: 'Hero', title: 'Moved title' },
        },
      ])
    );

    expect(result.candidateConfig.content.map((item) => item.props.id)).toEqual(
      ['header-1', 'text-1', 'text-2', 'products-1', 'hero-1', 'footer-1']
    );
    expect(result.candidateConfig.content[4].props.title).toBe('Moved title');
  });

  it('inserts after the leading Header or a stable target and assigns server ids', () => {
    const result = applyBuilderAiEditPlan(
      currentConfig(),
      plan([
        {
          initialContent: { componentType: 'Text', content: 'First' },
          kind: 'insert_component',
          placement: { position: 'first_content' },
        },
        {
          initialContent: { componentType: 'Newsletter', title: 'Later' },
          kind: 'insert_component',
          placement: { componentId: 'products-1', position: 'after' },
        },
      ]),
      (type) => `${type.toLowerCase()}-server-id`
    );

    expect(result.candidateConfig.content.map((item) => item.props.id)).toEqual(
      [
        'header-1',
        'text-server-id',
        'hero-1',
        'text-1',
        'text-2',
        'products-1',
        'newsletter-server-id',
        'footer-1',
      ]
    );
    expect(result.candidateConfig.content[1].props).not.toHaveProperty(
      'headingLevel'
    );
  });

  it('moves without duplication, removes ordinary blocks, and preserves untouched values', () => {
    const input = currentConfig();
    const result = applyBuilderAiEditPlan(
      input,
      plan([
        {
          componentId: 'text-1',
          destination: { componentId: 'products-1', position: 'after' },
          kind: 'move_component',
        },
        { componentId: 'text-2', kind: 'remove_component' },
      ])
    );

    expect(result.candidateConfig.content.map((item) => item.props.id)).toEqual(
      ['header-1', 'hero-1', 'products-1', 'text-1', 'footer-1']
    );
    expect(result.candidateConfig.root).toEqual(input.root);
    expect(result.candidateConfig.zones).toEqual(input.zones);
    expect(input.content.map((item) => item.props.id)).toEqual([
      'header-1',
      'hero-1',
      'text-1',
      'text-2',
      'products-1',
      'footer-1',
    ]);
  });

  it('preserves protected anchors, catalog and h1 invariants', () => {
    const input = currentConfig();
    const protectedOperations = [
      { componentId: 'header-1', kind: 'remove_component' },
      {
        componentId: 'footer-1',
        destination: { position: 'first_content' },
        kind: 'move_component',
      },
      { componentId: 'hero-1', kind: 'remove_component' },
      { componentId: 'products-1', kind: 'remove_component' },
    ] as unknown as BuilderAiProposedPlan['operations'];

    for (const operation of protectedOperations) {
      expect(() => applyBuilderAiEditPlan(input, plan([operation]))).toThrow(
        BuilderAiEditPlanError
      );
    }
  });

  it('does not allow structural inserts or moves across Header and Footer anchors', () => {
    const input = currentConfig();
    const structuralInsert = plan([
      {
        initialContent: { componentType: 'Header' },
        kind: 'insert_component',
        placement: { position: 'first_content' },
      },
    ] as unknown as BuilderAiProposedPlan['operations']);
    const afterFooter = plan([
      {
        initialContent: { componentType: 'Text', content: 'Outside footer' },
        kind: 'insert_component',
        placement: { componentId: 'footer-1', position: 'after' },
      },
    ]);
    const firstMove = plan([
      {
        componentId: 'text-1',
        destination: { position: 'first_content' },
        kind: 'move_component',
      },
    ]);

    expect(() => applyBuilderAiEditPlan(input, structuralInsert)).toThrow(
      BuilderAiEditPlanError
    );
    expect(() => applyBuilderAiEditPlan(input, afterFooter)).toThrow(
      'Placement crosses a protected anchor'
    );
    expect(
      applyBuilderAiEditPlan(input, firstMove).candidateConfig.content[0].props
        .id
    ).toBe('header-1');
  });

  it('keeps specialized zero-Header documents valid and bounds the final block count', () => {
    const legacy = {
      ...currentConfig(),
      content: currentConfig().content.filter((item) => item.type !== 'Header'),
    };
    const inserted = applyBuilderAiEditPlan(
      legacy,
      plan([
        {
          initialContent: { componentType: 'Text', content: 'Top copy' },
          kind: 'insert_component',
          placement: { position: 'first_content' },
        },
      ]),
      () => 'top-copy'
    );
    expect(inserted.candidateConfig.content[0].props.id).toBe('top-copy');

    const full = {
      content: Array.from({ length: 500 }, (_, index) =>
        block('Text', `text-${index}`)
      ),
      root: { title: 'Home' },
    };
    const atBoundary = {
      content: Array.from({ length: 499 }, (_, index) =>
        block('Text', `allowed-${index}`)
      ),
      root: { title: 'Home' },
    };
    expect(
      applyBuilderAiEditPlan(
        atBoundary,
        plan([
          {
            initialContent: { componentType: 'Text', content: 'Allowed' },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ])
      ).candidateConfig.content
    ).toHaveLength(500);
    expect(() =>
      applyBuilderAiEditPlan(
        full,
        plan([
          {
            initialContent: { componentType: 'Text', content: 'Too many' },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ])
      )
    ).toThrow('Builder document has too many blocks');
  });

  it('warns for a no-op patch and rejects a final candidate outside BuilderData', () => {
    const noOp = applyBuilderAiEditPlan(
      currentConfig(),
      plan([
        {
          componentId: 'hero-1',
          kind: 'update_component',
          patch: { componentType: 'Hero', title: 'Original' },
        },
      ])
    );
    expect(noOp.warnings).toContain('No safe changes for Hero.');

    const sameRoot = applyBuilderAiEditPlan(
      currentConfig(),
      plan([{ kind: 'update_root', title: 'Home' }])
    );
    expect(sameRoot.warnings).toContain('No safe changes for page title.');

    const sameMove = applyBuilderAiEditPlan(
      currentConfig(),
      plan([
        {
          componentId: 'text-1',
          destination: { componentId: 'text-1', position: 'after' },
          kind: 'move_component',
        },
      ])
    );
    expect(sameMove.warnings).toContain('No safe changes for move.');
    expect(
      sameMove.candidateConfig.content.map((item) => item.props.id)
    ).toEqual(currentConfig().content.map((item) => item.props.id));

    const invalid = {
      content: [{ props: [], type: 'Text' }],
      root: { title: 'Home' },
    } as unknown as BuilderData;
    expect(() =>
      applyBuilderAiEditPlan(
        invalid,
        plan([{ kind: 'update_root', title: 'Changed' }])
      )
    ).toThrow(BuilderAiEditPlanError);
  });
});
