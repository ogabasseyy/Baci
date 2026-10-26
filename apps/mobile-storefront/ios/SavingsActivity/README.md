# Sandbox savings Live Activity

The staging app uses the existing branded app icon. Submitting a contribution starts
one savings Live Activity. Opening Wallet only updates an existing activity from
the authenticated wallet query; it never starts a goal-long activity. A named-goal link
selects that goal instead of the default card. Both the lock-screen card and Dynamic
Island link to `/wallet?action=savings&savingsGoalId=<goal UUID>`.

The card uses black fill, white text and a red progress bar. It is marked SANDBOX.
Progress is bounded, invalid amounts are rejected, other-goal activities are ended,
and signing out ends activities. After fifteen minutes the card reports that its
progress needs refreshing rather than claiming it remains current.

Contribution responses drive pending, confirmed, cancelled, or unknown status.
Unknown transport outcomes never imply success. Confirmation uses a fresh wallet
read when available and ends the activity with a sixty-second result display.
Pending-operation status checks also update the activity. Interest alerts remain
separate ordinary push notifications, not an indefinitely running activity.

Run `ruby tools/install-savings-activity.rb` from the mobile storefront directory
after regenerating the staging Xcode project. The installer embeds the extension
before React Native/Firebase script phases to avoid an Info.plist dependency cycle.
Its signing configuration uses the existing local staging development profile and
the existing team wildcard extension profile. It does not register new credentials.

This implementation updates while the app is running. It does not provision an
ActivityKit push token or deliver background APNs activity updates. Ordinary iOS
notification banners remain system-styled. Android custom notifications are a
separate implementation; this native extension is staging-iOS-only.

The interest-copy migration changes wording only, retaining event deduplication,
net credited amounts, reversals and restricted execution permissions. The sandbox
preview push refers to the existing simulated credit; it does not credit interest
again or represent a provider payout.
