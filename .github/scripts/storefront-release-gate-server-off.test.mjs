import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findMissingServerOffTests,
  hasLiveAssertion,
  importsModule,
  isPiggyvestSource,
  isShippedSource,
  serverOffTestPaths,
} from './storefront-release-gate-server-off.mjs';

const APP = 'apps/mobile-storefront';
const LIVE = "\nit('off', () => { expect(1).toBe(1); });";

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
    `${APP}/schemas/customer-savings-drafts.test-fixture.ts`,
    `${APP}/components/wallet/WalletHome-test-harness.tsx`,
    `${APP}/components/wallet/wallet-checkout.test-utils.tsx`,
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
    [`${APP}/hooks/use-wallet-pin-proof.server-off.test.tsx`]: `import { useWalletPinProof } from './use-wallet-pin-proof';${LIVE}`,
    [`${APP}/__tests__/app/wallet/savings/index.server-off.test.tsx`]: `import Screen from '@/app/wallet/savings';${LIVE}`,
  };
  const newFiles = [...Object.keys(contents).slice(0, 5), `${APP}/components/wallet/WalletPinSheet.test.tsx`];
  const tracked = [...newFiles, ...Object.keys(contents).slice(5)];
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
  assert.deepEqual(read.sort(), [
    `${APP}/__tests__/app/wallet/savings/index.server-off.test.tsx`,
    `${APP}/components/product/ProductCard.tsx`,
    `${APP}/hooks/use-wallet-pin-proof.server-off.test.tsx`,
    `${APP}/lib/read-spend-error.ts`,
  ]);
});

test('a server-off test counts only when it imports the file it covers', () => {
  const sheet = `${APP}/components/wallet/WalletPinSheet.tsx`;
  const colocated = `${APP}/components/wallet/WalletPinSheet.server-off.test.tsx`;
  const mirrored = `${APP}/__tests__/components/wallet/WalletPinSheet.server-off.test.tsx`;
  const check = (testContent, testPath = colocated, live = LIVE) =>
    findMissingServerOffTests({
      newFiles: [sheet],
      tracked: [sheet, testPath],
      readContent: (path) => (path === testPath ? testContent + live : 'export function WalletPinSheet() {}'),
    });
  for (const text of [
    "import { WalletPinSheet } from './WalletPinSheet';",
    "import { WalletPinSheet } from '@/components/wallet/WalletPinSheet';",
    "const { WalletPinSheet } = require('./WalletPinSheet.tsx');",
    'const { WalletPinSheet } = await import("@/components/wallet/WalletPinSheet");',
    "import {\n  WalletPinSheet,\n} from './WalletPinSheet';",
  ]) {
    assert.deepEqual(check(text), [], text);
  }
  assert.deepEqual(check("import { WalletPinSheet } from '../../../components/wallet/WalletPinSheet';", mirrored), []);
  for (const text of [
    "test('off', () => {});",
    "import { WalletPinKeypad } from './WalletPinKeypad';",
    "import { WalletPinSheet } from './wallet/WalletPinSheet';",
    "jest.mock('./WalletPinSheet');",
    "// import { WalletPinSheet } from './WalletPinSheet';",
  ]) {
    assert.deepEqual(check(text), [{ file: sheet, expected: colocated, test: colocated }], text);
  }
  const index = `${APP}/components/wallet/savings/index.tsx`;
  const indexTest = `${APP}/components/wallet/savings/index.server-off.test.tsx`;
  const covered = findMissingServerOffTests({
    newFiles: [index],
    tracked: [index, indexTest],
    readContent: (path) => (path === indexTest ? `import { Savings } from '@/components/wallet/savings';${LIVE}` : ''),
  });
  assert.deepEqual(covered, []);
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

test('a server-off test needs a live test with an assertion, not only an import or skipped tests', () => {
  for (const text of [
    "it('off', () => { expect(x).toBe(1); });",
    "test('off', async () => { expect(await run()).toBeNull(); });",
    "describe('off', () => { it.each([1, 2])('n %s', (n) => { expect(n).toBeTruthy(); }); });",
    "it('off', () => { assert.equal(a, b); });",
    "test.only('off', () => { expect(1).toBe(1); });",
    "it('skipped', () => {});\nit('live', () => { expect(1).toBe(1); });",
    "describe.skip('old', () => { it('a', () => { expect(1).toBe(1); }); });\nit('live', () => { expect(2).toBe(2); });",
    "xdescribe('old', () => {});\ndescribe('on', () => { test('b', () => { assert.ok(true); }); });",
  ]) {
    assert.equal(hasLiveAssertion(text), true, text);
  }
  for (const text of [
    '',
    "import { Sheet } from './Sheet';",
    "it.skip('off', () => { expect(1).toBe(1); });",
    "xit('off', () => { expect(1).toBe(1); });",
    "test.skip('off', () => { expect(1).toBe(1); });",
    "it.todo('off');",
    "xtest('off', () => { expect(1).toBe(1); });",
    "describe.skip('off', () => { it('a', () => { expect(1).toBe(1); }); });",
    "xdescribe('off', () => { it('a', () => { expect(1).toBe(1); }); });",
    "it('off', () => {});",
    "it('off', () => {});\nexpect(1).toBe(1);",
    "describe('x', () => { expect(1).toBe(1); it('live', () => { render(); }); });",
    "it('off', () => { render(<Sheet />); });",
    "// it('off', () => { expect(1).toBe(1); });",
    "/* it('off', () => { expect(1).toBe(1); }); */",
    "it('off', () => { /* expect(1).toBe(1) */ });",
  ]) {
    assert.equal(hasLiveAssertion(text), false, text);
  }
});

test('an import-only or skipped test does not cover a PiggyVest file', () => {
  const sheet = `${APP}/components/wallet/WalletPinSheet.tsx`;
  const test = `${APP}/components/wallet/WalletPinSheet.server-off.test.tsx`;
  for (const body of [
    "import { WalletPinSheet } from './WalletPinSheet';",
    "import { WalletPinSheet } from './WalletPinSheet';\nit.skip('off', () => { expect(WalletPinSheet).toBeDefined(); });",
    "import { WalletPinSheet } from './WalletPinSheet';\nit('off', () => {});",
  ]) {
    const missing = findMissingServerOffTests({
      newFiles: [sheet],
      tracked: [sheet, test],
      readContent: (path) => (path === test ? body : ''),
    });
    assert.deepEqual(missing, [{ file: sheet, expected: test, test }], body);
  }
});

test('an assertion inside a skipped test does not count', () => {
  const skippedAssert = "it.skip('a', () => { expect(1).toBe(1); });";
  for (const skipped of [skippedAssert, skippedAssert.replace('it.skip', 'xit'), skippedAssert.replace('it.skip', 'test.skip'), skippedAssert.replace('it.skip', 'xtest')]) {
    assert.equal(hasLiveAssertion(`${skipped}\nit('live', () => { render(); });`), false, skipped);
  }
  const nested = "it.skip('a', () => { call(() => { expect(')').toBe(1); }); });\nit('live', () => {});";
  assert.equal(hasLiveAssertion(nested), false);
  assert.equal(hasLiveAssertion(`${skippedAssert}\nit('live', () => { expect(2).toBe(2); });`), true);
});

test('goal files are PiggyVest storefront files', () => {
  assert.equal(isPiggyvestSource(`${APP}/components/goals/GoalSheet.tsx`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/app/goal/index.tsx`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/components/goalkeeper/Mitt.tsx`, ''), false);
});

test('a type-only import does not load the module', () => {
  const source = `${APP}/components/wallet/Sheet.tsx`;
  const test = `${APP}/components/wallet/Sheet.server-off.test.tsx`;
  assert.equal(importsModule(test, "import type { Sheet } from './Sheet';", source), false);
  assert.equal(importsModule(test, "import type {\n  Sheet,\n} from './Sheet';", source), false);
  assert.equal(importsModule(test, "export type { Sheet } from './Sheet';", source), false);
  assert.equal(importsModule(test, "import { type Sheet, render } from './Sheet';", source), true);
});

test('spend files and files using wallet, savings or goal helpers are PiggyVest files', () => {
  assert.equal(isPiggyvestSource(`${APP}/components/spend/SpendSheet.tsx`, ''), true);
  assert.equal(isPiggyvestSource(`${APP}/hooks/use-pin.ts`, 'const proof = useWalletPinProof();'), true);
  assert.equal(isPiggyvestSource(`${APP}/hooks/use-pin.ts`, 'const goal = useSavingsGoal();'), true);
  assert.equal(isPiggyvestSource(`${APP}/components/Button.tsx`, 'export const Button = 1;'), false);
});
