/** Periodically materializes GIGL's station directory outside checkout. */

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { isEntrypoint } from '../lib/is-entrypoint.mjs';

const GIGL_SYNC_REQUEST_TIMEOUT_MS = 15_000;

function unwrapEnvelope(payload) {
  const envelope =
    typeof payload?.status === 'number' ? payload : payload?.data;
  if (typeof envelope?.status === 'number') {
    if (envelope.status !== 200) {
      throw new Error(`GIGL envelope failed with status ${envelope.status}`);
    }
    return envelope.data ?? null;
  }
  return envelope?.data ?? envelope ?? null;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index]);
      }
    })
  );
  return results;
}

export async function syncGiglServiceCentres({
  env = process.env,
  fetchImpl = fetch,
  createSupabaseClient = createClient,
  now = new Date(),
  generation = randomUUID(),
  logger = console,
} = {}) {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GIGL_EMAIL',
    'GIGL_PASSWORD',
    'GIGL_BASE_URL',
  ];
  for (const name of required) {
    if (!env[name]) throw new Error(`Missing ${name}`);
  }
  const baseUrl = env.GIGL_BASE_URL.replace(/\/$/, '');
  const loginResponse = await fetchImpl(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: env.GIGL_EMAIL,
      password: env.GIGL_PASSWORD,
    }),
    signal: AbortSignal.timeout(GIGL_SYNC_REQUEST_TIMEOUT_MS),
  });
  if (!loginResponse.ok)
    throw new Error(`GIGL login failed: ${loginResponse.status}`);
  const login = unwrapEnvelope(await loginResponse.json());
  const token = login?.['access-token'];
  if (!token) throw new Error('GIGL login response omitted access-token');
  const headers = { 'access-token': token };
  const stationResponse = await fetchImpl(`${baseUrl}/localstations/get`, {
    headers,
    signal: AbortSignal.timeout(GIGL_SYNC_REQUEST_TIMEOUT_MS),
  });
  if (!stationResponse.ok)
    throw new Error(`GIGL stations failed: ${stationResponse.status}`);
  const stations = unwrapEnvelope(await stationResponse.json());
  if (!Array.isArray(stations) || stations.length === 0) {
    throw new Error('GIGL returned an empty station snapshot');
  }
  const groups = await mapWithConcurrency(stations, 4, async (station) => {
    const response = await fetchImpl(
      `${baseUrl}/serviceCentresByStation?StationId=${station.StationId}`,
      {
        headers,
        signal: AbortSignal.timeout(GIGL_SYNC_REQUEST_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      throw new Error(
        `GIGL service centres failed for station ${station.StationId}`
      );
    }
    const centres = unwrapEnvelope(await response.json());
    if (!Array.isArray(centres))
      throw new Error('Invalid GIGL service-centre response');
    return centres.map((centre) => ({
      station_id: station.StationId,
      station_name: station.StationName,
      station_code: station.StationCode ?? null,
      service_centre_id: centre.ServiceCentreId,
      service_centre_name: centre.ServiceCentreName,
      service_centre_code: centre.ServiceCentreCode ?? null,
      address: centre.Address ?? null,
      latitude: centre.Latitude ?? null,
      longitude: centre.Longitude ?? null,
    }));
  });
  const centres = groups.flat();
  if (centres.length === 0) throw new Error('GIGL returned no service centres');

  const supabase = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data, error } = await supabase
    .rpc('replace_shipping_provider_service_centres', {
      p_provider: 'GIGL',
      p_generation: generation,
      p_synced_at: now.toISOString(),
      p_centres: centres,
    })
    .abortSignal(AbortSignal.timeout(GIGL_SYNC_REQUEST_TIMEOUT_MS));
  if (error) throw new Error(`Directory replacement failed: ${error.message}`);
  logger.log(
    `[sync-gigl-service-centres] synced ${data ?? centres.length} centres`
  );
  return { centreCount: centres.length, generation };
}

async function main() {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
  try {
    await syncGiglServiceCentres();
  } catch (error) {
    console.error('[sync-gigl-service-centres] Worker failed:', error);
    process.exitCode = 1;
  }
}

if (
  isEntrypoint(import.meta.url)
) {
  await main();
}
