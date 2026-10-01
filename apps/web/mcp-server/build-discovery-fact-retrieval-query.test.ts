import { expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });

it('builds grouped tsquery text with brand alternation', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'phone', brands: ['Samsung', 'Google'],
    attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }],
  }))).toBe('(typephone & (brandsamsung | brandgoogle) & storage256gb)');
});

it('joins alternatives with OR and strips tsquery operators from terms', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42' }, { product_type: 'charger' })))
    .toBe('(modelzx_42) | (typecharger)');
});

it('keys multi-word brands as one lexeme before OR-ing across brands', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Hewlett Packard', 'Dell'] })))
    .toBe('((brandhewlett_packard | branddell))');
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Samsung Galaxy'] }))).toBe('(brandsamsung_galaxy)');
});

it('keys every spelling selection treats as the same type to one canonical lexeme', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'Smartphones' }))).toBe('(typephone)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'headphones' }))).toBe('(typeheadphones)');
});

it('emits unit-suffixed equality values and unit lexemes for ranges', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'power_w', operator: 'eq', value: 30 },
    { key: 'storage_gb', operator: 'gte', value: 256 },
    { key: 'color', operator: 'eq', value: 'black' },
  ] }))).toBe('(power30w & storagegb & fact2da864cb0599c70b188812c7ee944b96ef701cc392e9ce63531c4b56dd89fde5)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'connector', operator: 'eq', value: 'USB-C' },
  ] }))).toBe('(fact0799a4fe78453e262b104ae43eeede491f19b6d3f98c8be2525f29fb1d059548)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'ram_gb', operator: 'gte', value: 16 },
  ] }))).toBe('(ramgb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'color', operator: 'gte', value: 'black' },
  ] }))).toBe('(a & !a)');
});

it('hashes text attribute pairs with the selector normalization and keeps keys correlated', () => {
  const query = (key: 'connector' | 'color', value: string) =>
    buildDiscoveryFactRetrievalQuery(intent({ attributes: [{ key, operator: 'eq', value }] }));
  expect(query('connector', '  Usb-C  ')).toBe('(fact0799a4fe78453e262b104ae43eeede491f19b6d3f98c8be2525f29fb1d059548)');
  expect(query('connector', 'USB-C')).toBe(query('connector', '  Usb-C  '));
  expect(query('color', 'USB-C')).not.toBe(query('connector', 'USB-C'));
  expect(query('connector', 'Cafe\u0301')).toBe(query('connector', 'Café'));
});

it('keeps equal numeric values distinct by attribute identity', () => {
  const query = buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'ram_gb', operator: 'eq', value: 8 },
    { key: 'storage_gb', operator: 'eq', value: 8 },
  ] }));
  expect(query).toBe('(ram8gb & storage8gb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [
    { key: 'screen_inches', operator: 'eq', value: 15 },
    { key: 'refresh_hz', operator: 'eq', value: 120 },
  ] }))).toBe('(screen15inch & refresh120hz)');
});

it('falls back to sanitized shopper wording and never emits empty syntax', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({}), 'Samsung or Google 256GB?')).toBe('(samsung & google & 256gb)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}), '!!!')).toBe('(a & !a)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}))).toBe('(a & !a)');
  expect(buildDiscoveryFactRetrievalQuery(intent({}), 'or and the')).toBe('(a & !a)');
});

it('folds Unicode identity terms to ASCII-safe keys both sides agree on', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Mömax'], model: 'Café Pro | !' })))
    .toBe('(brandmmax & modelcaf_pro__)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '三星手机' })))
    .toBe('(fact1dcf18b552623ad2401d64b631bd9f4fa97e9fc1a0aa174514dfbdd406e452a2)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ compatible_with: '三星' })))
    .toBe('(factbb1bdab90230c0d7d60bd6e9016c5357bf3eb7bf3b8a58b9be181828eec3c879)');
});

it('digests overlong identity lexemes so worst-case queries stay under the gate', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['a'.repeat(64)] })))
    .toBe(`(brand${'a'.repeat(64)})`);
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['a'.repeat(65)] })))
    .toBe('(fact3ed6eb2031e94b76633bc7b2f85a5c618fb6568a90ee878996448e7d78bfc9d4)');
  // Five alternatives of max-length identities: every term digested, the
  // joined query stays far below the 16k gate.
  const worst = buildDiscoveryFactRetrievalQuery({ alternatives: Array.from({ length: 5 }, () => ({
    product_type: 'b'.repeat(100), brands: Array.from({ length: 10 }, () => 'c'.repeat(100)),
    model: 'd'.repeat(100), compatible_with: 'e'.repeat(100),
  })) });
  expect(worst?.length).toBeLessThan(16384);
  expect(worst).not.toContain('b'.repeat(65));
});

it('keeps every constraint in retrieval past the old twelve-term budget', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'laptop', brands: ['Acme'], model: 'ZX 42 Ultra Pro Max Plus X Y Z',
    attributes: [
      { key: 'storage_gb', operator: 'eq', value: 256 },
      { key: 'ram_gb', operator: 'gte', value: 16 },
      { key: 'color', operator: 'eq', value: 'midnight blue deep dark shade tone' },
    ],
  }))).toBe('(typelaptop & brandacme & modelzx_42_ultra_pro_max_plus_x_y_z & storage256gb & ramgb & fact9d4b15b3a2abd3add7dda96fe84fa0be4bbb8666e10bb3c3fc807d7c68e9ddc8)');
});

it('keeps the maximum structured text-attribute query under the database length bound', () => {
  const attributes = Array.from({ length: 10 }, (_, index) => ({
    key: 'connector' as const,
    operator: 'eq' as const,
    value: `USB-C ${'x'.repeat(90)} ${index}`,
  }));
  const query = buildDiscoveryFactRetrievalQuery(intent(
    ...Array.from({ length: 5 }, () => ({ attributes }))
  ));
  expect(query.length).toBeLessThanOrEqual(16000);
});

it('normalizes decomposed Unicode before building retrieval terms', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'Café Pro' }))).toBe('(modelcaf_pro)');
});

it('renders exponent-notation numbers as plain decimals like the SQL index', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [{ key: 'screen_inches', operator: 'eq', value: 1e-7 }] })))
    .toBe('(screen0.0000001inch)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [{ key: 'storage_gb', operator: 'eq', value: 1e21 }] })))
    .toBe('(storage1000000000000000000000gb)');
});

it('keys long models as one digest lexeme instead of truncating the tail', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa' })))
    .toBe('(factcb93feba5d3baa95c7f29c8373096a2db0d08f18a7740b1a6b2d7025543facff)');
});

it('keeps keyed identity terms free of dots so groups stay valid', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '...' })))
    .toBe('(factb4ae896383178edd76f0571298f566c14dd9c2dc32a6a4cf372cb8618478bce0)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42.' }))).toBe('(modelzx_42)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '1.5' }))).toBe('(model15)');
});
