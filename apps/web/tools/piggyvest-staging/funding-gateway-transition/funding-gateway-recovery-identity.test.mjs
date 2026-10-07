import { expect, it } from 'vitest';
import {
  parseState,
  validateBinding,
} from './funding-gateway-recovery-identity.mjs';

const deadline = 1790697550000;
const binding = () => ({
  identity: {
    restRoutes: [
      { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
      { path: '/rest/v1/customers', methods: ['GET', 'HEAD'] },
      { path: '/rest/v1/merchants', methods: ['GET', 'HEAD'] },
      {
        path: '/rest/v1/rpc/customer_savings_draft_command',
        methods: ['POST'],
      },
      {
        path: '/rest/v1/rpc/get_storefront_product_variants',
        methods: ['POST'],
      },
    ],
  },
  leaseExpiresAt: new Date(deadline).toISOString(),
  leaseNotBefore: new Date(deadline - 7 * 86400000).toISOString(),
  reviewedAt: new Date(deadline - 7 * 86400000).toISOString(),
  version: 1,
});

it('allows blank values only for allowlisted properties', () => {
  const state = parseState(
    'MainPID=0\nDropInPaths=\nActiveState=active',
    ['MainPID', 'DropInPaths', 'ActiveState'],
    ['DropInPaths']
  );
  expect(state).toEqual({
    MainPID: '0',
    DropInPaths: '',
    ActiveState: 'active',
  });
  expect(() =>
    parseState('MainPID=\nActiveState=active', ['MainPID', 'ActiveState'])
  ).toThrow();
});

it('rejects bindings with an unexpected key set or version', () => {
  const extra = { ...binding(), unexpected: true };
  expect(() => validateBinding(extra, deadline - 1)).toThrow();
  const wrongVersion = { ...binding(), version: 2 };
  expect(() => validateBinding(wrongVersion, deadline - 1)).toThrow();
  expect(() => validateBinding(null, deadline - 1)).toThrow();
});

it('rejects an already-expired lease', () => {
  expect(() => validateBinding(binding(), deadline)).toThrow();
  expect(() => validateBinding(binding(), deadline + 1)).toThrow();
});
