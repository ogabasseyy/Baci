import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { applyBuilderAiEditPlan } from './apply-builder-ai-edit-plan';

function block(type: string, id: string) {
  return { props: { id }, type };
}

function plan(
  operations: BuilderAiProposedPlan['operations']
): BuilderAiProposedPlan {
  return { operations, status: 'proposed', summary: 'Apply zone edit' };
}

describe('applyBuilderAiEditPlan zones', () => {
  it('inserts at the beginning of the named zone instead of root content', () => {
    const config: BuilderData = {
      content: [block('Header', 'header-1'), block('Footer', 'footer-1')],
      root: { title: 'Home' },
      zones: { aside: [block('Text', 'zone-text')] },
    };

    const result = applyBuilderAiEditPlan(
      config,
      plan([
        {
          initialContent: { componentType: 'Text', content: 'Zone first' },
          kind: 'insert_component',
          placement: { collection: 'aside', position: 'first_content' },
        },
      ]),
      () => 'zone-first'
    );

    expect(result.candidateConfig.content.map((item) => item.props.id)).toEqual(
      ['header-1', 'footer-1']
    );
    expect(
      (result.candidateConfig.zones?.aside as BuilderData['content']).map(
        (item) => item.props.id
      )
    ).toEqual(['zone-first', 'zone-text']);
  });

  it('inserts beside a placement target projected from a zone', () => {
    const config: BuilderData = {
      content: [block('Header', 'header-1'), block('Footer', 'footer-1')],
      root: { title: 'Home' },
      zones: { aside: [block('Text', 'zone-text')] },
    };
    const result = applyBuilderAiEditPlan(
      config,
      plan([
        {
          initialContent: { componentType: 'Text', content: 'Zone sibling' },
          kind: 'insert_component',
          placement: { componentId: 'zone-text', position: 'after' },
        },
      ]),
      () => 'zone-insert'
    );
    expect(
      (result.candidateConfig.zones?.aside as BuilderData['content']).map(
        (item) => item.props.id
      )
    ).toEqual(['zone-text', 'zone-insert']);
  });

  it('rejects root and unknown zone collections instead of treating them as content', () => {
    const config: BuilderData = {
      content: [block('Header', 'header-1'), block('Footer', 'footer-1')],
      root: { title: 'Home' },
      zones: { aside: [] },
    };
    const insert = (collection: string) =>
      applyBuilderAiEditPlan(
        config,
        plan([
          {
            initialContent: { componentType: 'Text', content: 'Bounded copy' },
            kind: 'insert_component',
            placement: { collection, position: 'first_content' },
          },
        ]),
        () => 'zone-insert'
      );

    expect(() => insert('root')).toThrow(
      'Placement is not allowed by manifest'
    );
    expect(() => insert('unknown-zone')).toThrow(
      'Placement is not allowed by manifest'
    );
  });

  it('validates an after destination against the target zone policy', () => {
    const result = applyBuilderAiEditPlan(
      {
        content: [block('Header', 'header-1'), block('Footer', 'footer-1')],
        root: { title: 'Home' },
        zones: { aside: [block('Text', 'aside-anchor')] },
      },
      plan([
        {
          initialContent: { componentType: 'Button', text: 'Shop now' },
          kind: 'insert_component',
          placement: { componentId: 'aside-anchor', position: 'after' },
        },
      ]),
      () => 'aside-button'
    );

    expect(
      (result.candidateConfig.zones?.aside as BuilderData['content']).map(
        (item) => item.props.id
      )
    ).toEqual(['aside-anchor', 'aside-button']);
  });

  it('keeps a ProductGrid that exists only in a zone', () => {
    const config: BuilderData = {
      content: [block('Header', 'header-1'), block('Footer', 'footer-1')],
      root: { title: 'Home' },
      zones: { aside: [block('ProductGrid', 'zone-grid')] },
    };
    expect(() =>
      applyBuilderAiEditPlan(
        config,
        plan([{ componentId: 'zone-grid', kind: 'remove_component' }])
      )
    ).toThrow('A storefront requires one ProductGrid');
  });

  it('rejects moving a root component into a zone across protected anchors', () => {
    const config: BuilderData = {
      content: [
        block('Header', 'header-1'),
        block('Text', 'root-text'),
        block('Footer', 'footer-1'),
      ],
      root: { title: 'Home' },
      zones: { aside: [block('Text', 'zone-text')] },
    };

    expect(() =>
      applyBuilderAiEditPlan(
        config,
        plan([
          {
            componentId: 'root-text',
            destination: { componentId: 'zone-text', position: 'after' },
            kind: 'move_component',
          },
        ])
      )
    ).toThrow('Component moved across a protected anchor');
  });

  it('rejects moving zoned content to root first_content across protected anchors', () => {
    const config: BuilderData = {
      content: [block('Header', 'header-1'), block('Footer', 'footer-1')],
      root: { title: 'Home' },
      zones: { aside: [block('Text', 'zone-text')] },
    };

    expect(() =>
      applyBuilderAiEditPlan(
        config,
        plan([
          {
            componentId: 'zone-text',
            destination: { position: 'first_content' },
            kind: 'move_component',
          },
        ])
      )
    ).toThrow('Component moved across a protected anchor');
  });
});
