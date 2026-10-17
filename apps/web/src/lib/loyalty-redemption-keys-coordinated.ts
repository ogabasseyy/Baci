// Storage-claim coordination for loyalty redemption keys, used
// where the Web Locks API is unavailable or throws (see
// loyalty-redemption-keys.ts for the protocol overview).
import {
  mintKey,
  readStored,
  removeStored,
  storageIsUsable,
  writeStored,
} from './loyalty-redemption-key-store';

const CLAIM_POLL_INTERVAL_MS = 25;
const CLAIM_TTL_MS = 10_000;
// Safety valve only: a live claim always expires within CLAIM_TTL_MS of
// its last refresh and its owner mints promptly, so waiting out a live
// claim terminates on its own. The deadline guards against pathological
// re-staking loops, not against a single suspended winner.
const CLAIM_MAX_WAIT_MS = 30_000;

interface MintClaim {
  token: string;
  expiresAt: number;
}

function readClaim(intent: string): MintClaim | null {
  const raw = readStored(`${intent}:claim`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MintClaim>;
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > Date.now()
    ) {
      return { token: parsed.token, expiresAt: parsed.expiresAt };
    }
  } catch {
    // A malformed claim is treated as expired and overwritten.
  }
  return null;
}

function writeClaim(intent: string, claim: MintClaim): void {
  writeStored(`${intent}:claim`, JSON.stringify(claim));
}

function clearClaim(intent: string, token: string): void {
  // Token-checked: never remove a newer claimant's record.
  if (readClaim(intent)?.token === token) removeStored(`${intent}:claim`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Web Locks is unavailable or threw: coordinate the first mint through
// a storage claim so concurrent tabs still converge on one key. Every
// claimant stakes a token; the lowest live token owns the mint, and
// once the key lands in storage every tab adopts it. A tab that loses
// keeps waiting while the winner's claim is live — minting earlier
// would let a winner suspended after claiming (but before storing its
// key) resume and mint a second key. Claims expire, so a crashed
// claimant bounds the wait.
export async function coordinatedMint(intent: string): Promise<string> {
  // Without usable storage there is nothing to coordinate through and
  // nothing durable to mint into: mintKey fails closed there.
  if (!storageIsUsable()) return mintKey(intent);
  const existing = readStored(intent);
  if (existing) return existing;
  const token = crypto.randomUUID();
  const prior = readClaim(intent);
  if (!prior || token < prior.token) {
    writeClaim(intent, { token, expiresAt: Date.now() + CLAIM_TTL_MS });
  }
  const deadline = Date.now() + CLAIM_MAX_WAIT_MS;
  for (;;) {
    const stored = readStored(intent);
    if (stored) {
      clearClaim(intent, token);
      return stored;
    }
    const claim = readClaim(intent);
    if (!claim) {
      // No live claim: stake ours and confirm ownership on the next
      // poll before minting — a simultaneous claimant's write may
      // have landed after this read, and only the token still in the
      // record may mint.
      writeClaim(intent, { token, expiresAt: Date.now() + CLAIM_TTL_MS });
      await delay(CLAIM_POLL_INTERVAL_MS);
      continue;
    }
    if (claim.token === token) {
      // Settle before minting: a simultaneous claimant can overwrite
      // this claim between our write and this read, and both tabs
      // would then observe their own token and mint competing keys.
      // Only the token still recorded after a poll interval may mint.
      await delay(CLAIM_POLL_INTERVAL_MS);
      const settledStored = readStored(intent);
      if (settledStored) {
        clearClaim(intent, token);
        return settledStored;
      }
      if (readClaim(intent)?.token !== token) continue;
      const minted = mintKey(intent);
      clearClaim(intent, token);
      // Settle before returning: a simultaneous claimant whose token
      // overwrote ours between the ownership read and this mint may
      // have stored its own key in the same window. Adopt whichever
      // key survived in storage rather than our local one.
      await delay(CLAIM_POLL_INTERVAL_MS);
      return readStored(intent) ?? minted;
    }
    if (token < claim.token) {
      writeClaim(intent, { token, expiresAt: Date.now() + CLAIM_TTL_MS });
    }
    if (Date.now() >= deadline) break;
    await delay(CLAIM_POLL_INTERVAL_MS);
  }
  // Deadline reached with a claim still live (endless re-staking or a
  // winner suspended past the safety valve): resolve locally rather
  // than block redemption forever.
  const stored = readStored(intent);
  if (stored) return stored;
  const minted = mintKey(intent);
  clearClaim(intent, token);
  return minted;
}
