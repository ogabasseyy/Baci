import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findMissingServerOffTests,
  isPiggyvestSource,
  isShippedSource,
  serverOffTestPaths,
} from './storefront-release-gate-server-off.mjs';

const APP = 'apps/mobile-storefront';

test('counts only storefront source that ships in the app bundle', () => {
  for (const path of [
    `${APP}/components/wallet/WalletPinSheet.tsx`,
    `${APP}/hooks/use-wallet-pin-proof.ts`,
    `${APP}/app/wallet/savings/index.tsx`,
    `${APP}/lib/piggyvest/plan-wallet-service.js`,
  ]) {
    assert.equal(isShippedSource(path), true, path);
  }
  for (const path of [
    `${APP}/components/wallet/WalletPinSheet.test.tsx`,
    `${APP}/components/wallet/WalletPinSheet.server-off.test.tsx`,
    `${APP}/components/wallet/wallet-pin.test-support.ts`,
    `${APP}/components/wallet/WalletPinSheet.styles.ts`,
    `${APP}/components/wallet/WalletPinSheet.types.ts`,
    `${APP}/types/piggyvest.d.ts`,
    `${APP}/__tests__/app/wallet/index.test.tsx`,
    `${APP}/__mocks__/piggyvest.js`,
    `${APP}/test-support/wallet-checkout-fixture.tsx`,
    `${APP}/scripts/check-module-size.ts`,
    `${APP}/tools/piggyvest-report.ts`,
    `${APP}/components/wallet/piggyvest-copy.json`,
    'apps/mobile-admin/components/wallet/WalletPinSheet.tsx',
    'packages/shared/src/piggyvest/state.ts',
  ]) {
    assert.equal(isShippedSource(path), false, path);
  }
});

test('treats PiggyVest-named, wallet and savings paths, and PiggyVest-mentioning code as PiggyVest files', () => {
  assert.equal(isPiggyvestSource(`${APP}/lib/piggyvest-primary-wallet-state.ts`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/components/PiggyVestBadge.tsx`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/components/wallet/pin/PinKeypad.tsx`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/app/wallet/savings/index.tsx`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/hooks/use-savings-goal.ts`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/lib/read-spend-error.ts`, "import { PIGGYVEST_SPEND_CODES } from './codes';"), true);
  assert.equal(isPiggyvestSource(`${APP}/lib/read-spend-error.ts`, 'const provider = "Piggy Vest";'), true);
  assert.equal(isPiggyvestSource(`${APP}/components/product/ProductCard.tsx`, 'export function ProductCard() {}'), false);
});

test('expects a colocated server-off test, or the __tests__ mirror; Expo Router screens use only the mirror', () => {
  assert.deepEqual(serverOffTestPaths(`${APP}/components/wallet/WalletPinSheet.tsx`), [
    `${APP}/components/wallet/WalletPinSheet.server-off.test.tsx`,
    `${APP}/__tests__/components/wallet/WalletPinSheet.server-off.test.tsx`,
  ]);
  assert.deepEqual(serverOffTestPaths(`${APP}/hooks/use-wallet-pin-proof.ts`), [
    `${APP}/hooks/use-wallet-pin-proof.server-off.test.tsx`,
    `${APP}/__tests__/hooks/use-wallet-pin-proof.server-off.test.tsx`,
  ]);
  assert.deepEqual(serverOffTestPaths(`${APP}/app/wallet/savings/index.tsx`), [
    `${APP}/__tests__/app/wallet/savings/index.server-off.test.tsx`,
  ]);
});

test('reports each new PiggyVest file that lacks its server-off test', () => {
  const contents = {
    [`${APP}/components/wallet/WalletPinSheet.tsx`]: 'export function WalletPinSheet() {}',
    [`${APP}/hooks/use-wallet-pin-proof.ts`]: 'export function useWalletPinProof() {}',
    [`${APP}/app/wallet/savings/index.tsx`]: 'export default function Screen() {}',
    [`${APP}/lib/read-spend-error.ts`]: "export const code = 'PIGGYVEST_LIMIT';",
    [`${APP}/components/product/ProductCard.tsx`]: 'export function ProductCard() {}',
  };
  const newFiles = [...Object.keys(contents), `${APP}/components/wallet/WalletPinSheet.test.tsx`];
  const tracked = [
    ...newFiles,
    `${APP}/hooks/use-wallet-pin-proof.server-off.test.tsx`,
    `${APP}/__tests__/app/wallet/savings/index.server-off.test.tsx`,
  ];
  const read = [];
  const missing = findMissingServerOffTests({
    newFiles,
    tracked,
    readContent: (path) => {
      read.push(path);
      return contents[path];
    },
  });
  assert.deepEqual(missing, [
    {
      file: `${APP}/components/wallet/WalletPinSheet.tsx`,
      expected: `${APP}/components/wallet/WalletPinSheet.server-off.test.tsx`,
    },
    {
      file: `${APP}/lib/read-spend-error.ts`,
      expected: `${APP}/lib/read-spend-error.server-off.test.tsx`,
    },
  ]);
  assert.deepEqual(read.sort(), [`${APP}/components/product/ProductCard.tsx`, `${APP}/lib/read-spend-error.ts`]);
});

test('a server-off test next to an app/ screen does not count: storefront screen tests live under __tests__/app', () => {
  const screen = `${APP}/app/wallet/pin.tsx`;
  const missing = findMissingServerOffTests({
    newFiles: [screen],
    tracked: [screen, `${APP}/app/wallet/pin.server-off.test.tsx`],
    readContent: () => '',
  });
  assert.deepEqual(missing, [{ file: screen, expected: `${APP}/__tests__/app/wallet/pin.server-off.test.tsx` }]);
});
