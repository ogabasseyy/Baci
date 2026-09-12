import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { privilegedCallerAnalysis } from './agentic-dva-caller-contract-test-support';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../..'
);
const excludedDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  '.worktrees',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);
const sourceFiles = collectSourceFiles(repositoryRoot);
const sourcesByPath = new Map(
  sourceFiles.map(({ path, source }) => [path, source])
);

const privilegedFunctions = [
  'createAgenticCheckoutPaymentAccount',
  'createDedicatedAccount',
  'createDedicatedAccountForWallet',
  'createDedicatedVirtualAccount',
  'generatePaymentAccount',
  'getDedicatedAccounts',
] as const;
type PrivilegedFunction = (typeof privilegedFunctions)[number];
const expectedCallers: Record<PrivilegedFunction, readonly string[]> = {
  createAgenticCheckoutPaymentAccount: [
    'apps/web/src/lib/agentic/checkout-payment-setup.ts',
  ],
  createDedicatedAccount: [
    'apps/web/src/lib/merchant-wallet-payment-accounts.ts',
    'apps/web/src/lib/paystack.ts',
  ],
  createDedicatedAccountForWallet: [
    'apps/web/src/lib/customer-wallet-payment-accounts.ts',
  ],
  createDedicatedVirtualAccount: [
    'apps/web/src/app/api/payments/initialize/route.ts',
    'apps/web/src/lib/agentic/checkout-payment-account.ts',
  ],
  generatePaymentAccount: [
    'apps/web/mcp-server/server.ts',
    'apps/web/src/app/api/orders/[id]/generate-dva/route.ts',
    'apps/web/src/app/api/orders/[id]/ship-on-credit/provision-credit-order-dva.ts',
    'apps/web/src/app/api/orders/route.ts',
  ],
  getDedicatedAccounts: [
    'apps/web/src/lib/customer-wallet-payment-accounts.ts',
    'apps/web/src/lib/paystack.ts',
    'apps/web/src/lib/resume-merchant-wallet-funding-request.ts',
  ],
} as const;
const definitionPaths = {
  createAgenticCheckoutPaymentAccount:
    'apps/web/src/lib/agentic/checkout-payment-account.ts',
  createDedicatedAccount: 'apps/web/src/lib/paystack.ts',
  createDedicatedAccountForWallet: 'apps/web/src/lib/paystack.ts',
  createDedicatedVirtualAccount: 'apps/web/src/lib/agentic/paystack.ts',
  generatePaymentAccount: 'apps/web/src/lib/paystack.ts',
  getDedicatedAccounts: 'apps/web/src/lib/paystack.ts',
} as const;
const dedicatedAccountEndpointPattern =
  /["'`]\/dedicated_account(?:\?|\/|["'`])/;

describe('Paystack DVA caller contract', () => {
  it('keeps every raw dedicated-account endpoint in the reviewed boundaries', () => {
    expect(
      sourceFiles
        .filter(({ source }) => dedicatedAccountEndpointPattern.test(source))
        .map(({ path }) => path)
    ).toEqual([
      'apps/web/src/lib/agentic/paystack.ts',
      'apps/web/src/lib/paystack.ts',
    ]);
    const endpointFiles = sourceFiles
      .filter(({ source }) => dedicatedAccountEndpointPattern.test(source))
      .map(({ path }) => path);

    expect(
      dedicatedAccountEndpointPattern.test(
        String.raw`paystackRequest(\`/dedicated_account/\${accountId}\`)`
      )
    ).toBe(true);

    expect(endpointFiles).toEqual([
      'apps/web/src/lib/agentic/paystack.ts',
      'apps/web/src/lib/paystack.ts',
    ]);
    expect(
      countMatches(
        readSource('apps/web/src/lib/agentic/paystack.ts'),
        /["'`]\/dedicated_account["'`]/g
      )
    ).toBe(1);
    expect(
      countMatches(
        readSource('apps/web/src/lib/paystack.ts'),
        /["'`]\/dedicated_account["'`]/g
      )
    ).toBe(2);
    expect(
      countMatches(
        readSource('apps/web/src/lib/paystack.ts'),
        /["'`]\/dedicated_account\?customer=/g
      )
    ).toBe(1);
  });

  it.each([
    ["'/dedicated_account'", true],
    ["'/dedicated_account?customer=customer-1'", true],
    ['`/dedicated_account/$' + '{accountId}`', true],
    ['`/dedicated_account/dedicated_account`', true],
    ['`prefix/dedicated_account`', false],
    ["'dedicated_account'", false],
    ["'/not_dedicated_account'", false],
  ])('matches only a raw dedicated-account endpoint form: %s', (source, expected) => {
    expect(dedicatedAccountEndpointPattern.test(source)).toBe(expected);
  });

  it.each(
    privilegedFunctions
  )('keeps %s on its exact caller allowlist', (functionName) => {
    expect(findCallers(functionName, definitionPaths[functionName])).toEqual(
      expectedCallers[functionName]
    );
  }, 30_000);

  it('keeps the paused gate ahead of agentic payment setup', () => {
    const handler = readSource(
      'apps/web/src/app/api/agentic/checkout_sessions/[id]/complete/checkout-session-complete-handler.ts'
    );
    const gateIndex = handler.indexOf(
      'resolveAgenticPaystackDvaCompletionGate('
    );
    const rejectionIndex = handler.indexOf("pauseGate === 'reject_paused'");
    const setupIndex = handler.indexOf('prepareAgenticCheckoutPayment(');

    expect(gateIndex).toBeGreaterThan(-1);
    expect(rejectionIndex).toBeGreaterThan(gateIndex);
    expect(setupIndex).toBeGreaterThan(rejectionIndex);
  });

  it('keeps the legacy MCP DVA tool behind the same strict mode gate', () => {
    const server = readSource('apps/web/mcp-server/server.ts');
    const access = readSource('apps/web/mcp-server/mcp-paystack-dva-access.ts');
    const availabilityIndex = access.indexOf(
      'resolveMcpPaystackDvaToolAvailability('
    );
    const modeIndex = server.indexOf('resolveMcpPaystackDvaAccess()');
    const registrationIndex = server.indexOf("'generate_payment_account'");
    const providerIndex = server.indexOf('generatePaymentAccount({');

    expect(availabilityIndex).toBeGreaterThan(-1);
    expect(modeIndex).toBeGreaterThan(-1);
    expect(registrationIndex).toBeGreaterThan(modeIndex);
    expect(providerIndex).toBeGreaterThan(registrationIndex);
  });

  it('keeps legacy MCP status reads from disclosing an account while paused', () => {
    const server = readSource('apps/web/mcp-server/server.ts');
    const access = readSource('apps/web/mcp-server/mcp-paystack-dva-access.ts');
    const statusIndex = server.indexOf("'check_payment_status'");
    const disclosureGateIndex = server.indexOf(
      'paystackDvaAccess.getDisclosableStoredDva(',
      statusIndex
    );
    const accountUseIndex = server.indexOf(
      'storedDva.accountNumber',
      statusIndex
    );
    const modeGateIndex = access.indexOf('if (!toolEnabled');
    const accountReadIndex = access.indexOf('typeof value.account_number');

    expect(statusIndex).toBeGreaterThan(-1);
    expect(disclosureGateIndex).toBeGreaterThan(statusIndex);
    expect(accountUseIndex).toBeGreaterThan(disclosureGateIndex);
    expect(modeGateIndex).toBeGreaterThan(-1);
    expect(accountReadIndex).toBeGreaterThan(modeGateIndex);
    expect(server.slice(disclosureGateIndex)).toContain('...(storedDva');
  });

  it('keeps the cutover drain free of provider account helpers', () => {
    const drain = readSource(
      'apps/web/src/scripts/drain-agentic-dva-consent-cutover.ts'
    );

    for (const functionName of Object.keys(expectedCallers)) {
      expect(drain).not.toMatch(new RegExp(`\\b${functionName}\\b`));
    }
    expect(drain).not.toContain('/dedicated_account');
  });

  it('does not expose cutover helpers before an operator boundary is approved', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'apps/web/package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).not.toHaveProperty('agentic:dva-cutover:audit');
    expect(packageJson.scripts).not.toHaveProperty('agentic:dva-cutover:drain');
  });
});

function collectSourceFiles(
  directory: string
): Array<{ path: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name)
          ? []
          : collectSourceFiles(absolutePath);
      }
      if (!['.js', '.mjs', '.ts', '.tsx'].includes(extname(entry.name)))
        return [];
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      return [
        {
          path: relative(repositoryRoot, absolutePath),
          source: readFileSync(absolutePath, 'utf8'),
        },
      ];
    })
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function findCallers(functionName: string, definitionPath: string): string[] {
  return sourceFiles
    .filter((file) =>
      privilegedCallerAnalysis.countCalls({
        definitionPath,
        file,
        functionName,
        sourcesByPath,
      })
    )
    .map(({ path }) => path);
}

function readSource(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}
