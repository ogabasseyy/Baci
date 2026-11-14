# PE1: Per-customer wallet PIN limiter

## What changes
Each signed-in customer now has their own cap on PIN attempts, on top of the existing per-address cap. Setting or resetting a PIN allows 5 tries per 10 minutes. Changing a PIN allows 3 per 10 minutes, because it does twice the hashing work. The savings-goal PIN check allows 5 per 10 minutes. The count is kept per shop and per customer. A customer who goes over gets the standard "rate limited" answer with a wait time.

## Why
Many Nigerian customers share one carrier address. The per-address cap alone could lock out honest customers because of strangers, and it does not slow one attacker who changes address. This was a required step before any shop is switched on.

## What could go wrong and how it is prevented
- Redis, the counter store, being down: the request is refused, never waved through, so an outage cannot open the door.
- Counting before sign-in: the count is charged only after the customer is verified, so strangers cannot use up someone else's allowance.
- Charging bad requests: malformed requests are refused before the count, so typos in the request do not burn attempts.
- Budgets leaking between actions: change and the goal check each have their own counter.
- The shop and customer are taken from the server's own records, never from the request, so one customer cannot spend another's allowance.

## How it is tested
Automated tests prove that two customers behind one address are counted separately, that one customer is stopped after the limit with the right wait time, that change has its own smaller budget, that the goal check is stopped before any PIN is examined, and that a Redis outage refuses the request. Existing PIN tests still pass.

## How it stays switched off
The PIN features remain behind their existing switches. No PIN route is reachable by a customer until a shop is enabled, so this limiter has no effect in production until then. No database change is involved.
