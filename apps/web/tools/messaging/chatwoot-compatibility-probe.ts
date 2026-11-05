import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Agent } from 'undici';

/** Narrow, read-only Chatwoot cross-token conversation-detail status probe.
 * It makes no isolation or overall provider qualification claim. See the pinned Swagger contract
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
  check: 'observed-status' | 'adverse-status' | 'unknown';
  outcome:
    | 'positive-control-failed'
    | 'cross-token-status-200-after-positive-controls'
    | 'cross-token-status-401-after-positive-controls'
    | 'cross-token-status-403-after-positive-controls'
    | 'cross-token-status-404-after-positive-controls'
    | 'unexpected-response'
    | 'request-failed'
    | 'invalid-configuration';
};

type ProbeRequestInit = {
  method: 'GET';
  headers: Record<string, string>;
  redirect: 'manual';
  signal: AbortSignal;
};

type StatusResponse = Pick<Response, 'status'> & {
  body?: { cancel: () => Promise<void> } | null;
};

type Fetcher = (input: URL, init: ProbeRequestInit) => Promise<StatusResponse>;

function isNumericId(value: string): boolean {
  return /^[1-9][0-9]{0,17}$/.test(value);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function validateInput(input: ChatwootProbeInput): URL | undefined {
  if (
    !input.baseUrl ||
    !input.accountAToken.trim() ||
    !input.accountBToken.trim() ||
    hasControlCharacters(input.accountAToken) ||
    hasControlCharacters(input.accountBToken) ||
    input.accountAToken !== input.accountAToken.trim() ||
    input.accountBToken !== input.accountBToken.trim() ||
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
    url.pathname !== '/' ||
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
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch {
    return undefined;
  }
}

/** Runs B's own-list positive control, A's detail positive control, then B's
 * token against the same A-account conversation detail path.
 */
export async function runChatwootIsolationProbe(
  input: ChatwootProbeInput,
  fetcher?: Fetcher
): Promise<IsolationProbeReport> {
  const baseUrl = validateInput(input);
  if (!baseUrl) {
    return {
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'invalid-configuration',
    };
  }

  const dispatcher = fetcher ? undefined : new Agent();
  const request =
    fetcher ??
    ((url: URL, init: ProbeRequestInit) =>
      fetch(url, { ...init, dispatcher } as Parameters<typeof fetch>[1]));

  try {
    return await runValidatedProbe(input, baseUrl, request);
  } finally {
    await dispatcher?.close();
  }
}

async function runValidatedProbe(
  input: ChatwootProbeInput,
  baseUrl: URL,
  fetcher: Fetcher
): Promise<IsolationProbeReport> {
  const bListUrl = new URL(
    `/api/v1/accounts/${input.accountBId}/conversations`,
    baseUrl
  );
  const statusBList = await readStatus(bListUrl, input.accountBToken, fetcher);
  if (statusBList === undefined) {
    return {
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'request-failed',
    };
  }
  if (statusBList !== 200) {
    return {
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'positive-control-failed',
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
      outcome: 'positive-control-failed',
    };
  }

  const statusB = await readStatus(resourceUrl, input.accountBToken, fetcher);
  if (statusB === 200) {
    return {
      decision: 'unqualified',
      check: 'adverse-status',
      outcome: 'cross-token-status-200-after-positive-controls',
    };
  }
  if (statusB === 401 || statusB === 403 || statusB === 404) {
    return {
      decision: 'unqualified',
      check: 'observed-status',
      outcome: `cross-token-status-${statusB}-after-positive-controls`,
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
  process.exitCode = report.check === 'observed-status' ? 0 : 1;
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
