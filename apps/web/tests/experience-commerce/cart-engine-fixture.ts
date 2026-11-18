import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startLocalPostgresFixture } from '../../tools/builder-auth/local-postgres-fixture.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
/** Reuse the exact current cart review setup, stopping before any order test. */
export function cartSetupSql() {
  const program = `import ast,pathlib,sys\nroot=pathlib.Path(sys.argv[1])\nsrc=(root/'supabase/tests/run_commerce_cart_verified_legacy_bridge.py').read_text().replace(".split('-- 7. Bound submission')[0]",".split('-- 1. Prepare')[0]")\ntree=ast.parse(src)\nblock=next(n for n in tree.body if isinstance(n,ast.Try))\nselected=[];started=False\nfor n in block.body:\n if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='tests' for t in n.targets):break\n if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='sql' for t in n.targets):started=True\n if started:selected.append(n)\nexec(compile(ast.Module(body=selected,type_ignores=[]),'<trusted-cart-fixture-setup>','exec'))\nprint(sql)\n`;
  const raw = execFileSync('python3', ['-c', program, ROOT], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10000,
  });
  return `${raw
    .split('\n')
    .map((line) =>
      line.startsWith('\\i ')
        ? readFileSync(line.slice(3), 'utf8')
        : line.startsWith('\\set ')
          ? ''
          : line
    )
    .join('\n')}\nCOMMIT;`;
}
export async function createCommerceEngineFixture() {
  const pg = await startLocalPostgresFixture({
    major: 17,
    binDirectory: '/opt/homebrew/opt/postgresql@17/bin',
  });
  try {
    await pg.pool.query(cartSetupSql());
    if (
      (await pg.pool.query('SELECT count(*) FROM orders')).rows[0].count !== '0'
    )
      throw Error('ORDERS_BOUNDARY');
    return {
      ...pg,
      async call(
        claims: Record<string, unknown>,
        rpc: string,
        args: unknown[]
      ) {
        if (
          ![
            'commerce_cart_create',
            'commerce_cart_mutate',
            'commerce_cart_snapshot',
            'commerce_cart_prepare_checkout',
            'commerce_cart_grant_operations',
          ].includes(rpc)
        )
          throw Error('RPC_BOUNDARY');
        const c = await pg.pool.connect();
        try {
          await c.query('BEGIN');
          await c.query('SET LOCAL ROLE commerce_cart_shopper');
          await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
            JSON.stringify(claims),
          ]);
          const result = await c.query(
            `SELECT public.${rpc}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`,
            args.map((value) =>
              Array.isArray(value) ? JSON.stringify(value) : value
            )
          );
          await c.query('COMMIT');
          return result.rows[0].value;
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        } finally {
          c.release();
        }
      },
    };
  } catch (error) {
    await pg.close();
    throw error;
  }
}
