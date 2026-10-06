# Owner / builder boundary

Owner owns this folder only. Franklin owns `replay-native-upgrade/`.
The root helper consumes the reviewed artifact through `verifyArtifact`, uses
`reviewOverlay` to normalize the original `productionDelta` inventory, and
derives the activation configuration through `prepareUpgrade`. Actual
installed predecessor bytes are independently pinned before derivation.
No caller-selected roles, JWTs, scope, deadline or predecessor pins exist.

All six frozen receiver production overlays must be in the artifact inventory,
including `prefunded-card-provider-evidence.ts`. The two new signed-outflow
files have an absent canonical predecessor, not a fabricated empty-file hash.
The factory retains the named `createPrefundedCardReplayRuntime` ESM export.

The owner ships the reviewed artifact, its capture/inventory/metafile closure,
the runtime isolation validator and pinned helper sources as one bounded tar.
No live daemon/configuration/secret is copied to the Mac. Root derives and
stages those only from exact live predecessor bytes on the VPS.

Default behavior stages a new generation and runs the original daemon's
read-only `--check` in a temporary container. Only explicit `--apply` stops
and retains the original container, then replaces its original name.
The original r8 seal and fixed Oct 6 deadline units are never edited.
An already stopped original produces a stopped replacement. Paused timers are
accepted for this non-starting path; a running original requires an armed timer.
