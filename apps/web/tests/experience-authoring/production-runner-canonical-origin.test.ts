import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { experienceDataFixture } from './data-fixture.test-support';

it('keeps canonical HTTPS SQL origins strict without changing local support', async () => {
  const f = await experienceDataFixture();
  try {
    const origins = [
      'https://shop.synthetic.test',
      'https://shop.synthetic.test:8443',
      'http://127.0.0.1:4102',
      'http://public.example.test',
      'https://user:password@shop.synthetic.test',
      'https://shop.synthetic.test/path',
      'https://shop.synthetic.test:443',
      'https://shop.synthetic.test:65536',
      'https://shop.synthetic.test;bad',
      'https://127.0.0.1',
    ];
    const validity = await f.db.pool.query(
      'SELECT public.experience_host_origin_valid(value) AS valid FROM unnest($1::text[]) WITH ORDINALITY AS origins(value, n) ORDER BY n',
      [origins]
    );
    expect(validity.rows.map((row) => row.valid)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  } finally {
    await f.close();
  }
});
