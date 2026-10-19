import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiInsertDestination } from './get-builder-ai-insert-destination';

const config: BuilderData = {
  content: [{ props: { id: 'content-anchor' }, type: 'Text' }],
  root: { title: 'Home' },
  zones: { aside: [{ props: { id: 'aside-anchor' }, type: 'Text' }] },
};

describe('getBuilderAiInsertDestination', () => {
  it("allows a component's manifest-approved root content and existing zone", () => {
    expect(
      getBuilderAiInsertDestination(
        config,
        'Button',
        { collection: 'content', position: 'first_content' },
        Error
      ).collection
    ).toBe('content');
    expect(
      getBuilderAiInsertDestination(
        config,
        'Button',
        { collection: 'aside', position: 'first_content' },
        Error
      ).collection
    ).toBe('aside');
  });

  it('rejects a root alias, unknown zone, and after target outside the config', () => {
    expect(() =>
      getBuilderAiInsertDestination(
        config,
        'Text',
        { collection: 'root', position: 'first_content' },
        Error
      )
    ).toThrow('Placement is not allowed by manifest');
    expect(() =>
      getBuilderAiInsertDestination(
        config,
        'Text',
        { collection: 'missing', position: 'first_content' },
        Error
      )
    ).toThrow('Placement is not allowed by manifest');
    expect(() =>
      getBuilderAiInsertDestination(
        config,
        'Text',
        { componentId: 'missing-anchor', position: 'after' },
        Error
      )
    ).toThrow('Component target was not found');
  });
});
