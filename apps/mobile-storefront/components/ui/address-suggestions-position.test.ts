import {
  addressSuggestionsPosition,
  addressSuggestionsScrollAmount,
} from './address-suggestions-position';

const host = { x: 10, y: 100, width: 380, height: 700 };
it('subtracts navigation-header and host offsets below the field', () => {
  expect(
    addressSuggestionsPosition(
      { x: 26, y: 200, width: 340, height: 52 },
      host,
      null
    )
  ).toMatchObject({ left: 16, top: 156, width: 340 });
});
it('anchors an upward dropdown by its actual bottom regardless of short content height', () => {
  const result = addressSuggestionsPosition(
    { x: 26, y: 530, width: 340, height: 52 },
    host,
    600
  );
  expect(result).toMatchObject({ bottom: 274, maxHeight: 280 });
  expect(result).not.toHaveProperty('top');
  expect(
    result && 'bottom' in result ? host.y + host.height - result.bottom : null
  ).toBe(526);
});
it('keeps suggestions inside the keyboard and host and hides when no space exists', () => {
  expect(
    addressSuggestionsPosition(
      { x: 0, y: 100, width: 600, height: 52 },
      host,
      108
    )
  ).toBeNull();
  expect(
    addressSuggestionsPosition(
      { x: 0, y: 620, width: 600, height: 52 },
      host,
      600
    )
  ).toMatchObject({ left: 0, width: 380, bottom: 212 });
});

it('requests only the missing space below the field when the keyboard is open', () => {
  expect(
    addressSuggestionsScrollAmount(
      { x: 26, y: 530, width: 340, height: 52 },
      host,
      600,
      128
    )
  ).toBe(122);
});
it('does not scroll when results already fit and keeps the field within the host', () => {
  expect(
    addressSuggestionsScrollAmount(
      { x: 26, y: 200, width: 340, height: 52 },
      host,
      600,
      128
    )
  ).toBe(0);
  expect(
    addressSuggestionsScrollAmount(
      { x: 26, y: 150, width: 340, height: 52 },
      host,
      220,
      400
    )
  ).toBe(42);
});
