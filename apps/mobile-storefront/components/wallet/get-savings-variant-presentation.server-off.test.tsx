import { resolveColorSwatchValue } from '@/lib/cart-display';
import { getSavingsVariantPresentation } from './get-savings-variant-presentation';

it('moves the named Black colour into a swatch and preserves storage', () => {
  expect(
    getSavingsVariantPresentation('Color: Black · Storage: 256GB')
  ).toEqual({
    colour: { name: 'Black', hex: resolveColorSwatchValue('Black') },
    details: '',
    storage: '256GB',
  });
});

it('does not invent a colour for an unknown finish', () => {
  expect(getSavingsVariantPresentation('Colour: Starlight · 128GB')).toEqual({
    colour: null,
    details: 'Colour: Starlight',
    storage: '128GB',
  });
});

it('handles a goal with no variant label', () => {
  expect(getSavingsVariantPresentation(null)).toEqual({
    colour: null,
    details: '',
    storage: null,
  });
});
