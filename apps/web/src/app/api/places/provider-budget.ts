import 'server-only';

import { Redis } from '@upstash/redis';

// Shared across production and previews. Count every upstream attempt, including
// retries. These caps apply only to this address flow, not other Google products.
export const GOOGLE_MONTHLY_REQUEST_LIMIT = 4500;
const GOOGLE_PREDICTION_REQUEST_LIMIT = 4400; // Leave room for selections.
export const GEOAPIFY_DAILY_REQUEST_LIMIT = 2800;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_COUNTER_TTL_SECONDS = 40 * 24 * 60 * 60;
const GEOAPIFY_MIN_REQUEST_INTERVAL_MS = 250;

const GOOGLE_BUDGET_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const GEOAPIFY_BUDGET_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #latest > 0 then
  local wait = tonumber(ARGV[3]) - (now - tonumber(latest[2]))
  if wait > 0 then return -wait end
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]) + 60000)
return 1
`;

let budgetRedis: Redis | null = null;
function getBudgetRedis(): Redis | null {
  if (budgetRedis) return budgetRedis;
  // Prefer an isolated counter database without changing unrelated KV consumers.
  const configurations = [
    [
      process.env.ADDRESS_AUTOCOMPLETE_REDIS_REST_URL,
      process.env.ADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN,
    ],
    [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN],
    [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN],
  ];
  // A configured but incomplete preferred pair is an error. Switching to a
  // different database would discard its usage history and reset the spend cap.
  const [url, token] =
    configurations.find(([candidateUrl, candidateToken]) =>
      Boolean(candidateUrl || candidateToken)
    ) ?? [];
  if (!url || !token) return null;
  budgetRedis = new Redis({ url, token });
  return budgetRedis;
}

export function googleBudgetKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month)
    throw new Error('Google budget billing month unavailable');
  return `baci:address-budget:google:${year}-${month}`;
}

export async function reserveGooglePlacesRequest(
  kind: 'autocomplete' | 'details'
): Promise<boolean> {
  try {
    const redis = getBudgetRedis();
    if (!redis) return false;
    return (
      (await redis.eval<unknown[], number>(
        GOOGLE_BUDGET_SCRIPT,
        [googleBudgetKey()],
        [
          kind === 'autocomplete'
            ? GOOGLE_PREDICTION_REQUEST_LIMIT
            : GOOGLE_MONTHLY_REQUEST_LIMIT,
          MONTH_COUNTER_TTL_SECONDS,
        ]
      )) === 1
    );
  } catch {
    // No in-memory fallback: serverless restarts must not reset paid usage.
    console.warn('[Address API] Google budget unavailable');
    return false;
  }
}

export async function reserveGeoapifyRequest(): Promise<boolean> {
  try {
    const redis = getBudgetRedis();
    if (!redis) return false;
    const reserve = () =>
      redis.eval<unknown[], number>(
        GEOAPIFY_BUDGET_SCRIPT,
        ['baci:address-budget:geoapify'],
        [
          DAY_MS,
          GEOAPIFY_DAILY_REQUEST_LIMIT,
          GEOAPIFY_MIN_REQUEST_INTERVAL_MS,
          crypto.randomUUID(),
        ]
      );
    const result = await reserve();
    if (result === 1) return true;
    if (
      !Number.isInteger(result) ||
      result >= 0 ||
      result < -GEOAPIFY_MIN_REQUEST_INTERVAL_MS
    )
      return false;
    // A concurrent request may have just acquired the slot. Pace once before
    // giving up; a daily cap or unavailable storage never triggers a retry.
    await new Promise<void>((resolve) => setTimeout(resolve, -result));
    return (await reserve()) === 1;
  } catch {
    console.warn('[Address API] Geoapify budget unavailable');
    return false;
  }
}
