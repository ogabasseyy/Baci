import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Narrow, read-only Chatwoot account-isolation check. No overall provider
 * qualification is possible from this probe. See the pinned Swagger contract
 * recorded in docs/research/chatwoot-compatibility-results.md.
 */

export interface ChatwootProbeInput {
  baseUrl: string;
  accountAId: string;
  accountAToken: string;
  accountBId: string;
  accountBToken: string;
  conversationId: string;
}

export type IsolationProbeReport = {
  decision: 'unqualified';
  check: 'observed-denial' | 'unknown';
  outcome:
    | 'A-200-B-403-or-404'
    | 'unexpected-response'
    | 'request-failed'
    | 'invalid-configuration';
};

type Fetcher = (input: URL, init: RequestInit) => Promise<Response>;

function isNumericId(value: string): boolean {
  return /^[1-9][0-9]{0,17}$/.test(value);
}

function validateInput(input: ChatwootProbeInput): URL | undefined {
  if (
    !input.baseUrl ||
    !input.accountAToken.trim() ||
    !input.accountBToken.trim() ||
    !isNumericId(input.accountAId) ||
    !isNumericId(input.accountBId) ||
    !isNumericId(input.conversationId) ||
    input.accountAId === input.accountBId ||
    input.accountAToken === input.accountBToken
  )
    return undefined;

  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    return undefined;
  }
  const loopbackHost = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    !loopbackHost ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return undefined;
  return url;
}

async function readStatus(
  url: URL,
  token: string,
  fetcher: Fetcher
): Promise<number | undefined> {
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { api_access_token: token, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    // The check needs only the HTTP status; discard the body without parsing or logging it.
    void response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return undefined;
  }
}

/** Calls the same A-owned conversation path under A and B credentials. */
export async function runChatwootIsolationProbe(
  input: ChatwootProbeInput,
  fetcher: Fetcher = fetch
): Promise<IsolationProbeReport> {
  const baseUrl = validateInput(input);
  if (!baseUrl) {
    return {
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'invalid-configuration',
    };
  }

  const resourceUrl = new URL(
    `/api/v1/accounts/${input.accountAId}/conversations/${input.conversationId}`,
    baseUrl
  );
  const statusA = await readStatus(resourceUrl, input.accountAToken, fetcher);
  if (statusA === undefined) {
    return {
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'request-failed',
    };
  }
  if (statusA !== 200) {
    return {
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'unexpected-response',
    };
  }

  const statusB = await readStatus(resourceUrl, input.accountBToken, fetcher);
  if (statusB === 403 || statusB === 404) {
    return {
      decision: 'unqualified',
      check: 'observed-denial',
      outcome: 'A-200-B-403-or-404',
    };
  }
  return {
    decision: 'unqualified',
    check: 'unknown',
    outcome: statusB === undefined ? 'request-failed' : 'unexpected-response',
  };
}

function inputFromEnvironment(
  environment: Record<string, string | undefined>
): ChatwootProbeInput {
  return {
    baseUrl: environment.CHATWOOT_PROBE_URL ?? '',
    accountAId: environment.CHATWOOT_PROBE_ACCOUNT_A_ID ?? '',
    accountAToken: environment.CHATWOOT_PROBE_ACCOUNT_A_TOKEN ?? '',
    accountBId: environment.CHATWOOT_PROBE_ACCOUNT_B_ID ?? '',
    accountBToken: environment.CHATWOOT_PROBE_ACCOUNT_B_TOKEN ?? '',
    conversationId: environment.CHATWOOT_PROBE_CONVERSATION_ID ?? '',
  };
}

async function main(): Promise<void> {
  const report = await runChatwootIsolationProbe(
    inputFromEnvironment(process.env)
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.check === 'observed-denial' ? 0 : 1;
}

const modulePath = realpathSync(fileURLToPath(import.meta.url));
function isModuleEntrypoint(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  try {
    return realpathSync(entryPath) === modulePath;
  } catch {
    return false;
  }
}

if (isModuleEntrypoint()) void main();
