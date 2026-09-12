import { describe, expect, it } from 'vitest';
import type { TemplatePageProps } from './template-page-props';

describe('TemplatePageProps', () => {
  it('accepts storefront page fields used by template components', () => {
    const props: TemplatePageProps = {
      storeSlug: 'ogabassey',
      isPreview: false,
      categories: [{ name: 'Phones', slug: 'phones' }],
    };

    expect(props.storeSlug).toBe('ogabassey');
    expect(props.categories?.[0]?.slug).toBe('phones');
  });
});
