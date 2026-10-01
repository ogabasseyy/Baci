import { describe, expect, it } from 'vitest';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

function candidate(category: unknown) {
  return builderPreviewCandidateConfigSchema.safeParse({
    content: [
      {
        props: { category, id: 'products-1', title: 'Featured products' },
        type: 'ProductGrid',
      },
    ],
    root: { props: { title: 'Home' } },
  });
}

function candidateWithColumns(columns: unknown) {
  return builderPreviewCandidateConfigSchema.safeParse({
    content: [
      {
        props: { columns, id: 'products-1', title: 'Featured products' },
        type: 'ProductGrid',
      },
    ],
    root: { props: { title: 'Home' } },
  });
}

describe('saved ProductGrid category preview compatibility', () => {
  it('preserves a bounded saved category without making it AI-editable', () => {
    const result = candidate('Phones & Tablets');

    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.content[0]?.props.category).toBe('Phones & Tablets');
    expect(
      builderDesignCapabilityAdapter.isPropValue(
        'ProductGrid',
        'category',
        'Phones & Tablets'
      )
    ).toBe(false);
  });

  it('rejects unbounded or non-string saved category data', () => {
    expect(candidate(' Phones ').success).toBe(false);
    expect(candidate('x'.repeat(121)).success).toBe(false);
    expect(candidate({ name: 'Phones' }).success).toBe(false);
  });

  it('rejects one-column grids outside the live renderer bound', () => {
    expect(candidateWithColumns(2).success).toBe(true);
    expect(candidateWithColumns(1).success).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('ProductGrid', 'columns', 1)
    ).toBe(false);
    expect(candidateWithColumns(0).success).toBe(false);
    expect(
      builderDesignCapabilityAdapter.isPropValue('ProductGrid', 'columns', 0)
    ).toBe(false);
  });
});
