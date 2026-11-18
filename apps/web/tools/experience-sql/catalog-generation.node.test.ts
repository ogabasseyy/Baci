import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { experienceSqlFixture } from './fixture.ts';

test('catalog generation follows native/import writes, reparent and cascading deletes with published RLS', async () => {
  const f = await experienceSqlFixture();
  try {
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261024072905_experience_private_foundation.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await f.pool.query(
      `ALTER TABLE merchants ADD COLUMN IF NOT EXISTS currency text; CREATE TABLE products(id uuid PRIMARY KEY,merchant_id uuid REFERENCES merchants(id),price numeric);CREATE TABLE product_variants(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id) ON DELETE CASCADE);CREATE TABLE product_offers(id uuid PRIMARY KEY,product_id uuid REFERENCES products(id) ON DELETE CASCADE);CREATE TABLE categories(id uuid PRIMARY KEY,merchant_id uuid REFERENCES merchants(id));CREATE TABLE product_categories(product_id uuid REFERENCES products(id) ON DELETE CASCADE,category_id uuid REFERENCES categories(id));CREATE TABLE variant_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,status text);CREATE TABLE branches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid REFERENCES merchants(id),is_active boolean);GRANT SELECT(id,is_published) ON merchants TO anon;CREATE POLICY fixture_published_merchant ON merchants FOR SELECT TO anon USING(is_published IS TRUE);`
    );
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261024120000_experience_catalog_generations.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const a = '10000000-0000-4000-8000-000000000001';
    const b = '10000000-0000-4000-8000-000000000002';
    const p = '20000000-0000-4000-8000-000000000001';
    await f.pool.query(
      'INSERT INTO merchants(id,is_published) VALUES($1,true),($2,false)',
      [a, b]
    );
    const generation = async (id: string) =>
      (
        await f.pool.query(
          'SELECT generation FROM experience_catalog_generations WHERE merchant_id=$1',
          [id]
        )
      ).rows[0].generation;
    const before = await generation(a);
    await f.pool.query('INSERT INTO products VALUES($1,$2,100)', [p, a]);
    assert.ok(BigInt(await generation(a)) > BigInt(before));
    for (const table of ['product_variants', 'product_offers']) {
      const v = await generation(a);
      await f.pool.query(`INSERT INTO ${table} VALUES(gen_random_uuid(),$1)`, [
        p,
      ]);
      assert.ok(BigInt(await generation(a)) > BigInt(v));
    }
    const variant = (
      await f.pool.query(
        'SELECT id FROM product_variants WHERE product_id=$1',
        [p]
      )
    ).rows[0].id;
    for (const sql of [
      "INSERT INTO variant_inventory(variant_id,status) VALUES($1,'available')",
      "UPDATE variant_inventory SET status='sold' WHERE variant_id=$1",
      'DELETE FROM variant_inventory WHERE variant_id=$1',
    ]) {
      const before = await generation(a);
      await f.pool.query(sql, [variant]);
      assert.ok(BigInt(await generation(a)) > BigInt(before));
    }
    const branchBefore = await generation(a);
    await f.pool.query(
      'INSERT INTO branches(merchant_id,is_active) VALUES($1,true)',
      [a]
    );
    assert.ok(BigInt(await generation(a)) > BigInt(branchBefore));
    const category = (
      await f.pool.query(
        'INSERT INTO categories VALUES(gen_random_uuid(),$1) RETURNING id',
        [a]
      )
    ).rows[0].id;
    const membershipBefore = await generation(a);
    await f.pool.query('INSERT INTO product_categories VALUES($1,$2)', [
      p,
      category,
    ]);
    assert.ok(BigInt(await generation(a)) > BigInt(membershipBefore));
    const v = await generation(a);
    await f.pool.query('UPDATE products SET price=125 WHERE id=$1', [p]);
    assert.ok(BigInt(await generation(a)) > BigInt(v));
    const oldA = await generation(a);
    const oldB = await generation(b);
    await f.pool.query('UPDATE products SET merchant_id=$1 WHERE id=$2', [
      b,
      p,
    ]);
    assert.ok(BigInt(await generation(a)) > BigInt(oldA));
    assert.ok(BigInt(await generation(b)) > BigInt(oldB));
    const del = await generation(b);
    await f.pool.query('DELETE FROM products WHERE id=$1', [p]);
    assert.ok(BigInt(await generation(b)) > BigInt(del));
    const c = await f.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE anon');
      assert.deepEqual(
        (
          await c.query(
            'SELECT merchant_id FROM experience_catalog_generations'
          )
        ).rows,
        [{ merchant_id: a }]
      );
      await assert.rejects(
        c.query('UPDATE experience_catalog_generations SET generation=99'),
        /permission denied/
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  } finally {
    await f.close();
  }
});
