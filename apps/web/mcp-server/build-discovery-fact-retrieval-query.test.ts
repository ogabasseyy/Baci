import { expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { buildDiscoveryFactRetrievalQuery } from './build-discovery-fact-retrieval-query';

const intent = (...alternatives: McpDiscoveryIntent['alternatives']): McpDiscoveryIntent => ({ alternatives });

it('recalls both exact manufacturer-qualified and unqualified model facts without a text query', () => {
  const query = buildDiscoveryFactRetrievalQuery(
    intent({ product_type: 'phone', brands: ['Tecno'], model: 'Spark 50' })
  );
  const qualified = buildDiscoveryFactRetrievalQuery(
    intent({ model: 'TECNO SPARK 50' })
  ).slice(1, -1);
  const bare = buildDiscoveryFactRetrievalQuery(
    intent({ model: 'Spark 50' })
  ).slice(1, -1);
  expect(query).toContain(`(${bare} | ${qualified})`);
  expect(query).toContain('typephone &');
  expect(query).not.toContain(
    buildDiscoveryFactRetrievalQuery(intent({ model: 'Spark 50 5G' })).slice(
      1,
      -1
    )
  );
});

it('builds grouped tsquery text with brand alternation', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({
    product_type: 'phone', brands: ['Samsung', 'Google'],
    attributes: [{ key: 'storage_gb', operator: 'eq', value: 256 }],
  }))).toBe('(typephone & (factefcbcece42d483cba20a3e4b8ad31ef9018371555aaf4c8fe8894325471c9a2a | factbe456a1af3a8c8dd8cf23ac0f11ca2d2ae90957d6a65af44732a6665be835d6a) & storage256gb)');
});

it('joins alternatives with OR and strips tsquery operators from terms', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42' }, { product_type: 'charger' })))
    .toBe('(factca629594f18aab194fa4c526f17d47ed86e3b67664eb11ab27d315e38464667c) | (typecharger)');
});

it('keys multi-word brands as one lexeme before OR-ing across brands', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Hewlett Packard', 'Dell'] })))
    .toBe('((fact8eebc823e37f8be85101b97cb1cc7e55135c7030e4e2dff4d2a4fcb657f55e27 | factdb84dd0833e94d94fe170f1c8593ba7f720eafcd1281aa55276f70d0ce5a3ff6))');
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Samsung Galaxy'] }))).toBe('(facte1028a61bf9c5550e05160cabc300df6b4012042995bfa54c48d3f9512b23077)');
});

it('keys every spelling selection treats as the same type to one canonical lexeme', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'Smartphones' }))).toBe('(typephone)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'headphones' }))).toBe('(typeheadphones)');
});

it('digests custom product types whose punctuation would collide after cleanup', () => {
  const punctuated = buildDiscoveryFactRetrievalQuery(intent({ product_type: 'foo/bar' }));
  const plain = buildDiscoveryFactRetrievalQuery(intent({ product_type: 'foobar' }));
  expect(punctuated).not.toBe(plain);
  expect(punctuated).toBe('(fact668d16f9323f7e381d20b7e1f59560acb94b3733d9f8a1be5e54b59bae51ff9b)');
  expect(plain).toBe('(typefoobar)');
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

it('digests brand, model, and compatibility exactly like the final matcher', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['Mömax'], model: 'Café Pro | !' })))
    .toBe('(fact455c26834d2c251dd3fda344c39c862ea241e0a7eda56896c649b8c55f83be8a & (fact5d9ee8daa29fc3d263c7d4aeb210ddae271c9aa0480c57c5d87ec5c87c3efa56 | factfd13f5ffddc0151f0e2f3a02ffea455bbc915484e2cdcb5a936b6cc36a5f6d59))');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '三星手机' })))
    .toBe('(fact1dcf18b552623ad2401d64b631bd9f4fa97e9fc1a0aa174514dfbdd406e452a2)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ compatible_with: '三星' })))
    .toBe('(factbb1bdab90230c0d7d60bd6e9016c5357bf3eb7bf3b8a58b9be181828eec3c879)');
});

it('digests contextual-casing identities with ASCII-only folding', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['ΟΣ'] })))
    .toBe('(fact7ea1740e780393da898dc5490ddfdb16be57df3a9cc5d8095ade94bf24f21a12)');
});

it('distinguishes separators the matcher keeps apart', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'A B' })))
    .toBe('(fact30e73134aeeac105b298f75d72cc78649c474f946c9c7a1751322ecfc5033251)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'A-B' })))
    .toBe('(fact03957e76777cae39ed459095e665374b34ffb547e9f062bb354eda8f79a19028)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'A B' })))
    .not.toBe(buildDiscoveryFactRetrievalQuery(intent({ model: 'A-B' })));
});

it('digests brand, model, and compatibility at any length so queries stay under the gate', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ brands: ['a'.repeat(64)] })))
    .toBe('(factff82832fbb27efd6448e70e8f8334756f11a032538cfe1933d1e2e867dd7d241)');
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
  }))).toBe('(typelaptop & fact77b6e11805e6ddb7923895b0ef16dd0ef14e332643dba34f5d5a0681e45dcc87 & (fact121b1470695917b8dc77cf320173ccc7d06e16f7ec8f7d0db6c873a5efa6bf3f | fact7c7db422ccfd469ea5b798bbd2a9bed50b961c82aeee9e9c46fdecadf41f1747) & storage256gb & ramgb & fact9d4b15b3a2abd3add7dda96fe84fa0be4bbb8666e10bb3c3fc807d7c68e9ddc8)');
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
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'Café Pro' }))).toBe('(factc8bb588eab645f67633d88b03232308d9dafcbb414a3d8cc8518dc5748f80c51)');
});

it('renders exponent-notation numbers as plain decimals like the SQL index', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [{ key: 'screen_inches', operator: 'eq', value: 1e-7 }] })))
    .toBe('(screen0.0000001inch)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ attributes: [{ key: 'storage_gb', operator: 'eq', value: 1e21 }] })))
    .toBe('(storage1000000000000000000000gb)');
});

it('digests overlong product types exactly like the SQL identity lexeme', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'a'.repeat(64) })))
    .toBe(`(type${'a'.repeat(64)})`);
  expect(buildDiscoveryFactRetrievalQuery(intent({ product_type: 'a'.repeat(65) })))
    .toBe('(factae06f028c9669fc614057907c6b067678cc3d6c6f65f66363a6c487d306c8370)');
});

it('keys long models as one digest lexeme instead of truncating the tail', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa' })))
    .toBe('(factdf33557e0beca612bb6051ce42d36a8994acc21707a45a4d933298b008d575c3)');
});

it('digests dotted models exactly so groups stay valid', () => {
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '...' })))
    .toBe('(factb4ae896383178edd76f0571298f566c14dd9c2dc32a6a4cf372cb8618478bce0)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: 'ZX-42.' }))).toBe('(fact4836bcbf87c036abd8c4bf097ca8fab1d05e26cf04db6b67a8baf056a9c1f981)');
  expect(buildDiscoveryFactRetrievalQuery(intent({ model: '1.5' }))).toBe('(facta4c8c29af6e09cfd7bfbb54720e0f072d56417c2124b0f31a626756bee37264f)');
});
