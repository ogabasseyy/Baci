import { describe, expect, it } from 'vitest';
import { createPrivateHome } from './create-private-home';
import { buildEditCandidate } from './edit-candidate';

const proposed = (operations: unknown[]) => ({
  status: 'proposed',
  summary: 'Updated heading',
  operations,
});
describe('private edit validation', () => {
  it('reuses semantic patches without changing protected anchors or publication', () => {
    const source = createPrivateHome('Store');
    const result = buildEditCandidate(
      source,
      proposed([
        {
          kind: 'update_component',
          componentId: 'hero',
          patch: { componentType: 'Hero', title: 'Summer collection' },
        },
      ])
    );
    expect(result.content.find((b) => b.type === 'Hero')?.props).toMatchObject({
      title: 'Summer collection',
    });
    expect(source.content[1].props).toMatchObject({ title: 'Store' });
  });
  it.each([
    proposed([{ kind: 'remove_component', componentId: 'header' }]),
    proposed([
      {
        kind: 'update_component',
        componentId: 'hero',
        patch: { componentType: 'Hero', ctaLink: 'javascript:alert(1)' },
      },
    ]),
    proposed([
      {
        kind: 'insert_component',
        initialContent: {
          componentType: 'CustomHtml',
          html: '<script>alert(1)</script>',
        },
        placement: { collection: 'content', position: 'first_content' },
      },
    ]),
    { status: 'proposed', operations: [] },
  ])('rejects unsafe or malformed model output', (output) =>
    expect(() =>
      buildEditCandidate(createPrivateHome('Store'), output)
    ).toThrow());
});
