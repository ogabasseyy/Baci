# Reviewed Baci capability context

Deploy `platform_capabilities.py` into the existing writer's
`codex_content_agent/`, the test into `tests/`, and apply `prompt-builder.patch`
without replacing unrelated prompt-builder edits. Keep backups and compare the
captured source hash before replacing a live file. Copy the approved register
from `docs/product/baci-capabilities.json` to
`data/baci-platform-research/capabilities.json`.

After checking the exact captured source hash, validate and apply the focused
patch with `git apply --check prompt-builder.patch` and
`git apply prompt-builder.patch`. Do not use `--unidiff-zero`: the patch's
context lines must match the live writer file, and a failed `--check` aborts
the deploy instead of inserting the context block at a shifted location.

Only platform-marketing prompts receive this context. The immutable publisher,
owner approval, source capture and Ogabassey lanes are unchanged. Missing,
malformed, future-dated or older-than-14-day registers are not used as positive
feature evidence. The prompt explicitly requires editorial verification instead
of inferring feature absence from documentation gaps.

Two suites exist: `test_platform_capabilities.py` is the in-repo suite (stdlib
only, runs anywhere) covering register validation and prompt serialization;
`test_platform_capability_prompt.py` is the deployable writer-checkout suite —
copy it into the writer `tests/` directory, where it exercises the real
`build_prompt`. Outside the writer checkout it skips instead of failing at
import. Run `python3 -m unittest discover -s tests -p 'test*prompt*.py'` in the
writer checkout, and its full suite before declaring the lane validated. Generate one
prompt and verify its register hash, source revision, statuses and restrictions.
Do not start paid writing/image jobs just to test context injection.

The register is manually reviewed, not automatically promoted by an indexer. Its
`code_evidenced` status is not equivalent to production availability. Production
claims must carry dated rollout/workflow evidence. Review updates against the
source revision and invalidate stale evidence rather than refreshing the date
without inspection.

Owner operations: re-review the register at least every 14 days — a stale
register makes the lane fail closed to the "Register unavailable" prompt text,
so watch for that fallback in writer output. At deploy time, record the
register's `claims_digest` (printed by `register_digests.py`) from the reviewed
repo copy into the writer environment as `BACI_CAPABILITY_REGISTER_DIGEST`.
The pin is mandatory, not optional: the runtime recomputes the claims digest
from the register's actual content (capabilities, `reviewed_at`,
`source_revision`, `review_scope`) and refuses unless the pin equals that
recomputed value — never the stored `claims_digest` field, and never the
`evidence_digest` field. Re-digesting a tampered register changes the
recomputed value, so a pin recorded at review time keeps failing closed; an
unset pin refuses as well. Until the pin is set (and whenever content
differs), the lane fails closed and platform-marketing prompts run without
capability evidence. The `evidence_digest` field and the Register SHA256
printed into each prompt are editorial cross-checks, not the pin. Treat write access to the
register path (`BACI_CAPABILITY_REGISTER_PATH`) as prompt control: the file is
operator-reviewed evidence whose text reaches the writer prompt, so only
trusted operators may write it, and the hash printed into each prompt is the
editorial cross-check that the reviewed file is the one being used. At first apply, record the writer
checkout revision this patch was verified against here (`Verified writer
revision: <sha>`), and re-verify the `platform_marketing` task value on the
VPS before every re-apply.
