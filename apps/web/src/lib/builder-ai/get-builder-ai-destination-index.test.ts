import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiDestinationIndex } from './get-builder-ai-destination-index';

function component(type: string, id: string) {
  return { props: { id }, type };
}

describe('getBuilderAiDestinationIndex', () => {
  it('returns the destination position in the target zone', () => {
    const config: BuilderData = {
      content: [
        component('Header', 'header-1'),
        component('Footer', 'footer-1'),
      ],
      root: { title: 'Home' },
      zones: { aside: [component('Text', 'zone-text')] },
    };
    const aside = config.zones?.aside as BuilderData['content'];

    expect(
      getBuilderAiDestinationIndex(
        config,
        aside,
        { componentId: 'zone-text', position: 'after' },
        (message) => new Error(message)
      )
    ).toBe(1);
  });

  it('rejects a placement target outside the supplied collection', () => {
    const config: BuilderData = {
      content: [
        component('Header', 'header-1'),
        component('Footer', 'footer-1'),
      ],
      root: { title: 'Home' },
      zones: { aside: [component('Text', 'zone-text')] },
    };

    expect(() =>
      getBuilderAiDestinationIndex(
        config,
        config.content,
        { componentId: 'zone-text', position: 'after' },
        (message) => new Error(message)
      )
    ).toThrow('Placement crosses a zone boundary');
  });
});
