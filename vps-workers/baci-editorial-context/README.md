# Reviewed Baci capability context

Deploy `platform_capabilities.py` into the existing writer's
`codex_content_agent/`, the test into `tests/`, and apply `prompt-builder.patch`
without replacing unrelated prompt-builder edits. Keep backups and compare the
captured source hash before replacing a live file. Copy the approved register
from `docs/product/baci-capabilities.json` to
`data/baci-platform-research/capabilities.json`.

After checking the exact captured source hash, validate and apply the focused
patch with `git apply --check --unidiff-zero prompt-builder.patch` and
`git apply --unidiff-zero prompt-builder.patch`.

Only platform-marketing prompts receive this context. The immutable publisher,
owner approval, source capture and Ogabassey lanes are unchanged. Missing,
malformed, future-dated or older-than-14-day registers are not used as positive
feature evidence. The prompt explicitly requires editorial verification instead
of inferring feature absence from documentation gaps.

Run `python3 -m unittest discover -s tests -p 'test*prompt*.py'` in the writer
checkout, and its full suite before declaring the lane validated. Generate one
prompt and verify its register hash, source revision, statuses and restrictions.
Do not start paid writing/image jobs just to test context injection.

The register is manually reviewed, not automatically promoted by an indexer. Its
`code_evidenced` status is not equivalent to production availability. Production
claims must carry dated rollout/workflow evidence. Review updates against the
source revision and invalidate stale evidence rather than refreshing the date
without inspection.
