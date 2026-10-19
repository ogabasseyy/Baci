import 'server-only';

export const GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT =
  'GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT' as const;
export const GOOGLE_ADS_MANAGER_DEPTH_LIMIT =
  'GOOGLE_ADS_MANAGER_DEPTH_LIMIT' as const;
export const GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT =
  'GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT' as const;
export const GOOGLE_ADS_DISCOVERY_LIMIT_CODES = [
  GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT,
  GOOGLE_ADS_MANAGER_DEPTH_LIMIT,
  GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT,
] as const;

const GOOGLE_ADS_MANAGER_DISCOVERY_QUERY = [
  'SELECT customer_client.client_customer, customer_client.level,',
  'customer_client.manager',
  'FROM customer_client',
  'WHERE customer_client.level <= 1',
].join(' ');

const GOOGLE_ADS_MAX_MANAGER_DEPTH = 5;
const GOOGLE_ADS_MAX_DISCOVERED_CUSTOMERS = 1_000;
const GOOGLE_ADS_MAX_MANAGER_PROBES = 20;
const GOOGLE_ADS_MANAGER_DISCOVERY_CONCURRENCY = 4;

type GoogleAdsManagerClient = {
  customerId: string;
  manager: boolean;
};

type GoogleAdsManagerDiscoveryResult = {
  clients: GoogleAdsManagerClient[];
  isManager: boolean;
};

type DiscoveryQueueEntry = {
  depth: number;
  id: string;
};

type DiscoveryErrorFactory = (code: string, status?: number) => Error;

type AccountDiscoveryInput = {
  apiRoot: string;
  createError: DiscoveryErrorFactory;
  directCustomerIds: string[];
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
};

const GOOGLE_ADS_NON_MANAGER_ERROR_CODES = new Set([
  'CUSTOMER_NOT_A_MANAGER',
  'CUSTOMER_NOT_MANAGER',
  'CUSTOMER_NOT_MANAGER_ACCOUNT',
  'NON_MANAGER_CUSTOMER',
  'NOT_A_MANAGER',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasNonManagerError(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasNonManagerError);
  if (!isRecord(value)) return false;

  const errorCode = value.errorCode ?? value.error_code;
  if (isRecord(errorCode)) {
    for (const code of Object.values(errorCode)) {
      if (
        typeof code === 'string' &&
        GOOGLE_ADS_NON_MANAGER_ERROR_CODES.has(code)
      ) {
        return true;
      }
    }
  }

  const message = value.message;
  if (
    typeof message === 'string' &&
    /\bcustomer\b[^.\n]{0,80}\b(?:is|was|isn't|is not)\b[^.\n]{0,40}\b(?:a )?manager(?: account)?\b/i.test(
      message
    )
  ) {
    return true;
  }

  return Object.values(value).some(hasNonManagerError);
}

async function isConfirmedNonManagerResponse(
  response: Response
): Promise<boolean> {
  try {
    const payload: unknown = await response.json();
    return hasNonManagerError(payload);
  } catch {
    return false;
  }
}

function parseGoogleAdsCustomerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const customerId = value.replace(/^customers\//, '');
  return /^\d{10}$/.test(customerId) ? customerId : null;
}

async function listGoogleAdsManagerClients(
  customerId: string,
  input: AccountDiscoveryInput
): Promise<GoogleAdsManagerDiscoveryResult> {
  const response = await input.fetchImpl(
    `${input.apiRoot}/customers/${customerId}/googleAds:searchStream`,
    {
      body: JSON.stringify({ query: GOOGLE_ADS_MANAGER_DISCOVERY_QUERY }),
      headers: {
        ...input.headers,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }
  );
  // A normal, non-manager customer rejects the customer_client query with a
  // provider error that identifies the account as non-manager. Only that
  // explicit signal is safe to treat as a leaf; malformed, inaccessible, or
  // otherwise unexpected 4xx responses must remain discovery failures.
  if (
    (response.status === 400 || response.status === 404) &&
    (await isConfirmedNonManagerResponse(response))
  ) {
    return { clients: [], isManager: false };
  }
  if (!response.ok) {
    throw input.createError(
      'GOOGLE_ADS_MANAGER_ACCOUNT_DISCOVERY_FAILED',
      response.status
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw input.createError(
      'GOOGLE_ADS_MANAGER_ACCOUNT_DISCOVERY_RESPONSE_INVALID'
    );
  }
  const clients: GoogleAdsManagerClient[] = [];
  for (const batch of payload) {
    if (
      batch === null ||
      typeof batch !== 'object' ||
      !Array.isArray((batch as { results?: unknown }).results)
    )
      throw input.createError(
        'GOOGLE_ADS_MANAGER_ACCOUNT_DISCOVERY_RESPONSE_INVALID'
      );
    for (const result of (batch as { results: unknown[] }).results) {
      if (result === null || typeof result !== 'object') continue;
      const customerClient = (result as { customerClient?: unknown })
        .customerClient;
      if (customerClient === null || typeof customerClient !== 'object') {
        continue;
      }
      const parsedCustomerId = parseGoogleAdsCustomerId(
        (customerClient as { clientCustomer?: unknown }).clientCustomer
      );
      if (!parsedCustomerId) continue;
      clients.push({
        customerId: parsedCustomerId,
        manager: (customerClient as { manager?: unknown }).manager === true,
      });
    }
  }
  return { clients, isManager: true };
}

export async function discoverGoogleAdsCustomerIds(
  input: AccountDiscoveryInput
): Promise<string[]> {
  const discoveredCustomerIds = new Set<string>();
  const knownCustomerIds = new Set(input.directCustomerIds);
  const queue: DiscoveryQueueEntry[] = [
    ...new Set(input.directCustomerIds),
  ].map((id) => ({ depth: 0, id }));
  const queuedManagerIds = new Set(queue.map(({ id }) => id));
  const visitedManagers = new Set<string>();
  let probes = 0;

  while (queue.length > 0) {
    if (knownCustomerIds.size >= GOOGLE_ADS_MAX_DISCOVERED_CUSTOMERS) {
      throw input.createError(GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT);
    }
    if (probes >= GOOGLE_ADS_MAX_MANAGER_PROBES) {
      throw input.createError(GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT);
    }

    const batch: DiscoveryQueueEntry[] = [];
    while (
      batch.length < GOOGLE_ADS_MANAGER_DISCOVERY_CONCURRENCY &&
      queue.length > 0 &&
      probes + batch.length < GOOGLE_ADS_MAX_MANAGER_PROBES
    ) {
      const next = queue[0];
      if (!next || next.depth >= GOOGLE_ADS_MAX_MANAGER_DEPTH) break;
      queue.shift();
      queuedManagerIds.delete(next.id);
      if (visitedManagers.has(next.id)) continue;
      visitedManagers.add(next.id);
      batch.push(next);
    }
    if (batch.length === 0) {
      throw input.createError(GOOGLE_ADS_MANAGER_DEPTH_LIMIT);
    }

    probes += batch.length;
    const results = await Promise.all(
      batch.map(async (next) => {
        const discovery = await listGoogleAdsManagerClients(next.id, input);
        return { ...discovery, depth: next.depth, id: next.id };
      })
    );
    for (const result of results) {
      if (!result.isManager) {
        discoveredCustomerIds.add(result.id);
      }
      for (const client of result.clients) {
        knownCustomerIds.add(client.customerId);
        if (knownCustomerIds.size > GOOGLE_ADS_MAX_DISCOVERED_CUSTOMERS) {
          throw input.createError(GOOGLE_ADS_ACCOUNT_DISCOVERY_LIMIT);
        }
        if (!client.manager) {
          discoveredCustomerIds.add(client.customerId);
        }
        if (
          client.manager &&
          !visitedManagers.has(client.customerId) &&
          !queuedManagerIds.has(client.customerId)
        ) {
          queue.push({ depth: result.depth + 1, id: client.customerId });
          queuedManagerIds.add(client.customerId);
        }
      }
    }
  }

  return [...discoveredCustomerIds];
}
