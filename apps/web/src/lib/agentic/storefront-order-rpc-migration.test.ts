import { describe, expect, it } from 'vitest';
import { definesOrPatchesStorefrontOrderRpc } from './storefront-order-rpc-migration.test-support';

describe('exact storefront order RPC migration discovery', () => {
  it.each([
    'CREATE OR REPLACE FUNCTION public.create_storefront_order(',
    'CREATE OR REPLACE FUNCTION "public"."create_storefront_order" (',
    'CREATE OR REPLACE FUNCTION create_storefront_order(',
    "SELECT pg_get_functiondef('public.create_storefront_order(uuid,text)'::regprocedure);",
    "EXECUTE 'CREATE OR REPLACE FUNCTION public.create_storefront_order(uuid)';",
  ])('keeps exact base RPC definitions and dynamic patches: %s', (sql) => {
    expect(definesOrPatchesStorefrontOrderRpc(sql)).toBe(true);
  });

  it.each([
    'create_storefront_order_with_cart_binding',
    'create_storefront_order_unchecked',
  ])('excludes a sibling function patch: %s', (name) => {
    expect(
      definesOrPatchesStorefrontOrderRpc(
        `SELECT pg_get_functiondef('public.${name}(text,uuid)'::regprocedure);`
      )
    ).toBe(false);
    expect(
      definesOrPatchesStorefrontOrderRpc(
        `CREATE OR REPLACE FUNCTION public.${name}(`
      )
    ).toBe(false);
    expect(
      definesOrPatchesStorefrontOrderRpc(
        `EXECUTE 'CREATE OR REPLACE FUNCTION public.${name}(uuid)';`
      )
    ).toBe(false);
  });
});
