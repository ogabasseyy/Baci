import { runBvnCollision } from './proof-1-bvn-collision';
import { runProof1 } from './proof-1-return-if-exist';
import { runDuplicateReference } from './proof-2-duplicate-reference';
import { runProof2 } from './proof-2-tsq';
import { runProof3 } from './proof-3-goal-deposit';
import { runHouseInflow } from './proof-3-house-inflow';
import { runBankDestinationCheck } from './proof-4-bank-destination';
import { runProof4 } from './proof-4-withdrawal-counter';
import { runProof5 } from './proof-5-interest';
import { runProof6 } from './proof-6-fees';
import { runFeeBearerAndRestrictions } from './proof-6-owner-gaps';
import { runProof7 } from './proof-7-interest-routing';
import { runProof8 } from './proof-8-destination-records';
import { runProof9 } from './proof-9-deposit-fees';
import { runProof10 } from './proof-10-first-pass';
import { type ProofRunner, withExtension } from './proof-extension';
import type { ProofId } from './types';

// Proofs 1, 2, 3, 4 and 6 carry an added step (proof-extension.ts) merged into
// their own section; 8 and 9 stand alone. The order matters: proof 3 admits
// and funds the house wallet that proof 8's collection leg sends from, and
// proof 9 reads proof 3's goal deposit. Proof 10 (S8) goes last: it only
// needs the shared scenario, and its outflows come after the others'.
export const PROOF_ORDER: ReadonlyArray<
  readonly [ProofId, ProofRunner, string]
> = [
  [
    'p1',
    withExtension(runProof1, runBvnCollision),
    'Create-customer re-POST with returnIfExist=true',
  ],
  [
    'p2',
    withExtension(runProof2, runDuplicateReference),
    'Transaction status query (TSQ) for a wallet-to-wallet transfer',
  ],
  [
    'p3',
    withExtension(runProof3, runHouseInflow),
    "Bank deposit into a goal sub-wallet's own virtual account",
  ],
  [
    'p4',
    withExtension(runProof4, runBankDestinationCheck),
    'Withdrawal counter (wallet-to-wallet vs bank outflow)',
  ],
  ['p5', runProof5, 'Interest visibility (development evidence only)'],
  [
    'p6',
    withExtension(runProof6, runFeeBearerAndRestrictions),
    'Fees on deposits and wallet transfers',
  ],
  ['p7', runProof7, 'Main-wallet interest routing at creation'],
  ['p8', runProof8, 'Destination-side records for wallet-to-wallet transfers'],
  ['p9', runProof9, 'Deposit fee mechanics on main and goal wallets'],
  [
    'p10',
    runProof10,
    'S8 first pass: onboard, deposit, create goal, fund, double tap, timeout retry',
  ],
];
