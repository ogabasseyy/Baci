import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { isRenderedH1Hero } from './is-rendered-h1-hero';

function hero(headingLevel?: string): BuilderData['content'][number] {
  return {
    props: { ...(headingLevel === undefined ? {} : { headingLevel }) },
    type: 'Hero',
  };
}

describe('isRenderedH1Hero', () => {
  it('treats the legacy absent heading level as the renderer H1 default', () => {
    expect(isRenderedH1Hero(hero())).toBe(true);
  });

  it('only treats explicit H1 Hero components as rendered H1s', () => {
    expect(isRenderedH1Hero(hero('h1'))).toBe(true);
    expect(isRenderedH1Hero(hero('h2'))).toBe(false);
    expect(
      isRenderedH1Hero({ props: { headingLevel: 'h1' }, type: 'Text' })
    ).toBe(false);
  });
});
