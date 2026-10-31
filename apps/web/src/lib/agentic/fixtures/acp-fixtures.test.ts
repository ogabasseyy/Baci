// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAgenticEnv } from '../test-support/stub-agentic-env';

type JsonObject = Record<string, unknown>;

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'acp-2026-04-17'
);
// Spec directories published by the ACP repository at the pinned commit.
const RELEASED_ACP_VERSIONS = [
  '2025-09-29',
  '2025-12-12',
  '2026-01-16',
  '2026-01-30',
  '2026-04-17',
];

function readFixture(name: string): JsonObject {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

function record(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object');
  }
  return value as JsonObject;
}

function missing(value: JsonObject, keys: readonly string[]): string[] {
  return keys.filter((key) => !(key in value));
}

describe('ACP 2026-04-17 create-checkout-session request fixture', () => {
  const request = readFixture('create-checkout-session.request.json');
  const headers = record(request.headers);
  const body = record(request.body);

  it('carries the required Idempotency-Key and API-Version headers', () => {
    expect(missing(headers, ['Idempotency-Key', 'API-Version'])).toEqual([]);
    expect(headers['API-Version']).toBe('2026-04-17');
    const key = String(headers['Idempotency-Key']);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(255);
  });

  it('flags a request without an idempotency key', () => {
    const { 'Idempotency-Key': _removed, ...withoutKey } = headers;

    expect(missing(withoutKey, ['Idempotency-Key', 'API-Version'])).toEqual([
      'Idempotency-Key',
    ]);
  });

  it('carries line_items, currency and capabilities', () => {
    expect(missing(body, ['line_items', 'currency', 'capabilities'])).toEqual(
      []
    );
    const lineItems = body.line_items as JsonObject[];
    expect(lineItems.length).toBeGreaterThan(0);
    expect(lineItems.every((item) => typeof item.id === 'string')).toBe(true);
    expect(typeof body.currency).toBe('string');
    expect(typeof body.capabilities).toBe('object');
  });
});

describe('ACP 2026-04-17 create-checkout-session response fixture', () => {
  const response = readFixture('create-checkout-session.response.json');
  const request = readFixture('create-checkout-session.request.json');
  const body = record(response.body);

  it('is a 201 that echoes the idempotency key', () => {
    expect(response.status).toBe(201);
    expect(record(response.headers)['Idempotency-Key']).toBe(
      record(request.headers)['Idempotency-Key']
    );
  });

  it('carries every required checkout session field', () => {
    expect(
      missing(body, [
        'id',
        'status',
        'currency',
        'line_items',
        'totals',
        'fulfillment_options',
        'messages',
        'links',
        'capabilities',
      ])
    ).toEqual([]);
  });

  it('gives each line item an id, item.id, quantity and totals', () => {
    const lineItems = (body.line_items as unknown[]).map(record);

    expect(lineItems.length).toBeGreaterThan(0);
    for (const line of lineItems) {
      expect(missing(line, ['id', 'item', 'quantity', 'totals'])).toEqual([]);
      expect(typeof record(line.item).id).toBe('string');
      expect(line.quantity as number).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every total a type, display_text and integer amount', () => {
    const lineTotals = (body.line_items as JsonObject[]).flatMap(
      (line) => line.totals as unknown[]
    );
    const totals = [...(body.totals as unknown[]), ...lineTotals].map(record);

    expect(totals.length).toBeGreaterThan(0);
    for (const total of totals) {
      expect(missing(total, ['type', 'display_text', 'amount'])).toEqual([]);
      expect(Number.isInteger(total.amount)).toBe(true);
    }
  });
});

describe('known gaps against released ACP versions', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Roadmap Task 5 settles the advertised version (verify what OpenAI accepts
  // first); this test then starts failing and `.fails` must go. Baci
  // advertises 2026-04-30, which has no ACP release.
  it.fails('F41: the advertised ACP version is a released ACP version', async () => {
    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );
    const { buildAcpDiscoveryProfile } = await import(
      '@/lib/agentic/acp-discovery-profile'
    );
    const { AGENTIC_API_VERSION } = await import(
      '@/lib/agentic/request-integrity'
    );
    const profile = buildAcpDiscoveryProfile(
      buildAgentCommerceManifest(
        {
          business_name: 'Ogabassey',
          feature_settings: { pay_on_delivery_enabled: true },
          paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
          slug: 'ogabassey',
        },
        'https://ogabassey.com'
      )
    );

    expect(RELEASED_ACP_VERSIONS).toContain(AGENTIC_API_VERSION);
    expect(RELEASED_ACP_VERSIONS).toContain(profile.protocol.version);
  });
});
