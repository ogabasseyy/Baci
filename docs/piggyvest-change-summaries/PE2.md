# PE2: Finishing setup for an existing savings goal

## What changes
Some savings goals were created before the PiggyVest goal wallet existed, or their first setup failed. When the app confirms such a goal was never set up, it asks "Earn interest on this goal?" with two explicit answers and nothing preselected. A "Set up this goal" button stays disabled until the status check has finished and the customer has answered.

## Why
An earlier "Set up this goal" button was removed because it always switched interest off and could race the status check. This version never guesses the interest choice and never acts on a status that is still loading.

## What could go wrong and how it is prevented
- Wrong interest choice: a choice already saved for the goal is always reused. If none is saved, the customer's explicit yes or no is required and is saved with the setup claim. A missing or non-boolean answer is refused, and nothing is saved or sent. An answer that contradicts the saved one is refused, never overwritten.
- Stale status: the server reads status first, and the app shows the button only after its own status read finished and said "not started".
- Double setup: the claim is taken inside the database under a lock, so two taps or two devices create at most one wallet. A live claim only reports progress. A claim older than five minutes is taken over by the database using the saved choice, judged by the database clock after it holds the lock.
- Lost responses: after any attempt the app re-reads status instead of retrying.
- Other customers' goals: the server checks sign-in and the anti-forgery token, resolves the caller's own customer, and requires the goal to belong to that customer and be active and accepted.

## How it is tested
Automated tests cover: status read before any claim; saved choice reused; explicit choice saved when none exists; missing choice refused; contradicting choice refused; no provider call while a claim is live; takeover after expiry; failed status reads; the route's sign-in, token, input and error handling; and the app's disabled button, double-press guard and re-read after each attempt. Every new app file has a test proving it does nothing while the server keeps PiggyVest off. No live provider calls are made.

## How it stays switched off
The endpoint uses the same rollout flag and kill switch as goal wallet creation, so it answers "unavailable" until that flag is on. The app shows the prompt only when the server's answer says the merchant is on PiggyVest and the status read says "not started". Otherwise nothing changes.
