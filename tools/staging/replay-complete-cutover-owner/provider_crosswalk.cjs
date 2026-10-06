const boundedJson = require('./provider_json.cjs');

const origin = 'https://staging.piggyvest.business';
const deadline = '2026-10-06T15:59:10Z';
const maximum = 1024 * 1024;
const pins = {
  business: '01M2381RG34HQJMHQKE7DWDACR',
  customer: 'c096507d-dc32-45d2-9c01-871a27abfd10',
  apiCustomer: '01M2T3PAHG3P5A32REX8MH3HD7',
  source: '01M238A0V75387H4HZ15YFWGX3',
  destination: '01M3W0Y93XHJY9RPQ2G75X81WG',
  sourceFaas: '01M238A757Y931HHB238T7MCFM',
  destinationFaas: '01M3W0YENHMFJ8Z9FS76E3CC6T',
  transaction: 'PVB01M3YP6SFJQTJQWE83SC5RMX1V',
  reference: 'pvbt-ff561046-58e7-428d-9163-f6e60b0dab65',
  nativeReference: '01M3YP6VMSZX61CMB5V4Z07RAJ',
};

function requireCondition(condition) {
  if (!condition) throw new Error('provider_crosswalk_refused');
}

function exact(actual, expected) {
  requireCondition(
    actual && typeof actual === 'object' && !Array.isArray(actual)
  );
  for (const [key, value] of Object.entries(expected))
    requireCondition(actual[key] === value);
}

function identifier(value) {
  return typeof value === 'string' && /^[!-~]{1,512}$/.test(value);
}

function boundedInteger(value, limit) {
  return Number.isInteger(value) && value > 0 && value <= limit;
}

async function request(path, configuration, fetchImplementation) {
  requireCondition(Date.now() < Date.parse(deadline));
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('provider_crosswalk_refused'));
    }, configuration.timeoutMs);
  });
  try {
    const url = origin + path;
    const response = await Promise.race([
      fetchImplementation(url, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${configuration.apiSecret}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }),
      timeout,
    ]);
    requireCondition(
      response.status === 200 &&
        response.ok &&
        !response.redirected &&
        response.type !== 'opaqueredirect'
    );
    requireCondition(!response.url || response.url === url);
    return await boundedJson(response, configuration.maxResponseBytes, timeout);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function collectProviderCrosswalk(input, fetchImplementation) {
  try {
    exact(input, { executionDeadline: deadline });
    const keys = Object.keys(input).sort().join(',');
    requireCondition(keys === 'event,executionDeadline,piggyvest');
    requireCondition(typeof fetchImplementation === 'function');
    requireCondition(Date.now() < Date.parse(deadline));
    exact(input.piggyvest, {});
    const allowed =
      'apiBaseUrl,apiSecret,expectedBusinessId,expectedCurrency,timeoutMs,maxResponseBytes'.split(
        ','
      );
    requireCondition(
      Object.keys(input.piggyvest).every((key) => allowed.includes(key))
    );
    const configuration = {
      apiBaseUrl: origin,
      expectedCurrency: 'NGN',
      timeoutMs: 5000,
      maxResponseBytes: 65536,
      ...input.piggyvest,
    };
    exact(configuration, {
      apiBaseUrl: origin,
      expectedCurrency: 'NGN',
      expectedBusinessId: pins.business,
    });
    requireCondition(
      typeof configuration.apiSecret === 'string' &&
        /^test_key_[!-~]{1,8183}$/.test(configuration.apiSecret)
    );
    requireCondition(boundedInteger(configuration.timeoutMs, 10000));
    requireCondition(boundedInteger(configuration.maxResponseBytes, maximum));
    const event = input.event;
    exact(event, {
      eventId: '01M3YP771123DWC9Y8Y4814Z8Y',
      eventType: 'wallet-transfer.outflow.success',
      eventCategory: 'wallet_transfer',
      customer_id: pins.customer,
      pvb_wallet: pins.source,
      pvb_destination_wallet: pins.destination,
      pvb_third_party_reference: pins.reference,
    });
    if (event.pvb_reference !== undefined)
      exact(event, { pvb_reference: 'PVB01M3YP7BF72MD3PXVY2G8ZXCS0' });
    const data = event.eventData;
    exact(data, {
      id: '34c57f9b-8697-46a9-954f-b93bfd888a36',
      transaction_id: '2d3ee34a-74e9-4992-b0c2-f8a653e4ff02',
      customer_id: pins.customer,
      source_wallet: pins.sourceFaas,
      destination_wallet: pins.destinationFaas,
      amount: 10000,
      currency: 'NGN',
      status: 'COMPLETED',
      reference: pins.nativeReference,
      internal_reference: pins.nativeReference,
      third_party_reference: pins.transaction,
      initiator_reference: pins.transaction,
    });
    requireCondition(data.fee === 0 || data.fee === null);
    if (data.type !== undefined) exact(data, { type: 'inter' });
    if (data.category !== undefined) exact(data, { category: 'p2p' });
    const get = (path) => request(path, configuration, fetchImplementation);
    const tsq = await get(
      `/api/v1/transaction/verify?reference=${pins.reference}&wallet_id=${pins.source}`
    );
    exact(tsq, { status: true });
    exact(tsq.data, {
      id: pins.transaction,
      internal_reference: pins.transaction,
      reference: data.reference,
      third_party_reference: pins.reference,
      customer_id: pins.business,
      source_wallet: pins.source,
      destination_wallet: pins.destination,
      status: 'successful',
      amount: 10000,
      fee: 0,
    });
    for (const [key, expected] of Object.entries({
      currency: 'NGN',
      business_id: pins.business,
      destination_customer_id: pins.customer,
    })) {
      if (tsq.data[key] !== undefined) exact(tsq.data, { [key]: expected });
    }
    const wallets = [];
    for (const [publicId, faasId] of [
      [pins.source, data.source_wallet],
      [pins.destination, data.destination_wallet],
    ]) {
      const result = await get(`/api/v1/wallet/${publicId}`);
      exact(result, { status: true });
      exact(result.data, {
        id: publicId,
        faas_wallet_identifier: faasId,
        business_id: pins.business,
        currency: 'NGN',
        status: 'active',
      });
      requireCondition(Number.isFinite(result.data.balance));
      requireCondition(
        result.data.api_customer_id == null ||
          identifier(result.data.api_customer_id)
      );
      wallets.push(result.data);
    }
    exact(wallets[1], { api_customer_id: pins.apiCustomer });
    const listed = await get(
      `/api/v1/wallet/api/wallet-type?customer_id=${pins.apiCustomer}&limit=100`
    );
    exact(listed, { status: true });
    const edges = listed.data?.paginatedPayload?.edges;
    requireCondition(
      Array.isArray(edges) && edges.length > 0 && edges.length <= 100
    );
    const ids = new Set();
    for (const entry of edges) {
      exact(entry, {
        business_id: pins.business,
        currency: 'NGN',
        api_customer_id: pins.apiCustomer,
      });
      requireCondition(
        identifier(entry.id) &&
          identifier(entry.faas_wallet_identifier) &&
          !ids.has(entry.id)
      );
      ids.add(entry.id);
    }
    const matching = edges.filter((entry) => entry.id === pins.destination);
    requireCondition(matching.length === 1);
    exact(matching[0], { faas_wallet_identifier: data.destination_wallet });
    requireCondition(Date.now() < Date.parse(deadline));
    return {
      status: 'provider-crosswalk-readonly-verified',
      observedAt: new Date().toISOString(),
      publicWalletId: wallets[1].id,
      faasWalletId: wallets[1].faas_wallet_identifier,
      apiCustomerId: wallets[1].api_customer_id,
      providerCustomerId: event.customer_id,
      nativeCustomerId: data.customer_id,
      publicFaasMatches: true,
    };
  } catch {
    throw new Error('provider_crosswalk_refused');
  }
}

module.exports = collectProviderCrosswalk;

if (require.main === module) {
  (async () => {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('provider_crosswalk_refused')),
        10000
      );
    });
    try {
      requireCondition(process.argv.length === 2);
      const input = await boundedJson(
        new Response(process.stdin),
        maximum,
        timeout
      );
      clearTimeout(timer);
      const result = await collectProviderCrosswalk(input, fetch);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stdout.write('{"status":"refused"}\n');
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      process.stdin.destroy();
    }
  })();
}
