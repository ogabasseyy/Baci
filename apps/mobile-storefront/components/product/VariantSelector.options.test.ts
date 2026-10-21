import { normalizeVariantOptions } from './VariantSelector.options';

describe('normalizeVariantOptions', () => {
  it('prefers image-driven colors and omits internal attribute axes', () => {
    expect(
      normalizeVariantOptions({
        colors: ['Red'],
        colorImages: { Blue: ['blue.png'] },
        attributes: {
          condition: ['used', 'new'],
          material: ['Steel'],
          storage: ['128GB'],
        },
      })
    ).toMatchObject({
      hasImageDrivenColors: true,
      normalizedColors: [
        { name: 'Blue', value: '#3B82F6', images: ['blue.png'] },
      ],
      normalizedGenericAttributes: [{ axis: 'material', values: ['Steel'] }],
    });
  });

  it('deduplicates storage and uses matching variant inventory', () => {
    const result = normalizeVariantOptions({
      colors: ['Red'],
      storage: ['128GB', ' 128GB ', '256GB'],
      variants: [
        {
          id: 'variant-128',
          name: 'Red 128GB',
          condition: 'used',
          price: 1000,
          stock_quantity: 2,
          attributes: { condition: 'used', finish: 'Matte', storage: '128GB' },
        },
      ],
    });

    expect(result.normalizedStorage).toEqual([
      { value: '128GB', stock: 2 },
      { value: '256GB', stock: undefined },
    ]);
    expect(result.normalizedGenericAttributes).toEqual([
      { axis: 'finish', values: ['Matte'] },
    ]);
  });

  it('derives storage stock from serialized policy and units', () => {
    const result = normalizeVariantOptions({
      storage: ['128GB', '256GB', '512GB', '1TB'],
      variants: [
        {
          id: 'variant-128',
          name: '128GB',
          price: 1000,
          stock_quantity: 0,
          effective_policy: 'serialized_then_unlimited',
          attributes: { storage: '128GB' },
        },
        {
          id: 'variant-256',
          name: '256GB',
          price: 1000,
          stock_quantity: 0,
          effective_policy: 'serialized_strict',
          available_units: 3,
          attributes: { storage: '256GB' },
        },
        {
          id: 'variant-512',
          name: '512GB',
          price: 1000,
          stock_quantity: 0,
          effective_policy: 'serialized_strict',
          available_units: 0,
          attributes: { storage: '512GB' },
        },
        {
          id: 'variant-1tb',
          name: '1TB',
          price: 1000,
          stock_quantity: 0,
          attributes: { storage: '1TB' },
        },
      ],
    });

    expect(result.normalizedStorage).toEqual([
      // Unlimited: enabled with no finite count to display.
      { value: '128GB', stock: undefined },
      // Strict: exact serialized units.
      { value: '256GB', stock: 3 },
      // Strict with exhausted units: out of stock.
      { value: '512GB', stock: 0 },
      // Finite: raw quantity.
      { value: '1TB', stock: 0 },
    ]);
  });

  it('omits storage from generic attributes when storage only comes from attributes', () => {
    const result = normalizeVariantOptions({
      attributes: {
        finish: ['Matte'],
        storage: ['128GB'],
      },
    });

    expect(result.normalizedStorage).toEqual([]);
    expect(result.normalizedGenericAttributes).toEqual([
      { axis: 'finish', values: ['Matte'] },
    ]);
  });

  it('keeps attribute-backed condition options when no dedicated condition selector is visible', () => {
    const result = normalizeVariantOptions({
      hideConditionAttributes: false,
      attributes: {
        Condition: ['used', 'open_box'],
      },
      variants: [
        {
          id: 'variant-used',
          name: 'Used',
          condition: 'used',
          price: 1000,
          attributes: { condition: 'used' },
        },
      ],
    });

    expect(result.normalizedGenericAttributes).toEqual([
      { axis: 'condition', values: ['used', 'open_box'] },
    ]);
  });
});
