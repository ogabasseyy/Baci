# Inactive interest-category repair

This owner-only replacement accepts the provider's `interest_payout` category
alongside `interest-payout`. The compiled daemon must differ from the installed,
pinned predecessor by exactly that one line. The prefunded bundle is unchanged.

Before installation, the owner procedure verifies the historical root manifest,
all its file pins, both stopped containers' original isolation contract and image
environment, the installed code's ownership/mode/link count, and the two protected
configuration hashes. Symlinks, foreign bytes and active containers are refused.
Stage the bundle under root-owned directories without group/other write access.
The `check_parents` preflight rejects `/tmp`, `/var/tmp`, and other writable parents.

The procedure preserves the predecessor artifact and stopped containers, builds a
new provenance manifest, and replaces both stopped replay containers with the same
isolation configuration and new manifest label. It never starts containers,
changes financial credentials/deadlines, edits timers, contacts a database/provider,
changes wallet eligibility/rates, or credits a balance. A failure attempts guarded
restoration without deleting either predecessor container or overwriting foreign
artifact changes. Root-owned audit files retain the result and both manifest pins.
Refusals retain only the stage, container identities and exception class names in
`refusal-result.json`; exception messages, credentials and provider bodies are not logged.

Ambiguous Docker-create replies are reconciled by the exact candidate name, the
new manifest pin, and a separate per-run ownership label. Cleanup allows only a
subset of the three original network names. The pinned original isolation
validator compares network-name sets, not endpoint values; its complete-network
view during cleanup exists only to validate the other unchanged isolation fields.

Rollback independently checks full candidate IDs before removal and after an
ambiguous removal reply. An already-removed candidate is skipped so restoration
can resume after partial cleanup. A candidate that remains present, identity
drift, or an unavailable Docker read refuses cleanup rather than claiming it
succeeded. Existing originals and foreign containers are never deleted.

Fresh root readback on 1 October confirms this parser-only repair was already
installed inactive, with daemon SHA-256
`78e98bcf19e6e59dad67d53c952b5494b05b0f646af31d2e0aa88270475635ca`.
The two replacement containers remain stopped and both protected configuration
hashes remain unchanged. This predecessor-pinned installer must not be rerun
against that already-repaired state. Installation evidence is retained at
`/root/baci-interest-parser-repair.yzgOduMP/installation-result.json`.

The prepared replay configuration and its scoped JWTs still carry the expired
29 September financial deadline; the separately renewed treasury login does
not renew those artifacts. Do not start replay until a separate reviewed
financial renewal and paid-interest mapping/evidence preflight pass. The
historical cutover installer must not be rerun with this new manifest or
treated as a financial renewal.

Local checks:

```sh
python3 tools/staging/interest-bridge/parser-repair/parser_repair_contract.test.py
python3 tools/staging/interest-bridge/parser-repair/parser_repair_owner.test.py
python3 tools/staging/interest-bridge/parser-repair/parser_repair_rollback.test.py
```
