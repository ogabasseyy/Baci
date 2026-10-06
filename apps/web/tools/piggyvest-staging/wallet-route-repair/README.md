# PiggyVest staging wallet-route repair

## Scoped route transition

The authenticated general-wallet handler reads only its existing projections from `merchants`, `customers`, `customer_wallets`, `customer_wallet_transactions`, optional `customer_wallet_payment_accounts`, optional `customer_wallet_accounts`, optional `customer_savings_goals`, and `get_storefront_payment_settings`. This gateway-only transition appends exactly four REST resources and one RPC to the deployed exact 11-route contract. The database was inspected read-only: grants/RLS and RPC execute are already present; do not apply database grants or migrations. Anonymous SELECT grants do not expose wallet rows because customer ownership RLS filters them to zero.

`wallet-gateway-transition-installer.py` delegates graph, runtime identity, service, firewall, socket, evidence, and health validation to the existing pinned 11-route activator helpers. It uses that activator's exact lock path. It does not alter the old 5/11-route candidate, installer, recovery script, gateway source, binding, or deployment. The package binds the original predecessor bytes exactly and requires an owner-reviewed SHA-256 pin before staging. The fixed lease expires **2026-09-29 15:59:10 UTC**; this code never renews it.

## Owner command artifact

Transfer this directory to the VPS through the owner-approved file-transfer process. Run from a root-owned, non-group/world-writable directory; no service, database, or deployment action occurs merely by copying it. The owner reviews the exact route diff and manifest hash printed by package build, then substitutes that printed hash below (no source pin is invented):

```sh
sudo python3 ./wallet-gateway-transition-installer.py --build-package
sudo python3 ./wallet-gateway-transition-installer.py --stage-package ./wallet-route-transition-package --manifest-sha256 <OWNER-REVIEWED-MANIFEST-SHA256>
sudo python3 ./wallet-gateway-transition-installer.py --check
sudo python3 ./wallet-gateway-transition-installer.py --activate
```

`--check` is read-only and must report `ready` before activation. The stage operation verifies the hash, source ownership/modes, and safe ancestry, then atomically installs the package and reviewed hash pin. Activation takes the shared transition lock, verifies live graph and current exact 11-route binding, fixed lease, database preflight, gateway/drafts health and reachability, then records root-only backup/intent before atomically installing 16-route binding and fresh startup evidence. It restarts the gateway, checks the old routes, all five new route probes, passthrough, and drafts health. Any post-install failure restores the original binding bytes first, rebuilds fresh evidence, restarts, and checks the original baseline. It never reuses stale startup evidence.

## Recovery compatibility

After the binding has 16 routes, **never run the old funding-gateway recovery script/runner**: its accepted route contracts stop at 11 and it is not a valid rollback tool for this transition. Use only this reviewed wallet installer for recovery:

```sh
sudo python3 ./wallet-gateway-transition-installer.py --recover
```

Recovery is hash-pinned to the recorded intent/receipt, original backup, target binding, staged manifest and fixed deadline. It restores the original 11-route binding and rebuilds fresh inventory/evidence before restart. Activation attempts rollback automatically; use `--recover` only when the recorded intent remains after an interrupted/failed operation or when deliberately reverting a completed 16-route transition before the deadline. Keep the root-only backup/receipt for audit; do not delete them as part of rollout.

## Tests and limits

Run the local no-network regression suite:

```sh
python3 wallet-gateway-transition-installer.test.py
python3 wallet-gateway-database-preflight.test.py
python3 wallet-route-owner-diagnostic.test.py
```

Tests cover exact 11→16 route extension, verbatim predecessor-byte pinning, reviewed package staging, `--check`, manifest pin rejection, activation success, automatic restoration after failed health, fresh-evidence rollback ordering, and the database boolean output observed from `psql`. Application auth/cross-customer behavior and public staging hosts are separate parent-owned checks; this tool does not make those claims or modify nginx/Vercel.
