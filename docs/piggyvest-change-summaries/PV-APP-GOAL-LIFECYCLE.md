# Cancel a goal, complete a goal, and set up a goal's wallet in the storefront app

Task: PV-APP-GOAL-LIFECYCLE (key cancel_complete_provisioning)
Owner sign-off: REQUIRED for every new sentence listed under "New wording"
(they await the owner's written approval before release).

## What changes

A customer whose main wallet is ready can now, from the savings goal sheet in
the wallet:

- **Cancel a goal.** The whole goal balance goes back to the main wallet and
  the goal is closed.
- **Complete a goal.** The whole goal balance goes to the main wallet and a
  purchase request is saved for the store team, who contact the customer.
  Nothing is spent or paid out automatically.

Both ask for the wallet PIN first. The screen never promises an exact amount:
the server moves the whole goal balance and the screen only shows "Saved so
far".

The same release makes goal-wallet setup actually run for production
customers. Until now the question "Earn interest on this goal?" and the setup
step only appeared in the hosted test build, so no production goal ever got
its own wallet. Now, for a customer with a ready main wallet and a manual
goal, the goal sheet asks the question (neither answer is pre-chosen), sets
the goal up once, checks every five seconds for up to a minute, and only
then shows the amount field. Until the goal's wallet is ready, no money can
be added to that goal.

Customers whose main wallet is not ready (or when the server says PiggyVest is
off) see exactly the screens they see today.

## How it stays safe

- **One operation, one submit.** The server issues the operation id. The app
  keeps it, so going back or reopening the screen never creates a second one.
  Reopening while an attempt is live goes straight to checking its status.
- **Never resubmit on doubt.** If the submit answer is lost, times out or
  reads "unavailable", the app only checks status (every 5 seconds, up to 2
  minutes, then "Still processing" with "Check again"). It never sends the
  submit twice for the same proof.
- **PIN proof.** Single use, bound to the goal and operation. A refused proof
  (nothing moved) lets the customer re-enter the PIN, at most three times.
  A closed PIN sheet changes nothing and offers "Try again".
- **Review states stop.** "Needs review" shows the server text with no retry.
- **Server wording.** Server error messages are shown as the server wrote them.
- **Gate.** Everything new needs an explicit "ready" answer from the main
  wallet read (ready with an account) on a PiggyVest merchant; a rejection or
  "pending" means off. The answer is tied to the signed-in user and dropped
  after an account switch.

## New wording (awaiting the owner's written approval)

- Cancel: "Cancel goal" (button and screen title), "Cancel this goal?",
  "Your whole goal balance, including any interest, goes back to your main
  wallet. This goal will be closed.", "Continue", "Keep goal",
  "Goal cancelled", "Your money is back in your main wallet."
- Complete: "Complete goal" (button and screen title), "Complete this goal",
  "Your whole goal balance, including any interest, moves to your main wallet
  and we send your purchase request to the store team. They will contact you
  to finish your purchase. Nothing is spent or paid out automatically.",
  "Continue", "Not now", "Goal completed", "Your money is in your main wallet
  and your purchase request has been sent."
- PIN sheet: "Enter your PIN to cancel this goal.", "Enter your PIN to
  complete this goal."
- Shared: "Saved so far", "Back to wallet", "We are still processing this. You
  can safely leave this screen.", "Still processing", "Check again", "PIN
  cancelled. Nothing was changed.", "Try again", "Start again", "Your savings
  are safe. Please do not try again.", "Nothing was changed."

(The last sentence, "Nothing was changed.", is the only one not given in the
brief; it shows when a status check says the attempt never started.)

## What could go wrong and how it is prevented

- Money moves twice: the submit is only sent with a fresh PIN proof, and an
  unclear outcome is only ever followed by status reads.
- A customer adds money to a goal with no wallet: the amount field is hidden
  until the goal's wallet status reads ready.
- An old-wallet customer sees something new: all new screens sit behind the
  readiness gate and render nothing (or today's screen) when it is off.
- While the readiness check is still running on a PiggyVest merchant, the
  manual-goal contribution area stays empty for a moment instead of showing a
  contribution form that might not be allowed.

## How to check

Jest: `wallet-pin-*`, `goal-lifecycle*`, `use-goal-lifecycle*`,
`GoalLifecycle*`, `use-primary-goal-gate*`, `use-goal-wallet-setup-poll*`,
`WalletSavingsFundingSection*`, `SavingsPlanStatusNote*`,
`WalletSavingsProgressModal*` (each with its server-off test).
