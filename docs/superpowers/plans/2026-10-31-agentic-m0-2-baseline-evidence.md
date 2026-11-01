# Agentic Milestone 0, Plan 2 of 6: Baseline and Evidence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record what the agentic merchant looks like in production today, and give Plans 3 to 6 the evidence tooling, schemas, fixtures and test harness they need. Nothing at runtime changes: this plan adds documents, tests, test-support code and vendored schema files only.

**Architecture:** One read-only production baseline (run by the orchestrator, no code). A validator that keeps the access map's "Agent surface evidence" table honest: the status cells accept only `unknown`, `not applicable`, or a dated `pass`/`fail` with a link or commit, so an unknown can never read as success. The UCP `2026-04-08` JSON Schemas vendored by commit, with a validator that loads them offline and a baseline that feeds Baci's real response builders through it. Baci-authored MCP `2026-07-28` and ACP `2026-04-17` fixtures. A two-merchant synthetic harness. Every place Baci fails a schema or spec today is pinned by an `it.fails` test that names its finding and the roadmap task that will flip it.

**Tech Stack:** TypeScript, Vitest, Ajv 8 with `ajv-formats` (both already in `apps/web/package.json`), Biome, the Python capability-register tools, the Supabase MCP `execute_sql` tool (reads only) and curl.

**Roadmap:** [Task 1](2026-10-29-agentic-ucp-completion.md#task-1--baseline-and-evidence), findings F8, F30 and F31. The known-gap tests also pin F1, F3, F7, F33 and F34, and the plan records three new findings: F40 and F41 from the 31 October docs check, and F42, found by the conformance baseline here (see "Roadmap and tracker updates"). **Baseline:** the code facts were read at plan 1's head `ede636ee975607781318545ba9dbb581e0589b67` (pull request #3869, built on `bec52f60339225290c667223e689a45533cd52a0`). `origin/main` has since moved to `efe7a20f74e25a7e3378dcb2dcc32c0ff1501100`; that change (a wallet-order migration and its registry entries) does not touch anything this plan reads.

---

## Milestone 0 plan sequence

Each plan is one pull request. Land them one at a time: several edit files bound to the same capability-register row, so each regenerates the register digests on top of the previous one.

| Plan | Roadmap task | Pull request |
| --- | --- | --- |
| 1 | Task 2 | Remove the admin client from agentic routes (#3869) |
| **2 (this plan)** | Task 1 | Baseline evidence, validators, fixtures and harness |
| 3 | Task 3 | Truthful capability claims and the shared-cart gate |
| 4 | Task 4 | Minor units and the confirmation contract |
| 5 | Task 4 | VAT guard and the VAT cutover procedure |
| 6 | Task 4 | Merchant-owned fulfillment and the F29 fixtures |

## How to run this plan

Workflow set by the owner on 31 October 2026:

- **CodeRabbit is optional.** Before each commit, run `coderabbit review --agent -t uncommitted` only if the tool is available, and fix valid critical or high findings. If it is missing, rate-limited or errors, skip it, write down why (for example `CodeRabbit skipped: rate-limited`) for the pull request description, and continue. Never write that a review ran when it did not.
- **Push early, review while building.** After a task's commit, hand the branch to the orchestrator to push as a checkpoint. After the first checkpoint the orchestrator opens a draft pull request and comments `@codex review`; keep building the next task while reviews run and fix findings as they arrive. Pushes go through the orchestrator, whose push script keeps commit IDs identical and stops on any mismatch. Do not push from this plan.
- **Keep local checks small.** Many agents share this Mac. Each task runs only its own test files. Task 8 runs one whole-project typecheck and the affected-package lint. Full suites run in CI. Never run a full monorepo suite locally.
- **Strict TDD.** Each code task is: write the failing test, run it red and compare the failure with the text shown, implement, run it green, then commit.
- **Task 1 touches production.** Only the orchestrator runs it, only after the owner approves, and only with the read-only statements shown. No other task contacts production.

## Ground rules

- Work in a fresh worktree (Task 0). The primary checkout has unrelated uncommitted work.
- Run pnpm tools as `npm_config_verify_deps_before_run=false pnpm exec …`. Plain `pnpm exec` can start a full `pnpm install`, which has filled this machine's disk before.
- Commits: use `LEFTHOOK_EXCLUDE=knip git commit`, a conventional-commit subject, and end the message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files each task lists. Keep the word "main" out of commit messages: a project hook that scans command text for it has blocked commands before.
- No service-role or admin Supabase client anywhere. Do not edit `apps/web/src/proxy.ts`, `apps/web/src/config/business-types.ts` or any `.env*` file. Add no migration and edit no existing one. Change no runtime behaviour.
- Never place credentials, buyer data or personal data in a document, fixture or test. Fixture emails use `example.test`, URLs use `example.com`, and the fake Paystack secret exists only inside tests.
- Pushing, merging and deploying need the owner's go-ahead; this plan stops at a draft pull request.

## Design decisions to know before starting

1. **Plan 1 was still open (PR #3869) when this was written.** Both plans edit the capability register and the access-map header, so the register re-review (Task 8) runs last, on a branch that contains plan 1. Task 0 shows both ways to get there. Any rebase after Task 8 invalidates it: redo Task 8.
2. **A `fail` can record a known gap.** The access map has no free-text column, so a known-gap test (`it.fails`) is recorded as `fail` with the test file as evidence, and the legend in the table says so. `pass` appears nowhere in this PR: no surface is verified end to end.
3. **Some table cells wait for later tasks.** The table is written in Task 3 but four Local test cells link to test files that Tasks 5 to 7 create, and the access-map checker requires every link target to exist. Task 3 writes those four as `unknown`; Task 8 fills them in, together with every Source revision.
4. **Every path in the table becomes map-bound.** The capability gate treats each backticked repository path or link target in the access map as a cited source: editing one later (for example `request-integrity.ts` in roadmap Task 5) requires re-reviewing the map and register in the same pull request. That is the intended protection for facts like version numbers; plans 3 to 6 should expect it.
5. **Typechecking.** CI typechecks only what `apps/web/tsconfig.json` includes (`src/**/*.ts(x)`); the tools-workers and MCP projects have fixed file lists pinned by `.github/scripts/tools-worker-typecheck-contract.test.mjs`, so a file under `apps/web/tools` or `apps/web/mcp-server` is not typechecked. Everything this plan adds therefore lives under `apps/web/src/lib/agentic`: the surface-evidence validator in `evidence/`, and the MCP fixtures and their test in `fixtures/mcp-2026-07-28/` (the test imports only the UCP validator and the server-card route, both in `src`, and no `mcp-server` module). The main project then covers all of it, and Task 8 runs that project once. Biome also lints and formats these files, including the MCP JSON.
6. **CI link checker and Knip.** The link checker scans every non-test `.ts` and `.md` file under `apps/web` outside `mcp-server`, so fixture code avoids unresolvable URLs (`https://ucp.dev/schemas/...` returns 404, `.test` hosts do not resolve): schema identifiers are built from the `https://ucp.dev` origin and sample hosts use `example.com`. Knip runs in CI, so a type is exported only when another file imports it.
7. **Vendored JSON and Biome.** `biome.json` has no JSON exclusion and `apps/web`'s lint script is `biome check .`, so Biome formats the vendored files (33 of the 61 differ from upstream's compact style). The manifest therefore hashes `JSON.stringify(JSON.parse(bytes))`, which formatting cannot change. The plan generates the manifest from the raw downloads first, formats second, and the tests confirm the hashes still match.
8. **The schemas never enforce `schema` on a business profile.** `business_schema` in `ucp.json` requires only `version` on a capability; `platform_schema` in `capability.json` also requires `spec` and `schema`, matching the UCP overview ("`spec` and `schema` are REQUIRED for all capabilities"). The F7 test therefore validates each declared `dev.ucp.shopping.*` capability against the platform schema.
9. **A schema cannot see every unit bug.** Baci rounds prices to whole major units, which is a valid integer. F1 and F33 therefore also assert the value (`3998`), not only the schema.

## Scope

Covered: the production baseline; the surface-evidence validator and its table; the vendored UCP schemas and an offline validator; a conformance baseline of Baci's profile, catalog, cart and order builders; MCP `2026-07-28` and ACP `2026-04-17` fixtures; a two-merchant harness; the capability-register re-review; the draft pull request.

Not covered: any fix for the gaps the tests pin (plans 3 to 6 and roadmap Tasks 5 to 14), checkout-response and webhook conformance, request-direction (`ucp_request`) validation, production changes of any kind, and the roadmap and tracker edits listed at the end (they are the orchestrator's, in a separate docs change).

## File map

| Action | Path | Responsibility |
| --- | --- | --- |
| Create | `docs/superpowers/evidence/agentic/2026-10-31-baseline.md` | Read-only production baseline (Task 1) |
| Create | `apps/web/src/lib/agentic/evidence/agent-surface-evidence.ts` and `.test.ts` | Table validator (Task 2) |
| Create | `apps/web/src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts` | Runs the validator on the real access map (Task 3) |
| Modify | `docs/product/agent-access-map.md` | New "Agent surface evidence" section (Task 3); header, revisions and four cells (Task 8) |
| Create | `apps/web/src/lib/agentic/fixtures/ucp-2026-04-08/**` | 61 vendored schemas, `LICENSE`, `SOURCE.md`, `manifest.json` (Task 4) |
| Create | `apps/web/src/lib/agentic/fixtures/ucp-schema-validator.ts`, `ucp-schema-samples.ts`, `ucp-schema-validator.test.ts` | Offline validator and its tests (Task 4) |
| Create | `apps/web/src/lib/agentic/test-support/stub-agentic-env.ts` | Shared fake environment for tests (Task 5) |
| Create | `apps/web/src/lib/agentic/fixtures/ucp-conformance-inputs.ts`, `ucp-conformance.test.ts` | Baci builders against the schemas (Task 5) |
| Create | `apps/web/src/lib/agentic/fixtures/acp-2026-04-17/*.json`, `SOURCE.md`, `acp-fixtures.test.ts` | ACP fixtures (Task 6) |
| Create | `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/*.json`, `SOURCE.md`, `mcp-fixtures.test.ts` | MCP fixtures (Task 6) |
| Create | `apps/web/src/lib/agentic/test-support/synthetic-*.ts` and three `.test.ts` files | Two-merchant harness (Task 7) |
| Modify | `docs/product/baci-capabilities.json` | Re-reviewed provenance and digests (Task 8) |

---

### Task 0: Create the worktree

- [ ] **Step 1: Decide where to branch from**

```bash
cd /Users/mac/Baci-app
git fetch origin main fix/agentic-remove-admin-client
gh pr view 3869 --json state,mergedAt,headRefOid
```

If `state` is `MERGED` (case A), branch from `origin/main`. If it is `OPEN` (case B), branch from plan 1's head so this plan builds on it.

Case A:

```bash
cd /Users/mac/Baci-app
git worktree add .worktrees/agentic-baseline-evidence -b chore/agentic-baseline-evidence origin/main
```

Case B:

```bash
cd /Users/mac/Baci-app
git worktree add .worktrees/agentic-baseline-evidence -b chore/agentic-baseline-evidence origin/fix/agentic-remove-admin-client
```

In case B the draft pull request is opened with base `fix/agentic-remove-admin-client` so its diff shows only this plan. When #3869 merges, the orchestrator retargets it to `main` and rebases with `git rebase --onto origin/main ede636ee975607781318545ba9dbb581e0589b67 chore/agentic-baseline-evidence` (use the head you actually branched from if plan 1 gained commits first: `git merge-base HEAD origin/fix/agentic-remove-admin-client` shows it); that rewrites every commit ID, so Task 8's register commit is then stale and must be redone (Task 8, Step 1).

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
git log --oneline -1
```

- [ ] **Step 2: Check what changed since this plan was written**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
git cat-file -e ede636ee975607781318545ba9dbb581e0589b67 && git diff --stat ede636ee975607781318545ba9dbb581e0589b67 HEAD -- apps/web/src/lib/agentic apps/web/mcp-server apps/web/src/app/.well-known apps/web/src/app/api/chat apps/web/tools docs/product vps-workers/baci-editorial-context
```

Expected: no output. If files are listed, read each one and re-verify the code facts quoted in Task 3 before relying on them. If `git cat-file` fails (plan 1's branch was deleted after the merge), compare against `bec52f60339225290c667223e689a45533cd52a0` instead and expect plan 1's own files in the list.

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
df -h /System/Volumes/Data | tail -1
pnpm install --frozen-lockfile --prefer-offline
```

Expected: at least 20 GB free before installing; the install finishes without errors. `ajv` and `ajv-formats` are already dependencies of `apps/web`, so nothing is added to `package.json` or the lockfile.

---

### Task 1: Read-only production baseline (orchestrator only)

**Files:**
- Create: `docs/superpowers/evidence/agentic/2026-10-31-baseline.md`

This task answers four questions about the agentic merchant: is `shared_cart` in `premium_features` (there is no `shared_cart_enabled` column; the flag is derived from that array), is the merchant VAT registered and at what rate, which migrations production has, and what the public UCP profile answers to a plain request and to a browser request. It changes nothing.

Rules for this task:

- Do not start without the owner's explicit approval of the production reads. If the owner has not approved by the time Task 3 starts, skip to Step 6 with an empty work directory: the builder then writes `unavailable` everywhere and Task 3 keeps every Production cell `unknown`.
- Only the statements below. The Supabase `execute_sql` tool can run anything, so run exactly these `SELECT` statements and nothing else.
- Never send a Google user agent or a `UCP-Agent` header; the roadmap forbids spoofing Google. Do not change `proxy.ts` or any firewall rule.
- Record no secrets, buyer data or personal data. Everything below is merchant configuration, migration version strings and public HTTP metadata.

- [ ] **Step 1: Create a work directory outside the repository**

```bash
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
mkdir -p "$WORK"
```

Every later command in this task uses `$WORK`; export it again in a new shell.

- [ ] **Step 2: Compute the repository side of the migration ledger**

This reads `origin/main`, because production deploys from there; plan 1's new migration is not applied until it merges.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
git fetch origin main
git ls-tree --name-only origin/main supabase/migrations/ \
  | sed -n 's#^supabase/migrations/\([0-9]\{14\}\)_.*\.sql$#\1#p' | sort -u > "$WORK/repo-versions.txt"
python3 - <<'PY'
import json, os, pathlib
work = pathlib.Path(os.environ["WORK"])
versions = (work / "repo-versions.txt").read_text().split()
(work / "repo.json").write_text(json.dumps({"count": len(versions), "max": versions[-1]}))
print(len(versions), versions[-1])
PY
tail -40 "$WORK/repo-versions.txt" | wc -l
```

Expected: the count of unique versions (two versions are shared by two files each, so it is two lower than the file count) and the newest version, then `40`. At the time of writing: `2071 20261030230000`.

- [ ] **Step 3: Query A, the merchant configuration**

Call the Supabase MCP `list_projects` and choose Baci's production project, then `execute_sql` with exactly this statement. The slug is the Ogabassey merchant; the production profile declares the cart capability only when the configured agentic merchant slug equals this merchant's slug, so a cart capability in Step 5 also confirms the configuration. To check that the variable exists (names only, never values) you may run `vercel env ls production` from a linked checkout; skip this if the CLI is not linked.

```sql
SELECT
  m.slug,
  m.plan_tier,
  m.plan_expires_at,
  COALESCE(m.premium_features @> '["shared_cart"]'::jsonb, false) AS shared_cart_enrolled,
  m.vat_registration_status,
  m.vat_rate,
  fs.agentic_checkout_enabled,
  fs.pay_on_delivery_enabled,
  (
    SELECT d.domain
    FROM public.domains AS d
    WHERE d.merchant_id = m.id AND d.status = 'active'
    ORDER BY d.is_primary DESC NULLS LAST, d.updated_at DESC NULLS LAST,
             d.created_at DESC NULLS LAST, d.id
    LIMIT 1
  ) AS active_domain,
  (
    SELECT count(*) FROM public.domains AS d
    WHERE d.merchant_id = m.id AND d.status = 'active'
  ) AS active_domain_count
FROM public.merchants AS m
LEFT JOIN public.merchant_feature_settings AS fs ON fs.merchant_id = m.id
WHERE m.slug = 'ogabassey';
```

Expected: exactly one row. Save the returned rows, unchanged, as a JSON array to `$WORK/qa.json` (for example `cat > "$WORK/qa.json"` with a quoted heredoc), then check it parses:

```bash
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
python3 -m json.tool "$WORK/qa.json" > /dev/null && echo parsed
```

A null `agentic_checkout_enabled` means the merchant has no settings row, which the scoped context RPC treats as enabled. If `active_domain` is null, stop and ask the owner; do not guess a host.

- [ ] **Step 4: Query B, the migration ledger**

Print the statement with the 40 newest repository versions filled in, then run what it prints with `execute_sql`:

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
LITERALS=$(tail -40 "$WORK/repo-versions.txt" | sed "s/.*/'&'/" | paste -sd, -)
cat <<SQL
WITH repo_newest AS (
  SELECT unnest(ARRAY[$LITERALS]::text[]) AS version
), ledger AS (
  SELECT version FROM supabase_migrations.schema_migrations
)
SELECT
  (SELECT count(*) FROM ledger) AS ledger_count,
  (SELECT max(version) FROM ledger) AS ledger_max_version,
  COALESCE((
    SELECT array_agg(r.version ORDER BY r.version)
    FROM repo_newest AS r
    WHERE NOT EXISTS (SELECT 1 FROM ledger AS l WHERE l.version = r.version)
  ), ARRAY[]::text[]) AS repo_newest_40_missing_from_ledger,
  COALESCE((
    SELECT array_agg(l.version ORDER BY l.version)
    FROM ledger AS l
    WHERE l.version >= (SELECT min(version) FROM repo_newest)
      AND l.version NOT IN (SELECT version FROM repo_newest)
  ), ARRAY[]::text[]) AS ledger_only_since_oldest_of_40;
SQL
```

Save the returned rows as a JSON array to `$WORK/qb.json` and check it parses as in Step 3. If the ledger schema is not readable through the tool, do not create the file: the builder records `unavailable`, which is evidence of nothing.

- [ ] **Step 5: Probe the public profile**

Set `DOMAIN` to the `active_domain` value from Query A (the command below uses the expected `ogabassey.com`; use the returned value if it differs), then run the script. It sends two `GET` requests: plain curl, and curl with a common desktop browser `User-Agent`. It follows no redirects, so a redirect shows as its own status.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
export DOMAIN=ogabassey.com
bash <<'SCRIPT'
set -u
: "${DOMAIN:?set DOMAIN to active_domain from query A}"
WORK="${WORK:-${TMPDIR:-/tmp}/agentic-baseline-2026-10-31}"
# PROFILE_URL is overridden only to rehearse this script against a local file.
PROFILE_URL="${PROFILE_URL:-https://${DOMAIN}/.well-known/ucp}"
BROWSER_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
mkdir -p "$WORK"
rm -f "$WORK"/plain.* "$WORK"/browser.*
date -u +%Y-%m-%dT%H:%M:%SZ > "$WORK/probed_at"

# Plain curl keeps curl's own User-Agent. The browser probe differs only by
# User-Agent. Never add a Google user agent or a UCP-Agent header.
curl -sS --max-time 30 -o "$WORK/plain.body" -D "$WORK/plain.headers" \
  -w '%{http_code}' "$PROFILE_URL" > "$WORK/plain.status" 2> "$WORK/plain.error" || true
curl -sS --max-time 30 -A "$BROWSER_UA" -o "$WORK/browser.body" -D "$WORK/browser.headers" \
  -w '%{http_code}' "$PROFILE_URL" > "$WORK/browser.status" 2> "$WORK/browser.error" || true
for probe in plain browser; do
  bytes=0
  [ -f "$WORK/$probe.body" ] && bytes=$(wc -c < "$WORK/$probe.body" | tr -d ' ')
  echo "$probe: status=$(cat "$WORK/$probe.status") bytes=$bytes"
done
SCRIPT
```

Expected: two lines such as `plain: status=200 bytes=…` and `browser: status=…`. Whatever the statuses are, they are the finding; do not retry with other headers.

- [ ] **Step 6: Build the evidence file**

The builder reads the work directory and writes the Markdown. It never prints response bodies; it records the status, three headers, whether `cf-ray` exists, the body SHA-256, `ucp.version` and the capability and payment-handler names.

````bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
mkdir -p docs/superpowers/evidence/agentic
cat > "$WORK/build_evidence.py" <<'PY'
import hashlib
import json
import pathlib
import re
import sys

work = pathlib.Path(sys.argv[1])
origin_main = sys.argv[2]
out = pathlib.Path(sys.argv[3])


def load(name):
    path = work / name
    return json.loads(path.read_text()) if path.exists() else None


def first_row(name):
    rows = load(name)
    return rows[0] if isinstance(rows, list) and rows else None


def header(headers_text, name):
    values = re.findall(rf"(?im)^{re.escape(name)}:[ \t]*(.*?)\r?$", headers_text)
    return values[-1] if values else "(absent)"


def probe(label):
    status_file = work / f"{label}.status"
    status_text = status_file.read_text().strip() if status_file.exists() else ""
    if not status_text.isdigit() or status_text == "000":
        error = work / f"{label}.error"
        reason = error.read_text().strip() if error.exists() else "not run"
        return {"label": label, "status": "unavailable", "note": reason or "no response"}
    headers = (work / f"{label}.headers").read_text(errors="replace")
    body = (work / f"{label}.body").read_bytes()
    info = {
        "label": label,
        "status": status_file.read_text().strip(),
        "server": header(headers, "server"),
        "cf_ray": "present" if re.search(r"(?im)^cf-ray:", headers) else "absent",
        "cache_control": header(headers, "cache-control"),
        "content_type": header(headers, "content-type"),
        "sha256": hashlib.sha256(body).hexdigest(),
        "version": "(not JSON)",
        "capabilities": [],
        "payment_handlers": [],
    }
    try:
        ucp = json.loads(body)["ucp"]
        info["version"] = ucp.get("version", "(absent)")
        info["capabilities"] = sorted(ucp.get("capabilities", {}))
        info["payment_handlers"] = sorted(ucp.get("payment_handlers", {}))
    except (ValueError, KeyError, TypeError, AttributeError):
        pass
    return info


MISSING = object()


def cell(value):
    if value is MISSING:
        return "unavailable"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).replace("|", "/")


def field(row, key):
    return MISSING if row is None else row.get(key)


a = first_row("qa.json")
b = first_row("qb.json")
repo = load("repo.json")
probes = [probe("plain"), probe("browser")]
probed_at_file = work / "probed_at"
probed_at = probed_at_file.read_text().strip() if probed_at_file.exists() else "an unrecorded time"

lines = [
    "# Agentic production baseline, 31 October 2026",
    "",
    "Read-only observations of the production agentic merchant. No credentials, buyer data or personal data are recorded, and nothing here changes production. A value of `unavailable` means the check could not be run; it is not evidence either way.",
    "",
    "## Method",
    "",
    "- Supabase: `SELECT` statements through the read-only `execute_sql` tool.",
    f"- Repository: `origin/main` at `{origin_main}` supplied the migration versions.",
    f"- Probed at {probed_at} (UTC).",
    "- HTTP: one `GET` per probe. The plain probe keeps curl's own `User-Agent`; the browser probe differs only by a common desktop browser `User-Agent`. No Google user agent and no `UCP-Agent` header were sent, and no `proxy.ts` or firewall setting was changed.",
    "",
    "## Earlier observations (F8, not reproduced by this file)",
    "",
    "Ogabassey's public UCP profile first returned HTTP 200 with catalog, cart and order capabilities and no checkout, payment handler or signing keys. It then returned HTTP 403 from the same environment. The cause and Google's own access are unknown. The probes below are separate observations taken at the time stated under Method.",
    "",
    "## Merchant configuration",
    "",
    "| Field | Value |",
    "| --- | --- |",
]
fields = [
    ("slug", "slug"),
    ("plan_tier", "plan_tier"),
    ("plan_expires_at", "plan_expires_at"),
    ("shared_cart enrolled (`premium_features` contains `shared_cart`)", "shared_cart_enrolled"),
    ("vat_registration_status", "vat_registration_status"),
    ("vat_rate", "vat_rate"),
    ("agentic_checkout_enabled (`merchant_feature_settings`; null means no settings row, which the context RPC treats as enabled)", "agentic_checkout_enabled"),
    ("pay_on_delivery_enabled", "pay_on_delivery_enabled"),
    ("active domain (`domains`, status active)", "active_domain"),
    ("active domain count", "active_domain_count"),
]
for label, key in fields:
    lines.append(f"| {label} | {cell(field(a, key))} |")

lines += ["", "## Migration ledger", "", "| Measure | Value |", "| --- | --- |"]
lines.append(f"| Repository versions on `origin/main` (unique) | {cell(field(repo, 'count'))} |")
lines.append(f"| Repository newest version | {cell(field(repo, 'max'))} |")
lines.append(f"| Ledger rows (`supabase_migrations.schema_migrations`) | {cell(field(b, 'ledger_count'))} |")
lines.append(f"| Ledger newest version | {cell(field(b, 'ledger_max_version'))} |")


def version_list(key):
    value = field(b, key)
    if value is MISSING or value is None:
        return MISSING
    return ", ".join(value) if value else "none"


lines.append(f"| Newest 40 repository versions absent from the ledger | {cell(version_list('repo_newest_40_missing_from_ledger'))} |")
lines.append(f"| Ledger versions in that window that are not in the repository | {cell(version_list('ledger_only_since_oldest_of_40'))} |")

lines += [
    "",
    "## Public profile probes (`GET /.well-known/ucp`)",
    "",
    "| Probe | Status | `server` | `cf-ray` | `cache-control` | `content-type` | Body SHA-256 | `ucp.version` | Capabilities | Payment handlers |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
]
for p in probes:
    if p["status"] == "unavailable":
        lines.append(f"| {p['label']} | unavailable ({cell(p['note'])}) | | | | | | | | |")
        continue
    lines.append(
        f"| {p['label']} | {p['status']} | {cell(p['server'])} | {p['cf_ray']} | {cell(p['cache_control'])} | {cell(p['content_type'])} | `{p['sha256']}` | {cell(p['version'])} | {cell(', '.join(p['capabilities']) or 'none')} | {cell(', '.join(p['payment_handlers']) or 'none')} |"
    )

lines += [
    "",
    "## What this does not show",
    "",
    "- A reachable profile is not a working cart, checkout or payment: no cart, checkout session or order was created.",
    "- Google's own fetch, enrollment and access remain unverified; these probes are not Google's.",
    "- Applied migrations, deployed revision and traffic were not inspected beyond the ledger rows above.",
    "",
]


def declared(name):
    bodies = [p for p in probes if p["status"] == "200" and p["version"] != "(not JSON)"]
    if not bodies:
        return "unknown"
    return "true" if all(name in p["capabilities"] for p in bodies) else "false"


handler_bodies = [p for p in probes if p["status"] == "200" and p["version"] != "(not JSON)"]
google_pay = "unknown" if not handler_bodies else (
    "true" if all("com.google.pay" in p["payment_handlers"] for p in handler_bodies) else "false"
)
lines += [
    "## Summary for tooling",
    "",
    "```text",
    f"plain_status={probes[0]['status']}",
    f"browser_status={probes[1]['status']}",
    f"cart_declared={declared('dev.ucp.shopping.cart')}",
    f"checkout_declared={declared('dev.ucp.shopping.checkout')}",
    f"google_pay_declared={google_pay}",
    "```",
    "",
]
out.write_text("\n".join(lines))
PY
python3 "$WORK/build_evidence.py" "$WORK" "$(git rev-parse origin/main)" docs/superpowers/evidence/agentic/2026-10-31-baseline.md
````

- [ ] **Step 7: Read the file and check it for secrets**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
cat docs/superpowers/evidence/agentic/2026-10-31-baseline.md
grep -nEi 'eyJ|sk_(live|test)|pk_(live|test)|bearer |acct_|password|@[a-z0-9.-]+\.[a-z]{2,}' docs/superpowers/evidence/agentic/2026-10-31-baseline.md
```

Expected: the first command shows the merchant table, the migration table, both probe rows and the tooling summary; the second prints nothing. If anything matches, remove it before committing.

- [ ] **Step 8: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
git add docs/superpowers/evidence/agentic/2026-10-31-baseline.md
LEFTHOOK_EXCLUDE=knip git commit -m "docs(evidence): record the 31 October agentic production baseline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Hand the branch to the orchestrator for the first checkpoint push, which opens the draft pull request (Task 9 has the body).

---
### Task 2: The surface-evidence validator

**Files:**
- Create: `apps/web/src/lib/agentic/evidence/agent-surface-evidence.ts`
- Test: `apps/web/src/lib/agentic/evidence/agent-surface-evidence.test.ts`

The validator parses the Markdown table under `## Agent surface evidence` in `docs/product/agent-access-map.md`. It requires the 13 columns in this order, exactly the seven named surfaces once each, no empty cell, a source revision that is a 40-character SHA or `unknown`, and status cells (`Local test`, `Staging`, `Production`, `Partner receipt`) that are `unknown`, `not applicable`, or `pass`/`fail` plus a real calendar date plus a Markdown link or a 7 to 40 character commit. Words such as "verified", "live", "ok" or a bare "pass" are rejected, so an unknown can never read as success. It reports every problem, with a typed code, instead of stopping at the first.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/agentic/evidence/agent-surface-evidence.test.ts` with exactly:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AGENT_SURFACE_EVIDENCE_COLUMNS,
  AGENT_SURFACES,
  formatSurfaceEvidenceErrors,
  parseSurfaceStatus,
  type SurfaceEvidenceError,
  type SurfaceEvidenceResult,
  validateAgentSurfaceEvidence,
} from './agent-surface-evidence';

const COMMIT = '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382';

function validRow(surface: string): Record<string, string> {
  return {
    Surface: surface,
    Partner: 'Example partner',
    'Protocol version': '2026-04-08',
    Merchant: 'Example merchant',
    'Source revision': COMMIT,
    'Local test': 'pass 2026-10-31 [test](../../apps/web/example.test.ts)',
    Staging: 'unknown',
    Production:
      'fail 2026-10-31 [baseline](../superpowers/evidence/example.md)',
    'Partner receipt': 'not applicable',
    'Market and currency': 'Nigeria, NGN',
    'Eligible products': 'Example products',
    Authentication: 'Example authentication',
    'Next check owner': 'Example owner',
  };
}

function renderTable(
  rows: Record<string, string>[],
  columns: readonly string[] = AGENT_SURFACE_EVIDENCE_COLUMNS
): string {
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((c) => row[c] ?? '').join(' | ')} |`),
  ].join('\n');
}

function document(table: string): string {
  return `# Map\n\n## Other table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## Agent surface evidence\n\nLegend text.\n\n${table}\n\n## Next section\n\n| Surface |\n| --- |\n| ignored |\n`;
}

function allRows(): Record<string, string>[] {
  return AGENT_SURFACES.map((surface) => validRow(surface));
}

function failure(result: SurfaceEvidenceResult): SurfaceEvidenceError[] {
  if (result.ok) throw new Error('Expected validation to fail');
  return [...result.errors];
}

function codes(result: SurfaceEvidenceResult): string[] {
  return failure(result).map((error) => error.code);
}

describe('validateAgentSurfaceEvidence', () => {
  it('accepts a complete table and returns the rows in order', () => {
    const result = validateAgentSurfaceEvidence(
      document(renderTable(allRows()))
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.Surface)).toEqual([...AGENT_SURFACES]);
    expect(result.rows[0]['Source revision']).toBe(COMMIT);
  });

  it('accepts unknown source revisions and unknown statuses', () => {
    const rows = allRows().map((row) => ({
      ...row,
      'Source revision': 'unknown',
      'Local test': 'unknown',
      Production: 'unknown',
    }));

    expect(validateAgentSurfaceEvidence(document(renderTable(rows))).ok).toBe(
      true
    );
  });

  it('reports a missing section', () => {
    expect(
      codes(validateAgentSurfaceEvidence('# Map\n\nNo table here.\n'))
    ).toEqual(['section_missing']);
  });

  it('reports a section without a table', () => {
    const markdown =
      '## Agent surface evidence\n\nOnly prose here.\n\n## Next\n';
    expect(codes(validateAgentSurfaceEvidence(markdown))).toEqual([
      'table_missing',
    ]);
  });

  it('reports a table without a separator row', () => {
    const markdown = `## Agent surface evidence\n\n| ${AGENT_SURFACE_EVIDENCE_COLUMNS.join(' | ')} |\n`;
    expect(codes(validateAgentSurfaceEvidence(markdown))).toEqual([
      'table_missing',
    ]);
  });

  it('reports renamed, reordered and missing columns', () => {
    const renamed: string[] = [...AGENT_SURFACE_EVIDENCE_COLUMNS];
    renamed[7] = 'Live';
    const reordered = [...AGENT_SURFACE_EVIDENCE_COLUMNS].reverse();
    const missing = AGENT_SURFACE_EVIDENCE_COLUMNS.slice(0, 12);

    for (const columns of [renamed, reordered, missing]) {
      expect(
        codes(
          validateAgentSurfaceEvidence(
            document(renderTable(allRows(), columns))
          )
        )
      ).toEqual(['columns_mismatch']);
    }
  });

  it('reports rows with the wrong number of cells', () => {
    const table = `${renderTable(allRows())}\n| Extra row | only | three |`;
    expect(codes(validateAgentSurfaceEvidence(document(table)))).toEqual([
      'row_width',
    ]);
  });

  it('reports unknown, duplicate and missing surfaces', () => {
    const rows = allRows();
    rows[0] = validRow('Apple Pay');
    rows[6] = validRow('Google UCP cart');

    const errors = failure(
      validateAgentSurfaceEvidence(document(renderTable(rows)))
    );

    expect(errors.map((error) => error.code)).toEqual([
      'surface_unknown',
      'surface_duplicate',
      'surface_missing',
      'surface_missing',
    ]);
    expect(
      errors
        .filter((error) => error.code === 'surface_missing')
        .map((error) => error.surface)
    ).toEqual(['OpenAI MCP handoff', 'Multi-merchant onboarding']);
  });

  it.each([
    '',
    '-',
    '—',
    'TBD',
    'todo',
    'n/a',
  ])('rejects the empty cell %j', (value) => {
    const rows = allRows();
    rows[2] = { ...rows[2], Authentication: value };

    const errors = failure(
      validateAgentSurfaceEvidence(document(renderTable(rows)))
    );

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'empty_cell',
        column: 'Authentication',
        surface: 'Google UCP cart',
      }),
    ]);
  });

  it.each([
    'verified',
    'live',
    'ok',
    'pass',
    'fail',
    'Unknown',
    'passed 2026-10-31 [test](x.md)',
    'pass 2026-10-31',
    'pass 2026-10-31 verified',
    'pass 2026-10-31 abc12',
    'pass 2026-10-31 ABCDEF1',
    'pass 2026-13-01 [test](x.md)',
    'pass 2026-02-30 [test](x.md)',
    'pass 26-10-31 [test](x.md)',
    'pass 2026-10-31 [](x.md)',
    'pass 2026-10-31 [test]()',
  ])('rejects the status %j in every status column', (value) => {
    for (const column of [
      'Local test',
      'Staging',
      'Production',
      'Partner receipt',
    ]) {
      const rows = allRows();
      rows[4] = { ...rows[4], [column]: value };

      const errors = failure(
        validateAgentSurfaceEvidence(document(renderTable(rows)))
      );

      expect(errors).toEqual([
        expect.objectContaining({
          code: 'invalid_status',
          column,
          surface: 'Paystack-hosted Google Pay',
        }),
      ]);
    }
  });

  it.each([
    'source revision',
    'abc1234',
    '9C9D6FCE39FFA8BF7CB66309C378B79FB75B5382',
    '9c9d6fce39ffa8bf7cb66309c378b79fb75b538',
    'verified',
  ])('rejects the source revision %j', (value) => {
    const rows = allRows();
    rows[1] = { ...rows[1], 'Source revision': value };

    expect(
      failure(validateAgentSurfaceEvidence(document(renderTable(rows))))
    ).toEqual([
      expect.objectContaining({
        code: 'invalid_source_revision',
        surface: 'ACP direct checkout',
      }),
    ]);
  });

  it('reports every problem instead of stopping at the first', () => {
    const rows = allRows();
    rows[0] = { ...rows[0], Production: 'live', 'Source revision': 'abc' };
    rows[3] = { ...rows[3], Merchant: '' };

    expect(
      codes(validateAgentSurfaceEvidence(document(renderTable(rows))))
    ).toEqual(['invalid_status', 'invalid_source_revision', 'empty_cell']);
  });
});

describe('parseSurfaceStatus', () => {
  it.each([
    ['unknown', { kind: 'unknown' }],
    ['not applicable', { kind: 'not_applicable' }],
    [
      'pass 2026-10-31 [test](../x.test.ts)',
      { kind: 'pass', date: '2026-10-31', evidence: '[test](../x.test.ts)' },
    ],
    [
      'fail 2026-10-30 abc1234',
      { kind: 'fail', date: '2026-10-30', evidence: 'abc1234' },
    ],
    [
      `pass 2024-02-29 ${COMMIT}`,
      { kind: 'pass', date: '2024-02-29', evidence: COMMIT },
    ],
  ])('parses %j', (cell, expected) => {
    expect(parseSurfaceStatus(cell)).toEqual(expected);
  });

  it('returns null for text that is not a status', () => {
    expect(parseSurfaceStatus('verified')).toBeNull();
  });
});

describe('formatSurfaceEvidenceErrors', () => {
  it('prefixes each message with its code', () => {
    expect(
      formatSurfaceEvidenceErrors([
        { code: 'surface_missing', message: 'Missing a row.' },
      ])
    ).toEqual(['surface_missing: Missing a row.']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/evidence/agent-surface-evidence.test.ts --testTimeout=120000
```

Expected: FAIL for the whole file, with `Error: Cannot find module './agent-surface-evidence' imported from …/src/lib/agentic/evidence/agent-surface-evidence.test.ts`, `Test Files  1 failed (1)` and `Tests  no tests`.

- [ ] **Step 3: Write the validator**

Create `apps/web/src/lib/agentic/evidence/agent-surface-evidence.ts` with exactly:

```ts
const AGENT_SURFACE_EVIDENCE_HEADING = '## Agent surface evidence';

export const AGENT_SURFACE_EVIDENCE_COLUMNS = [
  'Surface',
  'Partner',
  'Protocol version',
  'Merchant',
  'Source revision',
  'Local test',
  'Staging',
  'Production',
  'Partner receipt',
  'Market and currency',
  'Eligible products',
  'Authentication',
  'Next check owner',
] as const;

export const AGENT_SURFACES = [
  'OpenAI MCP handoff',
  'ACP direct checkout',
  'Google UCP cart',
  'Google UCP native checkout',
  'Paystack-hosted Google Pay',
  'First-party storefront chat',
  'Multi-merchant onboarding',
] as const;

const STATUS_COLUMNS = [
  'Local test',
  'Staging',
  'Production',
  'Partner receipt',
] as const;

type Column = (typeof AGENT_SURFACE_EVIDENCE_COLUMNS)[number];

type SurfaceEvidenceRow = Readonly<Record<Column, string>>;

type SurfaceStatus =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not_applicable' }
  | {
      readonly kind: 'pass' | 'fail';
      readonly date: string;
      readonly evidence: string;
    };

type SurfaceEvidenceErrorCode =
  | 'section_missing'
  | 'table_missing'
  | 'columns_mismatch'
  | 'row_width'
  | 'surface_unknown'
  | 'surface_duplicate'
  | 'surface_missing'
  | 'empty_cell'
  | 'invalid_status'
  | 'invalid_source_revision';

export interface SurfaceEvidenceError {
  readonly code: SurfaceEvidenceErrorCode;
  readonly message: string;
  readonly surface?: string;
  readonly column?: string;
}

export type SurfaceEvidenceResult =
  | { readonly ok: true; readonly rows: readonly SurfaceEvidenceRow[] }
  | { readonly ok: false; readonly errors: readonly SurfaceEvidenceError[] };

const SEPARATOR_ROW = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
const EMPTY_CELL = /^(?:[-–—]*|tbd|todo|n\/a)$/i;
const STATUS_WITH_EVIDENCE = /^(pass|fail) (\d{4}-\d{2}-\d{2}) (.+)$/;
const MARKDOWN_LINK = /^\[[^\]\n]+\]\([^)\s]+\)$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const SOURCE_REVISION = /^(?:[0-9a-f]{40}|unknown)$/;

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Parses one status cell. Only an explicit `unknown`, `not applicable`, or a
 * dated `pass`/`fail` with a link or commit as evidence is accepted, so an
 * unproven surface can never read as success.
 */
export function parseSurfaceStatus(cell: string): SurfaceStatus | null {
  if (cell === 'unknown') return { kind: 'unknown' };
  if (cell === 'not applicable') return { kind: 'not_applicable' };
  const match = STATUS_WITH_EVIDENCE.exec(cell);
  if (!match) return null;
  const [, kind, date, evidence] = match;
  if (!isCalendarDate(date)) return null;
  if (!MARKDOWN_LINK.test(evidence) && !COMMIT.test(evidence)) return null;
  return { kind: kind as 'pass' | 'fail', date, evidence };
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function findTable(markdown: string): string[] | SurfaceEvidenceError {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => line.trim() === AGENT_SURFACE_EVIDENCE_HEADING
  );
  if (start === -1) {
    return {
      code: 'section_missing',
      message: `Missing the "${AGENT_SURFACE_EVIDENCE_HEADING}" section.`,
    };
  }
  const table: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim().startsWith('|')) {
      table.push(line);
    } else if (table.length > 0) {
      break;
    }
  }
  if (table.length < 2 || !SEPARATOR_ROW.test(table[1].trim())) {
    return {
      code: 'table_missing',
      message: `"${AGENT_SURFACE_EVIDENCE_HEADING}" needs a Markdown table with a header and separator row.`,
    };
  }
  return table;
}

function validateRow(
  row: SurfaceEvidenceRow,
  seen: Set<string>
): SurfaceEvidenceError[] {
  const errors: SurfaceEvidenceError[] = [];
  const surface = row.Surface;
  const known = (AGENT_SURFACES as readonly string[]).includes(surface);
  if (surface && !known) {
    errors.push({
      code: 'surface_unknown',
      message: `"${surface}" is not one of the seven tracked surfaces.`,
      surface,
    });
  } else if (known && seen.has(surface)) {
    errors.push({
      code: 'surface_duplicate',
      message: `"${surface}" appears more than once.`,
      surface,
    });
  }
  seen.add(surface);

  for (const column of AGENT_SURFACE_EVIDENCE_COLUMNS) {
    if (EMPTY_CELL.test(row[column])) {
      errors.push({
        code: 'empty_cell',
        message: `${surface || '(row)'}: "${column}" is empty; write unknown or not applicable explicitly.`,
        surface,
        column,
      });
    }
  }
  for (const column of STATUS_COLUMNS) {
    if (!EMPTY_CELL.test(row[column]) && !parseSurfaceStatus(row[column])) {
      errors.push({
        code: 'invalid_status',
        message: `${surface}: "${column}" must be unknown, not applicable, or pass/fail YYYY-MM-DD plus a Markdown link or commit; got "${row[column]}".`,
        surface,
        column,
      });
    }
  }
  const revision = row['Source revision'];
  if (!EMPTY_CELL.test(revision) && !SOURCE_REVISION.test(revision)) {
    errors.push({
      code: 'invalid_source_revision',
      message: `${surface}: "Source revision" must be a 40-character commit SHA or unknown; got "${revision}".`,
      surface,
      column: 'Source revision',
    });
  }
  return errors;
}

/** Validates the "Agent surface evidence" table in docs/product/agent-access-map.md. */
export function validateAgentSurfaceEvidence(
  markdown: string
): SurfaceEvidenceResult {
  const table = findTable(markdown);
  if (!Array.isArray(table)) return { ok: false, errors: [table] };

  const header = splitRow(table[0]);
  if (header.join('|') !== AGENT_SURFACE_EVIDENCE_COLUMNS.join('|')) {
    return {
      ok: false,
      errors: [
        {
          code: 'columns_mismatch',
          message: `Columns must be exactly: ${AGENT_SURFACE_EVIDENCE_COLUMNS.join(' | ')}. Got: ${header.join(' | ')}.`,
        },
      ],
    };
  }

  const errors: SurfaceEvidenceError[] = [];
  const rows: SurfaceEvidenceRow[] = [];
  const seen = new Set<string>();
  for (const line of table.slice(2)) {
    const cells = splitRow(line);
    if (cells.length !== AGENT_SURFACE_EVIDENCE_COLUMNS.length) {
      errors.push({
        code: 'row_width',
        message: `Row "${cells[0]}" has ${cells.length} cells; expected ${AGENT_SURFACE_EVIDENCE_COLUMNS.length}.`,
        surface: cells[0],
      });
      continue;
    }
    const row = Object.fromEntries(
      AGENT_SURFACE_EVIDENCE_COLUMNS.map((column, index) => [
        column,
        cells[index],
      ])
    ) as Record<Column, string>;
    rows.push(row);
    errors.push(...validateRow(row, seen));
  }
  for (const surface of AGENT_SURFACES) {
    if (!seen.has(surface)) {
      errors.push({
        code: 'surface_missing',
        message: `Missing a row for "${surface}".`,
        surface,
      });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

export function formatSurfaceEvidenceErrors(
  errors: readonly SurfaceEvidenceError[]
): string[] {
  return errors.map((error) => `${error.code}: ${error.message}`);
}
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/evidence/agent-surface-evidence.test.ts --testTimeout=120000
```

Expected: `Test Files  1 passed (1)` and `Tests  43 passed (43)`.

- [ ] **Step 5: Format**

The file is under `src`, so the main TypeScript project typechecks it; Task 8 runs that project once.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
npm_config_verify_deps_before_run=false pnpm exec biome check --write apps/web/src/lib/agentic/evidence
```

Expected: no errors; Biome may report that it fixed formatting.

- [ ] **Step 6: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/evidence/agent-surface-evidence.ts apps/web/src/lib/agentic/evidence/agent-surface-evidence.test.ts
git status --short
LEFTHOOK_EXCLUDE=knip git commit -m "test(agentic): add the agent surface evidence validator" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If `coderabbit` is unavailable, skip it and note why (see "How to run this plan"). Expected from `git status --short` before the commit: only the two staged files.

---

### Task 3: The access-map table and its repository test

**Files:**
- Create: `apps/web/src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts`
- Modify: `docs/product/agent-access-map.md`

- [ ] **Step 1: Write the failing repository test**

Create `apps/web/src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts` with exactly:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  formatSurfaceEvidenceErrors,
  validateAgentSurfaceEvidence,
} from './agent-surface-evidence';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../..'
);

it('keeps the access map surface evidence table complete and unambiguous', () => {
  const markdown = readFileSync(
    join(repoRoot, 'docs/product/agent-access-map.md'),
    'utf8'
  );

  const result = validateAgentSurfaceEvidence(markdown);

  expect(result.ok ? [] : formatSurfaceEvidenceErrors(result.errors)).toEqual(
    []
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts --testTimeout=120000
```

Expected: FAIL with `AssertionError: expected [ Array(1) ] to deeply equal []` and the received entry `"section_missing: Missing the \"## Agent surface evidence\" section."`.

- [ ] **Step 3: Re-check the code facts the table quotes**

The table cites these lines; confirm each before writing it. If a number moved, change the text in Step 4 to match.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
grep -n "API_VERSION = \|SUPPORTED_AGENTIC_API_VERSIONS = " apps/web/src/lib/agentic/request-integrity.ts
grep -n "protocolVersion" apps/web/src/app/.well-known/mcp/server-card.json/route.ts
grep -n "MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS\|^const OGABASSEY_SLUG" apps/web/mcp-server/server.ts
grep -n "com.google.pay" apps/web/src/lib/agentic/ucp-discovery-profile.ts
grep -n "const signedAgentReadsEnabled\|merchant.slug === getConfiguredAgenticMerchantSlug\|auth: signedAgentReadsEnabled" apps/web/src/lib/agentic/agent-commerce-manifest.ts
grep -n "manifest.auth !== null" apps/web/src/lib/agentic/ucp-shopping-profile.ts
grep -n "BACI_AGENTIC_MERCHANT_SLUG\|OPENAI_AGENTIC_MERCHANT_SLUG" apps/web/src/lib/agentic/agentic-merchant-slug.ts
```

Expected:

```
5:export const AGENTIC_API_VERSION = '2026-04-30';
6:export const ACP_STABLE_AGENTIC_API_VERSION = '2026-04-17';
7:export const PREVIOUS_AGENTIC_API_VERSION = '2026-01-01';
8:export const SUPPORTED_AGENTIC_API_VERSIONS = [
15:      protocolVersion: '2025-06-18',
92:const OGABASSEY_SLUG = 'ogabassey';
100:  process.env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS === '1' ||
101:  process.env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS === 'true';
105:      handlers['com.google.pay'] = [
126:  const signedAgentReadsEnabled =
128:    merchant.slug === getConfiguredAgenticMerchantSlug();
155:    auth: signedAgentReadsEnabled ? buildAgenticCheckoutAuth() : null,
264:  return manifest.auth !== null;
269:    manifest.auth !== null && manifest.capabilities.includes('catalog.read')
14:    readNonBlank(process.env.BACI_AGENTIC_MERCHANT_SLUG) ??
15:    readNonBlank(process.env.OPENAI_AGENTIC_MERCHANT_SLUG)
```

The Google Pay handler is built inside `buildUcpPaymentHandlers` (starts line 70) in the block from line 102 to line 119.

- [ ] **Step 4: Add the section to the access map**

Write the section to the work directory, then insert it directly above the heading `## Next connector implementation slice (planned, not shipped here)`. The table is written with Task 8's four Local test cells and every Source revision as `unknown`; two Production cells are settled from the baseline in Step 5.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
mkdir -p "$WORK"
cat > "$WORK/surface-evidence-section.md" <<'MD'
## Agent surface evidence

One row per agent surface, so an unproven surface cannot borrow another's
status. Status columns hold `unknown` (nothing evidenced), `not applicable` (the
check does not apply to the surface), or `pass` or `fail` followed by a date and
a link or commit as evidence. A test that pins a known gap (`it.fails`) or a
documented limitation is recorded as `fail`, because what it pins is a failure
of the surface. `Source revision` is the commit the row was reviewed against.
The table is validated by
`apps/web/src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts`; the
production observations come from the
[31 October 2026 baseline](../superpowers/evidence/agentic/2026-10-31-baseline.md).

| Surface | Partner | Protocol version | Merchant | Source revision | Local test | Staging | Production | Partner receipt | Market and currency | Eligible products | Authentication | Next check owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenAI MCP handoff | OpenAI (ChatGPT apps over MCP) | MCP `2025-06-18`, advertised by `apps/web/src/app/.well-known/mcp/server-card.json/route.ts`; the latest spec is `2026-07-28` (F40) | Ogabassey only (`OGABASSEY_SLUG` in `apps/web/mcp-server/server.ts`) | unknown | unknown | unknown | unknown | unknown | Nigeria, NGN | Ogabassey catalog tools; the shopping checkout tools register only when `MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS` is `true` or `1` (default false) | Anonymous discovery (the server card says authentication is not required); checkout tools call the signed agentic API with a server-held credential | ogabasseyy; roadmap Task 5 |
| ACP direct checkout | OpenAI (ChatGPT checkout over ACP) | `2026-04-30`, `2026-04-17` and `2026-01-01` in `apps/web/src/lib/agentic/request-integrity.ts` (lines 5 to 10); `2026-04-30` has no ACP release and `2026-04-17` is the latest (F41) | The one configured agentic merchant (Ogabassey) | unknown | unknown | unknown | unknown | unknown | Nigeria, NGN (`apps/web/src/lib/agentic/acp-discovery-profile.ts` lists NGN and en-NG only) | Merchant products the checkout quote can price; used and refurbished eligibility is not evidenced (roadmap Task 8) | Bearer API key plus HMAC-SHA256 request signing declared in `apps/web/src/lib/agentic/agent-commerce-manifest.ts`; not partner-scoped | ogabasseyy; roadmap Task 5 |
| Google UCP cart | Google (UCP cart transfer) | UCP `2026-04-08` (`apps/web/src/lib/agentic/ucp-profile-constants.ts`); Google's cart supports create-and-transfer (`POST /carts`), and update and cancel are optional in the sandbox | The one configured agentic merchant (Ogabassey) | unknown | unknown | unknown | unknown | unknown | Nigeria, NGN | Storefront carts; `apps/web/src/lib/agentic/ucp-shopping-profile.ts` declares cart whenever agent auth is configured, even for a merchant not enrolled in shared cart (F34) | The same bearer and HMAC scheme as ACP; whether Google can authenticate is unverified (F8) | ogabasseyy; roadmap Task 3, then Task 9 |
| Google UCP native checkout | Google (UCP checkout) | UCP `2026-04-08`; declared only when all five checkout session capabilities and links exist (`apps/web/src/lib/agentic/ucp-shopping-profile.ts`) | The one configured agentic merchant (Ogabassey) | unknown | unknown | unknown | unknown | unknown | Nigeria, NGN | Not decided; used and refurbished goods must not be marked eligible (roadmap Task 8) | The same bearer and HMAC scheme as ACP; Google enrollment and merchant account linking are roadmap Task 11 | ogabasseyy; roadmap Task 11 |
| Paystack-hosted Google Pay | Google Pay through Paystack | Handler `com.google.pay`, versioned `2026-04-08`, built at lines 102 to 119 of `apps/web/src/lib/agentic/ucp-discovery-profile.ts` | The one configured agentic merchant (Ogabassey) | unknown | unknown | unknown | unknown | unknown | Nigeria, NGN | None established: once its Paystack gateway configuration is set the profile lists Google Pay, but completion creates a Paystack dedicated virtual account instead of charging the Google Pay token (`apps/web/src/lib/agentic/agent-commerce-manifest.ts`) | Paystack gateway merchant id and Google merchant id from environment configuration; no token-charging path | ogabasseyy; roadmap Task 13 |
| First-party storefront chat | none (Baci storefront chat) | none (first-party HTTP API) | Ogabassey (tenant echoed by `apps/web/src/app/api/chat/chat-tenant.ts`) | unknown | unknown | unknown | unknown | not applicable | Nigeria, NGN (Ogabassey storefront); other currencies unverified | Ogabassey products from the chat's own projection of `products` and `get_storefront_product_variants` (`apps/web/src/app/api/chat/fast-catalog-data.ts`); price, offer and stock parity with UCP and ACP is unverified (F30) | Anonymous storefront visitors with IP rate limiting (`apps/web/src/app/api/chat/route.ts`); the chat can cancel an unpaid, unfulfilled order given its order reference and the customer's email (`apps/web/src/ai/chat-order-cancellation.ts`) | ogabasseyy; roadmap Task 7 |
| Multi-merchant onboarding | none yet | none (applies to ACP, UCP and MCP) | One merchant: `apps/web/src/lib/agentic/agentic-merchant-slug.ts` reads a single configured slug and `apps/web/src/lib/agentic/agent-commerce-manifest.ts` enables signed reads only for it | unknown | unknown | unknown | unknown | unknown | Nigeria, NGN only so far | None beyond the configured merchant | One shared agentic API key and signing key; no partner-scoped credentials (roadmap Task 5) | ogabasseyy; roadmap Task 5 |
MD
python3 - <<'PY'
import os, pathlib
path = pathlib.Path("docs/product/agent-access-map.md")
section = pathlib.Path(os.environ["WORK"], "surface-evidence-section.md").read_text()
marker = "## Next connector implementation slice (planned, not shipped here)"
text = path.read_text()
assert text.count(marker) == 1 and "## Agent surface evidence" not in text
path.write_text(text.replace(marker, section + marker, 1))
PY
git diff --stat
```

Expected: `docs/product/agent-access-map.md` with about 20 insertions. The section sits after the actual-surfaces table and its two follow-on paragraphs; the connector row that the access-map checker reads stays above it.

- [ ] **Step 5: Settle the two Production cells from the baseline**

`Google UCP cart` and `Google UCP native checkout` take their Production cell from the tooling summary in the Task 1 evidence file. A reachable profile proves discovery only, so the cell becomes `fail` when a probe returned a non-200 status, or when both returned 200 but the profile does not declare the capability; otherwise (including when Task 1 was not run, or a probe was unavailable) it stays `unknown`. This plan never writes `pass` here.

````bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
cat > "$WORK/prodcells.py" <<'PY'
import pathlib
import re

evidence = pathlib.Path("docs/superpowers/evidence/agentic/2026-10-31-baseline.md").read_text()
block = re.search(r"## Summary for tooling\s+```text\n(.*?)```", evidence, re.S)
assert block, "baseline evidence has no tooling summary"
summary = dict(re.findall(r"^(\w+)=(\S+)$", block.group(1), re.M))
probed = re.search(r"Probed at (\d{4}-\d{2}-\d{2})T", evidence)
link = "[production baseline](../superpowers/evidence/agentic/2026-10-31-baseline.md)"


def production_cell(declared_key):
    # Reaching the profile proves discovery only, so a reachable profile that
    # declares the capability stays unknown. Only a failure is recorded.
    if not probed:
        return "unknown"
    statuses = [summary["plain_status"], summary["browser_status"]]
    failed = any(s.isdigit() and s != "200" for s in statuses) or (
        statuses == ["200", "200"] and summary[declared_key] == "false"
    )
    return f"fail {probed.group(1)} {link}" if failed else "unknown"


cells = {
    "Google UCP cart": production_cell("cart_declared"),
    "Google UCP native checkout": production_cell("checkout_declared"),
}
map_path = pathlib.Path("docs/product/agent-access-map.md")
lines = map_path.read_text().split("\n")
for index, line in enumerate(lines):
    if line.startswith("| "):
        parts = line[2:-2].split(" | ")
        if parts[0] in cells:
            parts[7] = cells[parts[0]]
            lines[index] = "| " + " | ".join(parts) + " |"
map_path.write_text("\n".join(lines))
for name, cell in cells.items():
    print(f"{name}: Production = {cell}")
PY
python3 "$WORK/prodcells.py"
````

Expected: two lines, `Google UCP cart: Production = …` and `Google UCP native checkout: Production = …`, each either `unknown` or `fail <probe date> [production baseline](../superpowers/evidence/agentic/2026-10-31-baseline.md)`.

- [ ] **Step 6: Run the repository test and the access-map checks**

The Python checks need the new files visible to `git ls-files`, so stage them first.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
git add apps/web/src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts docs/product/agent-access-map.md
(cd apps/web && npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/evidence --testTimeout=120000)
(cd vps-workers/baci-editorial-context && python3 -m unittest test_capability_agent_access_map)
```

Expected: vitest reports `Test Files  2 passed (2)` and `Tests  44 passed (44)`; the Python run ends with `Ran 9 tests` and `OK`. A failure naming a path means a backticked path or link in the section does not exist; fix the section.

- [ ] **Step 7: Commit**

The capability gate is expected to be red on this checkpoint (the map changed and the register has not been re-reviewed); Task 8 turns it green.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/evidence/agent-surface-evidence.repository.test.ts docs/product/agent-access-map.md
git status --short
LEFTHOOK_EXCLUDE=knip git commit -m "docs(capabilities): add the agent surface evidence table" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Vendored UCP `2026-04-08` schemas and an offline validator

**Files:**
- Create: `apps/web/src/lib/agentic/fixtures/ucp-2026-04-08/` (61 schema files, `LICENSE`, `SOURCE.md`, `manifest.json`)
- Create: `apps/web/src/lib/agentic/fixtures/ucp-schema-validator.ts`
- Create: `apps/web/src/lib/agentic/fixtures/ucp-schema-samples.ts`
- Test: `apps/web/src/lib/agentic/fixtures/ucp-schema-validator.test.ts`

The schemas come from `Universal-Commerce-Protocol/ucp` at commit `9c9d6fce39ffa8bf7cb66309c378b79fb75b5382`, pinned by commit and not by tag because the `v2026-04-08` tag was re-cut on 22 October 2026. The six roots are `discovery/profile_schema.json`, `schemas/ucp.json` and `schemas/shopping/{catalog_search,catalog_lookup,cart,order}.json`; following every relative `$ref` from them reaches 61 files, listed in Step 3 and in `SOURCE.md`. The schemas declare draft 2020-12, so the validator uses Ajv's `ajv/dist/2020` entry with `ajv-formats`, and never touches the network. Their only custom keyword is `ucp_request` (per-operation request presence), plus a root `name` on capability schemas; both are annotations, and the validator checks response payloads, where the schema is read as written.

- [ ] **Step 1: Write the sample payloads and the failing test**

Create `apps/web/src/lib/agentic/fixtures/ucp-schema-samples.ts` with exactly:

```ts
const VERSION = '2026-04-08';

const SUCCESS_TOTALS = [
  { amount: 7996, display_text: 'Subtotal', type: 'subtotal' },
  { amount: 7996, display_text: 'Total', type: 'total' },
];

function ucpEnvelope(capability: string) {
  return {
    capabilities: { [capability]: [{ version: VERSION }] },
    status: 'success',
    version: VERSION,
  };
}

function lineItemItem(price: number | null) {
  return {
    id: 'variant_1',
    ...(price === null ? {} : { price }),
    title: 'Example phone',
  };
}

const PRODUCT = {
  description: { plain: 'An example phone' },
  id: 'product_1',
  price_range: {
    max: { amount: 3998, currency: 'NGN' },
    min: { amount: 3998, currency: 'NGN' },
  },
  title: 'Example phone',
  variants: [
    {
      availability: { available: true },
      description: { plain: 'An example phone' },
      id: 'variant_1',
      inputs: [{ id: 'product_1', match: 'featured' }],
      price: { amount: 3998, currency: 'NGN' },
      title: 'Example phone',
    },
  ],
};

export const VALID_UCP_BUSINESS_PROFILE = {
  signing_keys: [],
  ucp: {
    capabilities: {
      'dev.ucp.shopping.cart': [
        {
          schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json',
          spec: 'https://ucp.dev/2026-04-08/specification/cart',
          version: VERSION,
        },
      ],
    },
    payment_handlers: {
      'com.example.bank_transfer': [
        {
          available_instruments: [{ type: 'bank_transfer' }],
          id: 'bank_transfer',
          spec: 'https://example.com/docs/bank-transfer',
          version: VERSION,
        },
      ],
    },
    services: {
      'dev.ucp.shopping': [
        {
          endpoint: 'https://shop.example.com/api/agentic',
          schema:
            'https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json',
          spec: 'https://ucp.dev/2026-04-08/specification/overview',
          transport: 'rest',
          version: VERSION,
        },
      ],
    },
    version: VERSION,
  },
};

export const INVALID_UCP_BUSINESS_PROFILE = {
  ...VALID_UCP_BUSINESS_PROFILE,
  ucp: {
    ...VALID_UCP_BUSINESS_PROFILE.ucp,
    payment_handlers: undefined,
    version: 'April 2026',
  },
};

export const VALID_UCP_SEARCH_RESPONSE = {
  pagination: { has_next_page: false },
  products: [PRODUCT],
  ucp: ucpEnvelope('dev.ucp.shopping.catalog.search'),
};

export const INVALID_UCP_SEARCH_RESPONSE = {
  ...VALID_UCP_SEARCH_RESPONSE,
  products: [
    {
      ...PRODUCT,
      price_range: {
        max: { amount: 39.98, currency: 'NGN' },
        min: { amount: 39.98, currency: 'NGN' },
      },
    },
  ],
};

export const VALID_UCP_LOOKUP_RESPONSE = {
  products: [PRODUCT],
  ucp: ucpEnvelope('dev.ucp.shopping.catalog.lookup'),
};

export const INVALID_UCP_LOOKUP_RESPONSE = {
  ...VALID_UCP_LOOKUP_RESPONSE,
  products: [
    {
      ...PRODUCT,
      variants: [{ ...PRODUCT.variants[0], inputs: undefined }],
    },
  ],
};

function buildUcpCart(itemPrice: number | null) {
  return {
    currency: 'NGN',
    id: 'cart_1',
    line_items: [
      {
        id: 'line_1',
        item: lineItemItem(itemPrice),
        quantity: 2,
        totals: SUCCESS_TOTALS,
      },
    ],
    totals: SUCCESS_TOTALS,
    ucp: ucpEnvelope('dev.ucp.shopping.cart'),
  };
}

export const VALID_UCP_CART = buildUcpCart(3998);

export const INVALID_UCP_CART = buildUcpCart(null);

export const VALID_UCP_ORDER = {
  checkout_id: 'checkout_1',
  currency: 'NGN',
  fulfillment: { events: [], expectations: [] },
  id: 'order_1',
  line_items: [
    {
      id: 'line_1',
      item: lineItemItem(3998),
      quantity: { fulfilled: 0, total: 2 },
      status: 'processing',
      totals: [{ amount: 7996, display_text: 'Total', type: 'total' }],
    },
  ],
  permalink_url: 'https://shop.example.com/orders/order_1',
  totals: SUCCESS_TOTALS,
  ucp: ucpEnvelope('dev.ucp.shopping.order'),
};

export const INVALID_UCP_ORDER = {
  ...VALID_UCP_ORDER,
  totals: [SUCCESS_TOTALS[0]],
};

export const VALID_UCP_RESPONSE_METADATA = ucpEnvelope('dev.ucp.shopping.cart');

export const INVALID_UCP_RESPONSE_METADATA = {
  status: 'ok',
  version: 'April 2026',
};

export const VALID_UCP_PLATFORM_CAPABILITY = {
  schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json',
  spec: 'https://ucp.dev/2026-04-08/specification/cart',
  version: VERSION,
};

export const INVALID_UCP_PLATFORM_CAPABILITY = { version: VERSION };
```

Create `apps/web/src/lib/agentic/fixtures/ucp-schema-validator.test.ts` with exactly:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INVALID_UCP_BUSINESS_PROFILE,
  INVALID_UCP_CART,
  INVALID_UCP_LOOKUP_RESPONSE,
  INVALID_UCP_ORDER,
  INVALID_UCP_PLATFORM_CAPABILITY,
  INVALID_UCP_RESPONSE_METADATA,
  INVALID_UCP_SEARCH_RESPONSE,
  VALID_UCP_BUSINESS_PROFILE,
  VALID_UCP_CART,
  VALID_UCP_LOOKUP_RESPONSE,
  VALID_UCP_ORDER,
  VALID_UCP_PLATFORM_CAPABILITY,
  VALID_UCP_RESPONSE_METADATA,
  VALID_UCP_SEARCH_RESPONSE,
} from './ucp-schema-samples';
import {
  canonicalJsonSha256,
  listUcpSchemaFiles,
  readUcpSchemaFile,
  relativeSchemaRefs,
  UCP_FIXTURE_DIR,
  UCP_ROOT_SCHEMA_FILES,
  UCP_SCHEMAS,
  type UcpSchemaRef,
  validateUcpDocument,
} from './ucp-schema-validator';

const PINNED_COMMIT = '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382';

function readManifest(): { commit: string; files: Record<string, string> } {
  return JSON.parse(
    readFileSync(join(UCP_FIXTURE_DIR, 'manifest.json'), 'utf8')
  );
}

describe('vendored UCP 2026-04-08 schemas', () => {
  it('match the manifest hashes regardless of formatting', () => {
    const { files } = readManifest();

    const actual = Object.fromEntries(
      Object.keys(files).map((file) => [
        file,
        canonicalJsonSha256(readFileSync(join(UCP_FIXTURE_DIR, file))),
      ])
    );

    expect(actual).toEqual(files);
  });

  it('hash the parsed JSON, so whitespace changes are ignored', () => {
    expect(canonicalJsonSha256('{"a": [1,\n 2]}')).toBe(
      canonicalJsonSha256('{"a":[1,2]}')
    );
    expect(canonicalJsonSha256('{"a":[1,2]}')).not.toBe(
      canonicalJsonSha256('{"a":[1,3]}')
    );
  });

  it('list exactly the files in the manifest', () => {
    expect(listUcpSchemaFiles()).toEqual(Object.keys(readManifest().files));
  });

  it('contain every file the root schemas reference', () => {
    const vendored = new Set(listUcpSchemaFiles());
    const reached = new Set<string>();
    const queue: string[] = [...UCP_ROOT_SCHEMA_FILES];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      expect(vendored.has(file), `${file} is not vendored`).toBe(true);
      queue.push(...relativeSchemaRefs(file, readUcpSchemaFile(file)));
    }

    expect([...reached].sort()).toEqual([...vendored]);
  });

  it('pin the upstream commit and keep the Apache-2.0 licence', () => {
    expect(readManifest().commit).toBe(PINNED_COMMIT);
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'SOURCE.md'), 'utf8')).toContain(
      PINNED_COMMIT
    );
    expect(readFileSync(join(UCP_FIXTURE_DIR, 'LICENSE'), 'utf8')).toContain(
      'Apache License'
    );
  });
});

describe('validateUcpDocument', () => {
  const samples: Array<{
    invalid: unknown;
    invalidError: string;
    name: string;
    ref: UcpSchemaRef;
    valid: unknown;
  }> = [
    {
      invalid: INVALID_UCP_BUSINESS_PROFILE,
      invalidError: "must have required property 'payment_handlers'",
      name: 'discovery profile (profile_schema.json)',
      ref: UCP_SCHEMAS.businessProfile,
      valid: VALID_UCP_BUSINESS_PROFILE,
    },
    {
      invalid: INVALID_UCP_RESPONSE_METADATA,
      invalidError: 'must match pattern',
      name: 'response metadata (ucp.json)',
      ref: UCP_SCHEMAS.responseCartMetadata,
      valid: VALID_UCP_RESPONSE_METADATA,
    },
    {
      invalid: INVALID_UCP_PLATFORM_CAPABILITY,
      invalidError: "must have required property 'schema'",
      name: 'platform capability (capability.json)',
      ref: UCP_SCHEMAS.platformCapability,
      valid: VALID_UCP_PLATFORM_CAPABILITY,
    },
    {
      invalid: INVALID_UCP_SEARCH_RESPONSE,
      invalidError: 'must be integer',
      name: 'catalog search response (catalog_search.json)',
      ref: UCP_SCHEMAS.catalogSearchResponse,
      valid: VALID_UCP_SEARCH_RESPONSE,
    },
    {
      invalid: INVALID_UCP_LOOKUP_RESPONSE,
      invalidError: "must have required property 'inputs'",
      name: 'catalog lookup response (catalog_lookup.json)',
      ref: UCP_SCHEMAS.catalogLookupResponse,
      valid: VALID_UCP_LOOKUP_RESPONSE,
    },
    {
      invalid: INVALID_UCP_CART,
      invalidError: "must have required property 'price'",
      name: 'cart (cart.json)',
      ref: UCP_SCHEMAS.cart,
      valid: VALID_UCP_CART,
    },
    {
      invalid: INVALID_UCP_ORDER,
      invalidError: 'must contain at least 1 and no more than 1 valid item(s)',
      name: 'order (order.json)',
      ref: UCP_SCHEMAS.order,
      valid: VALID_UCP_ORDER,
    },
  ];

  it.each(samples)('accepts a valid $name sample', ({ ref, valid }) => {
    expect(validateUcpDocument(ref, valid)).toEqual({
      errors: [],
      valid: true,
    });
  });

  it.each(samples)('rejects an invalid $name sample', ({
    invalid,
    invalidError,
    ref,
  }) => {
    const result = validateUcpDocument(ref, invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(invalidError);
  });

  it('ignores the request-side ucp_request annotation on responses', () => {
    const { errors } = validateUcpDocument(UCP_SCHEMAS.cart, VALID_UCP_CART);

    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/fixtures/ucp-schema-validator.test.ts --testTimeout=120000
```

Expected: FAIL for the whole file with `Error: Cannot find module './ucp-schema-validator' imported from …/ucp-schema-validator.test.ts`, `Test Files  1 failed (1)` and `Tests  no tests`.

- [ ] **Step 3: Fetch the pinned files**

The URLs name the commit, so every download is the same bytes today and later. `curl -f` stops on any HTTP error.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web/src/lib/agentic/fixtures
mkdir -p ucp-2026-04-08
BASE=https://raw.githubusercontent.com/Universal-Commerce-Protocol/ucp/9c9d6fce39ffa8bf7cb66309c378b79fb75b5382
while read -r file; do
  mkdir -p "ucp-2026-04-08/$(dirname "$file")"
  curl -fsS --retry 2 -o "ucp-2026-04-08/$file" "$BASE/source/$file"
done <<'FILES'
discovery/profile_schema.json
schemas/capability.json
schemas/payment_handler.json
schemas/service.json
schemas/shopping/cart.json
schemas/shopping/catalog_lookup.json
schemas/shopping/catalog_search.json
schemas/shopping/checkout.json
schemas/shopping/order.json
schemas/shopping/payment.json
schemas/shopping/types/adjustment.json
schemas/shopping/types/amount.json
schemas/shopping/types/attribution.json
schemas/shopping/types/available_payment_instrument.json
schemas/shopping/types/buyer.json
schemas/shopping/types/category.json
schemas/shopping/types/context.json
schemas/shopping/types/description.json
schemas/shopping/types/detail_option_value.json
schemas/shopping/types/error_code.json
schemas/shopping/types/expectation.json
schemas/shopping/types/fulfillment_event.json
schemas/shopping/types/info_code.json
schemas/shopping/types/input_correlation.json
schemas/shopping/types/item.json
schemas/shopping/types/line_item.json
schemas/shopping/types/link.json
schemas/shopping/types/media.json
schemas/shopping/types/media_external_video.json
schemas/shopping/types/media_image.json
schemas/shopping/types/media_model_3d.json
schemas/shopping/types/media_source.json
schemas/shopping/types/media_video.json
schemas/shopping/types/message.json
schemas/shopping/types/message_error.json
schemas/shopping/types/message_info.json
schemas/shopping/types/message_warning.json
schemas/shopping/types/option_value.json
schemas/shopping/types/order_confirmation.json
schemas/shopping/types/order_line_item.json
schemas/shopping/types/pagination.json
schemas/shopping/types/payment_credential.json
schemas/shopping/types/payment_instrument.json
schemas/shopping/types/postal_address.json
schemas/shopping/types/price.json
schemas/shopping/types/price_filter.json
schemas/shopping/types/price_range.json
schemas/shopping/types/product.json
schemas/shopping/types/product_option.json
schemas/shopping/types/rating.json
schemas/shopping/types/reverse_domain_name.json
schemas/shopping/types/search_filters.json
schemas/shopping/types/selected_option.json
schemas/shopping/types/signals.json
schemas/shopping/types/signed_amount.json
schemas/shopping/types/total.json
schemas/shopping/types/totals.json
schemas/shopping/types/variant.json
schemas/shopping/types/warning_code.json
schemas/transports/embedded_config.json
schemas/ucp.json
FILES
curl -fsS --retry 2 -o ucp-2026-04-08/LICENSE "$BASE/LICENSE"
find ucp-2026-04-08 -name '*.json' | wc -l
shasum -a 256 ucp-2026-04-08/LICENSE
```

Expected: `61` and `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  ucp-2026-04-08/LICENSE`.

- [ ] **Step 4: Generate the manifest from the raw downloads**

Do this before Biome touches anything, so the hashes describe what upstream published. Each hash is `sha256(JSON.stringify(JSON.parse(bytes)))`, which is the same for any whitespace.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web/src/lib/agentic/fixtures
node --input-type=module -e "
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
const root = 'ucp-2026-04-08';
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = {};
for (const p of walk(root).filter((f) => f.endsWith('.json') && relative(root, f) !== 'manifest.json').sort()) {
  files[relative(root, p)] = createHash('sha256').update(JSON.stringify(JSON.parse(readFileSync(p, 'utf8')))).digest('hex');
}
const manifest = { repository: 'Universal-Commerce-Protocol/ucp', commit: '9c9d6fce39ffa8bf7cb66309c378b79fb75b5382', hash: 'sha256 of JSON.stringify(JSON.parse(file bytes)); stable under reformatting', files };
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(Object.keys(files).length);
"
grep '"discovery/profile_schema.json"' ucp-2026-04-08/manifest.json
```

Expected: `61`, then `    "discovery/profile_schema.json": "708f8313ed704e783136ca70532b25c6074a57b9269a39e6fd99d68498902002",`.

- [ ] **Step 5: Let Biome format the vendored files**

Upstream writes short objects on one line, which Biome expands. The repository's lint script is `biome check .`, so the committed files must be Biome-clean.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
npm_config_verify_deps_before_run=false pnpm exec biome check --write apps/web/src/lib/agentic/fixtures/ucp-2026-04-08
npm_config_verify_deps_before_run=false pnpm exec biome check apps/web/src/lib/agentic/fixtures/ucp-2026-04-08
```

Expected: the first run ends with `Checked 62 files in …` and `Fixed 33 files` (a different positive count is fine if your Biome version formats slightly differently); the second reports `No fixes applied` and no errors. The manifest does not change, because it hashes parsed content.

- [ ] **Step 6: Write the source note**

Create `apps/web/src/lib/agentic/fixtures/ucp-2026-04-08/SOURCE.md` with exactly:

```markdown
# UCP 2026-04-08 JSON Schemas

Vendored copies of the Universal Commerce Protocol JSON Schemas that Baci's
offline conformance tests validate against. They are Apache-2.0 licensed; the
upstream licence is in `LICENSE`.

| | |
| --- | --- |
| Repository | https://github.com/Universal-Commerce-Protocol/ucp |
| Commit | `9c9d6fce39ffa8bf7cb66309c378b79fb75b5382` |
| Branch | `release/2026-04-08` (its head when retrieved; committed 22 October 2026) |
| Upstream directory | `source/` (paths below are relative to it) |
| Retrieved | 31 October 2026 |
| Licence | Apache-2.0 |

## Why a commit and not a tag

The `v2026-04-08` tag was re-cut on 22 October 2026. A tag can move again, so
this directory pins the commit. To update it, choose a new commit on purpose,
re-fetch every file below, regenerate `manifest.json` from the unformatted
downloads, and rerun the tests.

## Integrity

`manifest.json` holds the SHA-256 of `JSON.stringify(JSON.parse(bytes))` for
each file. Biome formats these JSON files, so their whitespace differs from
upstream, but the parsed content and therefore the hash do not. The tests in
`ucp-schema-validator.test.ts` check every hash, that no schema file is missing
or extra, and that every relative `$ref` reachable from the six root schemas
resolves to a file in this directory.

## Roots

- `discovery/profile_schema.json`
- `schemas/ucp.json`
- `schemas/shopping/catalog_search.json`
- `schemas/shopping/catalog_lookup.json`
- `schemas/shopping/cart.json`
- `schemas/shopping/order.json`

The catalog roots hold their request and response schemas under `$defs`;
callers validate against `#/$defs/search_response` and
`#/$defs/lookup_response`.

## How the validator uses them

`ucp-schema-validator.ts` loads these files only; it never fetches anything. It
registers each schema under its `$id` and makes two adaptations in code, not in
the files:

- The discovery profile declares an `$id` one directory deeper than its own
  `$ref` paths assume, so it is registered under a matching base URI.
- `ucp_request` (per-operation request presence rules) and the capability
  schemas' root `name` are accepted as annotations and ignored, because the
  validator checks response payloads only.

## Files (61)

- `discovery/profile_schema.json`
- `schemas/capability.json`
- `schemas/payment_handler.json`
- `schemas/service.json`
- `schemas/shopping/cart.json`
- `schemas/shopping/catalog_lookup.json`
- `schemas/shopping/catalog_search.json`
- `schemas/shopping/checkout.json`
- `schemas/shopping/order.json`
- `schemas/shopping/payment.json`
- `schemas/shopping/types/adjustment.json`
- `schemas/shopping/types/amount.json`
- `schemas/shopping/types/attribution.json`
- `schemas/shopping/types/available_payment_instrument.json`
- `schemas/shopping/types/buyer.json`
- `schemas/shopping/types/category.json`
- `schemas/shopping/types/context.json`
- `schemas/shopping/types/description.json`
- `schemas/shopping/types/detail_option_value.json`
- `schemas/shopping/types/error_code.json`
- `schemas/shopping/types/expectation.json`
- `schemas/shopping/types/fulfillment_event.json`
- `schemas/shopping/types/info_code.json`
- `schemas/shopping/types/input_correlation.json`
- `schemas/shopping/types/item.json`
- `schemas/shopping/types/line_item.json`
- `schemas/shopping/types/link.json`
- `schemas/shopping/types/media.json`
- `schemas/shopping/types/media_external_video.json`
- `schemas/shopping/types/media_image.json`
- `schemas/shopping/types/media_model_3d.json`
- `schemas/shopping/types/media_source.json`
- `schemas/shopping/types/media_video.json`
- `schemas/shopping/types/message.json`
- `schemas/shopping/types/message_error.json`
- `schemas/shopping/types/message_info.json`
- `schemas/shopping/types/message_warning.json`
- `schemas/shopping/types/option_value.json`
- `schemas/shopping/types/order_confirmation.json`
- `schemas/shopping/types/order_line_item.json`
- `schemas/shopping/types/pagination.json`
- `schemas/shopping/types/payment_credential.json`
- `schemas/shopping/types/payment_instrument.json`
- `schemas/shopping/types/postal_address.json`
- `schemas/shopping/types/price.json`
- `schemas/shopping/types/price_filter.json`
- `schemas/shopping/types/price_range.json`
- `schemas/shopping/types/product.json`
- `schemas/shopping/types/product_option.json`
- `schemas/shopping/types/rating.json`
- `schemas/shopping/types/reverse_domain_name.json`
- `schemas/shopping/types/search_filters.json`
- `schemas/shopping/types/selected_option.json`
- `schemas/shopping/types/signals.json`
- `schemas/shopping/types/signed_amount.json`
- `schemas/shopping/types/total.json`
- `schemas/shopping/types/totals.json`
- `schemas/shopping/types/variant.json`
- `schemas/shopping/types/warning_code.json`
- `schemas/transports/embedded_config.json`
- `schemas/ucp.json`
```

- [ ] **Step 7: Write the validator**

Create `apps/web/src/lib/agentic/fixtures/ucp-schema-validator.ts` with exactly:

```ts
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export const UCP_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'ucp-2026-04-08'
);

/** Schema files the closure check starts from (paths inside UCP_FIXTURE_DIR). */
export const UCP_ROOT_SCHEMA_FILES = [
  'discovery/profile_schema.json',
  'schemas/ucp.json',
  'schemas/shopping/catalog_search.json',
  'schemas/shopping/catalog_lookup.json',
  'schemas/shopping/cart.json',
  'schemas/shopping/order.json',
] as const;

// The schemas' $id values are identifiers, not downloadable pages (the
// unversioned URLs return 404), so only the origin appears as a literal.
const ID_ORIGIN = 'https://ucp.dev';

/** Schema references a caller can validate a payload against. */
export const UCP_SCHEMAS = {
  businessProfile: `${ID_ORIGIN}/discovery/profile.json`,
  cart: `${ID_ORIGIN}/schemas/shopping/cart.json`,
  catalogLookupResponse: `${ID_ORIGIN}/schemas/shopping/catalog_lookup.json#/$defs/lookup_response`,
  catalogSearchResponse: `${ID_ORIGIN}/schemas/shopping/catalog_search.json#/$defs/search_response`,
  order: `${ID_ORIGIN}/schemas/shopping/order.json`,
  platformCapability: `${ID_ORIGIN}/schemas/capability.json#/$defs/platform_schema`,
  responseCartMetadata: `${ID_ORIGIN}/schemas/ucp.json#/$defs/response_cart_schema`,
} as const;

export type UcpSchemaRef = (typeof UCP_SCHEMAS)[keyof typeof UCP_SCHEMAS];

interface UcpValidationResult {
  readonly errors: string[];
  readonly valid: boolean;
}

const PROFILE_FILE = 'discovery/profile_schema.json';
// Upstream declares this schema's $id as .../schemas/discovery/profile.json
// while its own $refs ("../schemas/ucp.json") assume it sits one level higher.
// Registering it under the matching base keeps every reference local.
const PROFILE_BASE_URI = `${ID_ORIGIN}/discovery/profile.json`;

export function listUcpSchemaFiles(): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.json') ? [path] : [];
    });
  return ['discovery', 'schemas']
    .flatMap((folder) => walk(join(UCP_FIXTURE_DIR, folder)))
    .map((path) => relative(UCP_FIXTURE_DIR, path).split('\\').join('/'))
    .sort();
}

export function readUcpSchemaFile(file: string): unknown {
  return JSON.parse(readFileSync(join(UCP_FIXTURE_DIR, file), 'utf8'));
}

/** Hash of the parsed JSON, so reformatting a vendored file cannot change it. */
export function canonicalJsonSha256(bytes: Buffer | string): string {
  return createHash('sha256')
    .update(JSON.stringify(JSON.parse(bytes.toString())))
    .digest('hex');
}

/** Files a schema references through relative $ref values (fragments dropped). */
export function relativeSchemaRefs(file: string, schema: unknown): string[] {
  const refs = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const [target] = value.split('#');
        if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          refs.add(posix.normalize(posix.join(posix.dirname(file), target)));
        }
      } else {
        visit(value);
      }
    }
  };
  visit(schema);
  return [...refs].sort();
}

function createAjv(): Ajv2020 {
  // UCP schemas use `required` without `properties` in allOf branches and
  // `properties` without `type` in conditional branches. Both are legal, so
  // the strictRequired and strictTypes lints are off; unknown keywords still
  // fail, apart from the two annotations registered below.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
  });
  addFormats(ajv);
  // `ucp_request` marks per-operation request presence ("omit", "optional",
  // "required", or {create, update, complete}). This validator checks RESPONSE
  // payloads, where the schema is read as written and the annotation does not
  // apply. A request validator must resolve it per operation first.
  ajv.addKeyword({ keyword: 'ucp_request' });
  // Capability schemas carry their reverse-domain name in a root `name`.
  ajv.addKeyword({ keyword: 'name' });
  for (const file of listUcpSchemaFiles()) {
    const schema = readUcpSchemaFile(file) as Record<string, unknown>;
    ajv.addSchema(
      file === PROFILE_FILE ? { ...schema, $id: PROFILE_BASE_URI } : schema
    );
  }
  return ajv;
}

let sharedAjv: Ajv2020 | undefined;

function describeError(error: ErrorObject): string {
  return `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`;
}

/** Validates a UCP response payload against a vendored 2026-04-08 schema. */
export function validateUcpDocument(
  schemaRef: UcpSchemaRef,
  document: unknown
): UcpValidationResult {
  sharedAjv ??= createAjv();
  const validate = sharedAjv.getSchema(schemaRef);
  if (!validate) {
    throw new Error(`Unknown UCP schema reference: ${schemaRef}`);
  }
  const valid = validate(document) as boolean;
  return {
    errors: valid ? [] : (validate.errors ?? []).map(describeError),
    valid,
  };
}
```

- [ ] **Step 8: Run the test**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/fixtures/ucp-schema-validator.test.ts --testTimeout=120000
```

Expected: `Test Files  1 passed (1)` and `Tests  20 passed (20)`: five manifest and closure checks, then a valid and an invalid sample for each of the seven schemas, plus the annotation check.

- [ ] **Step 9: Format**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
npm_config_verify_deps_before_run=false pnpm exec biome check --write apps/web/src/lib/agentic/fixtures
```

Expected: no errors. The main TypeScript project covers these files; Task 8 runs it once.

- [ ] **Step 10: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/fixtures/ucp-2026-04-08 apps/web/src/lib/agentic/fixtures/ucp-schema-samples.ts apps/web/src/lib/agentic/fixtures/ucp-schema-validator.ts apps/web/src/lib/agentic/fixtures/ucp-schema-validator.test.ts
git status --short | grep -v '^A ' | grep -v '^$'
LEFTHOOK_EXCLUDE=knip git commit -m "test(agentic): vendor the UCP 2026-04-08 schemas and an offline validator" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `git status` filter prints nothing (every changed path is staged). If CodeRabbit is unavailable, skip it and say so.

---

### Task 5: Conformance baseline for Baci's UCP builders

**Files:**
- Create: `apps/web/src/lib/agentic/test-support/stub-agentic-env.ts`
- Create: `apps/web/src/lib/agentic/fixtures/ucp-conformance-inputs.ts`
- Test: `apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts`

This feeds the real builders through the Task 4 validator, using a product priced N39.98 (3998 minor units) so unit bugs show: `buildUcpDiscoveryProfile(buildAgentCommerceManifest(…))` for `/.well-known/ucp`, `mapUcpCatalogProductRow` and `buildUcpCatalogProductsResponse` for catalog search and lookup, `buildUcpCartResponse` for carts and `buildUcpOrderResponse` for orders. Tests that pass are plain `it`. Where Baci falls short today the test is `it.fails('<finding>: …')` with a comment naming the roadmap task that fixes it: it passes while the gap exists and starts failing the moment the fix lands, which tells the fixer to delete `.fails`. These are characterization tests: nothing is implemented in this task, so Step 2 shows the red state by running the seven known-gap tests as ordinary tests.

- [ ] **Step 1: Write the environment stub, the inputs and the test**

Create `apps/web/src/lib/agentic/test-support/stub-agentic-env.ts` with exactly:

```ts
import { vi } from 'vitest';

/**
 * Stubs the environment the agentic modules read, with a fake signing and
 * payment configuration. Callers reset modules first, import after stubbing,
 * and call `vi.unstubAllEnvs()` afterwards.
 */
export function stubAgenticEnv(merchantSlug = 'ogabassey') {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', merchantSlug);
  vi.stubEnv('OPENAI_AGENTIC_API_KEY', 'agent-api-key');
  vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', 'confirmation-key');
  vi.stubEnv('OPENAI_AGENTIC_SIGNING_KEY', 'signing-key');
  vi.stubEnv('SUPABASE_JWT_SECRET', 'supabase-jwt-secret');
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
}
```

Create `apps/web/src/lib/agentic/fixtures/ucp-conformance-inputs.ts` with exactly:

```ts
import type { buildAgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import { buildUcpCartResponse } from '@/lib/agentic/ucp-cart-response';
import {
  buildUcpCatalogProductsResponse,
  mapUcpCatalogProductRow,
  UCP_CATALOG_SEARCH_CAPABILITY,
} from '@/lib/agentic/ucp-catalog-adapters';

// A price with kobo: N39.98 is 3998 minor units. Two of them cost 7996.
export const MAJOR_PRICE = 39.98;
export const UNIT_MINOR = 3998;
export const LINE_MINOR = 7996;

export type ManifestMerchant = Parameters<typeof buildAgentCommerceManifest>[0];

export const MERCHANT: ManifestMerchant = {
  business_name: 'Ogabassey',
  feature_settings: { pay_on_delivery_enabled: true },
  paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
  slug: 'ogabassey',
};

export async function buildProfile(merchant: ManifestMerchant = MERCHANT) {
  const { buildAgentCommerceManifest } = await import(
    '@/lib/agentic/agent-commerce-manifest'
  );
  const { buildUcpDiscoveryProfile } = await import(
    '@/lib/agentic/ucp-discovery-profile'
  );
  return buildUcpDiscoveryProfile(
    buildAgentCommerceManifest(merchant, 'https://ogabassey.com')
  );
}

const PRODUCT_ROW = {
  description: 'A phone priced with kobo',
  id: 'product-1',
  manage_stock: true,
  merchant_id: 'merchant-1',
  name: 'Kobo phone',
  price: MAJOR_PRICE,
  slug: 'kobo-phone',
  status: 'active',
  stock: 3,
};

export function searchResponse() {
  const product = mapUcpCatalogProductRow({
    baseUrl: 'https://ogabassey.com',
    currency: 'NGN',
    row: PRODUCT_ROW,
  });
  if (!product) throw new Error('Expected the product row to map');
  return {
    product,
    response: buildUcpCatalogProductsResponse({
      capability: UCP_CATALOG_SEARCH_CAPABILITY,
      products: [product],
    }),
  };
}

export function cartResponse() {
  return buildUcpCartResponse({
    cartId: 'cart_1',
    continueUrl: 'https://ogabassey.com/ogabassey/cart#handoff=example',
    currency: 'NGN',
    lineItems: [
      {
        base_amount: LINE_MINOR,
        discount: 0,
        id: 'line_1',
        item: {
          id: 'variant-1',
          product_id: 'product-1',
          quantity: 2,
          title: 'Kobo phone',
        },
        subtotal: LINE_MINOR,
        tax: 0,
        total: LINE_MINOR,
      },
    ],
    status: 'active',
    totals: [
      { amount: LINE_MINOR, display_text: 'Subtotal', type: 'subtotal' },
      { amount: LINE_MINOR, display_text: 'Total', type: 'total' },
    ],
  });
}

export function orderBody(shippingStatus: string) {
  return {
    checkout_id: 'agentic_session_1',
    currency: 'NGN',
    discount_amount: 0,
    id: 'order-1',
    links: { track_order: 'https://ogabassey.com/track-order' },
    order_items: [
      {
        id: 'order-item-1',
        line_extension_amount: 79.96,
        name: 'Kobo phone',
        price: MAJOR_PRICE,
        product_id: 'product-1',
        quantity: 2,
        variant_id: 'variant-1',
      },
    ],
    shipping_fee: 0,
    shipping_status: shippingStatus,
    subtotal: 79.96,
    tax_amount: 0,
    total: 79.96,
    updated_at: '2026-10-31T09:00:00.000Z',
  };
}
```

Create `apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts` with exactly:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUcpCatalogProductsResponse,
  mapStorefrontProductToUcpCatalogProduct,
  UCP_CATALOG_LOOKUP_CAPABILITY,
  UCP_CATALOG_SEARCH_CAPABILITY,
} from '@/lib/agentic/ucp-catalog-adapters';
import { buildUcpOrderResponse } from '@/lib/agentic/ucp-response-adapters';
import { stubAgenticEnv } from '../test-support/stub-agentic-env';
import {
  buildProfile,
  cartResponse,
  LINE_MINOR,
  MAJOR_PRICE,
  type ManifestMerchant,
  MERCHANT,
  orderBody,
  searchResponse,
  UNIT_MINOR,
} from './ucp-conformance-inputs';
import { UCP_SCHEMAS, validateUcpDocument } from './ucp-schema-validator';

describe('Baci UCP responses against the vendored 2026-04-08 schemas', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('business profile (/.well-known/ucp)', () => {
    it('validates against the discovery profile schema', async () => {
      const profile = await buildProfile();

      expect(validateUcpDocument(UCP_SCHEMAS.businessProfile, profile)).toEqual(
        { errors: [], valid: true }
      );
    });

    // Roadmap Task 3 (plan 3) adds the schema URL to the catalog and cart
    // declarations; this test then starts failing and `.fails` must go.
    it.fails('F7: every dev.ucp.shopping capability declares schema', async () => {
      const profile = await buildProfile();
      const shopping = Object.entries(profile.ucp.capabilities).filter(
        ([name]) => name.startsWith('dev.ucp.shopping.')
      );

      expect(shopping.map(([name]) => name).sort()).toEqual([
        'dev.ucp.shopping.cart',
        'dev.ucp.shopping.catalog.lookup',
        'dev.ucp.shopping.catalog.search',
        'dev.ucp.shopping.checkout',
        'dev.ucp.shopping.order',
      ]);
      const withoutSchema = shopping
        .filter(([, declarations]) =>
          declarations.some(
            (declaration) =>
              !validateUcpDocument(UCP_SCHEMAS.platformCapability, declaration)
                .valid
          )
        )
        .map(([name]) => name);

      expect(withoutSchema).toEqual([]);
    });

    // Roadmap Task 3 (plan 3) withholds cart when shared_cart_enabled is off.
    it.fails('F34: the cart capability follows shared_cart_enabled', async () => {
      const profile = await buildProfile({
        ...MERCHANT,
        shared_cart_enabled: false,
      } as ManifestMerchant);

      expect(profile.ucp.capabilities['dev.ucp.shopping.cart']).toBeUndefined();
    });
  });

  describe('catalog search and lookup', () => {
    it('emits a structurally valid search response', () => {
      const { response } = searchResponse();

      expect(
        validateUcpDocument(UCP_SCHEMAS.catalogSearchResponse, response)
      ).toEqual({ errors: [], valid: true });
    });

    it('emits a structurally valid lookup response', () => {
      const { product } = searchResponse();
      const response = buildUcpCatalogProductsResponse({
        capability: UCP_CATALOG_LOOKUP_CAPABILITY,
        products: [product],
      });

      expect(
        validateUcpDocument(UCP_SCHEMAS.catalogLookupResponse, response)
      ).toEqual({ errors: [], valid: true });
    });

    // Roadmap Task 4 (plan 4). The row mapper rounds N39.98 to 40, which the
    // schema accepts as an integer, so only the value reveals the unit bug.
    it.fails('F1: a N39.98 row is priced 3998 minor units', () => {
      const { product } = searchResponse();

      expect(product.price_range.min.amount).toBe(UNIT_MINOR);
      expect(product.variants[0].price.amount).toBe(UNIT_MINOR);
    });

    // Roadmap Task 4 (plan 4). The unrounded mapper emits 39.98 as the amount,
    // which the schema rejects because amounts are integers.
    it.fails('F1: a decimal major-unit price is a valid minor-unit amount', () => {
      const product = mapStorefrontProductToUcpCatalogProduct({
        currency: 'NGN',
        id: 'product-1',
        in_stock: true,
        name: 'Kobo phone',
        price: MAJOR_PRICE,
        product_url: 'https://ogabassey.com/ogabassey/products/kobo-phone',
      });
      const response = buildUcpCatalogProductsResponse({
        capability: UCP_CATALOG_SEARCH_CAPABILITY,
        products: [product],
      });

      expect(
        validateUcpDocument(UCP_SCHEMAS.catalogSearchResponse, response).errors
      ).toEqual([]);
    });
  });

  describe('cart', () => {
    // Roadmap Task 4 (plan 4) adds item.price to every cart line.
    it.fails('F3: every cart line item carries item.price', () => {
      expect(
        validateUcpDocument(UCP_SCHEMAS.cart, cartResponse()).errors
      ).toEqual([]);
    });

    it('is otherwise valid once item.price is present', () => {
      const cart = cartResponse();
      const withPrice = {
        ...cart,
        line_items: cart.line_items.map((line) => ({
          ...line,
          item: { ...line.item, price: UNIT_MINOR },
        })),
      };

      expect(validateUcpDocument(UCP_SCHEMAS.cart, withPrice)).toEqual({
        errors: [],
        valid: true,
      });
    });
  });

  describe('order', () => {
    it('validates a delivered order', () => {
      const order = buildUcpOrderResponse(orderBody('delivered'));

      expect(validateUcpDocument(UCP_SCHEMAS.order, order)).toEqual({
        errors: [],
        valid: true,
      });
    });

    // Roadmap Task 4 (plan 4). The adapter rounds N79.96 to 80 without
    // multiplying by 100; the schema accepts any integer, so only the value
    // shows the unit bug.
    it.fails('F33: order totals and unit prices are minor units', () => {
      const order = buildUcpOrderResponse(orderBody('delivered')) as {
        line_items: Array<{ item: { price: number } }>;
        totals: Array<{ amount: number; type: string }>;
      };

      expect(order.line_items[0].item.price).toBe(UNIT_MINOR);
      expect(order.totals.find((t) => t.type === 'total')?.amount).toBe(
        LINE_MINOR
      );
    });

    // Proposed finding F42, roadmap Task 4 (plan 4). Orders start at the
    // default `pending` shipping status, and any status yields a fulfillment
    // event; with nothing shipped yet the event is for quantity 0, which the
    // schema rejects (quantity >= 1).
    it.fails('F42: a pending order has no zero-quantity fulfillment event', () => {
      const order = buildUcpOrderResponse(orderBody('pending'));

      expect(validateUcpDocument(UCP_SCHEMAS.order, order).errors).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: See the seven gaps fail as ordinary tests**

This copies the file with `it.fails(` rewritten to `it(`, runs it, and deletes the copy.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
sed 's/it\.fails(/it(/' src/lib/agentic/fixtures/ucp-conformance.test.ts > src/lib/agentic/fixtures/ucp-conformance-red.test.ts
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/fixtures/ucp-conformance-red.test.ts --testTimeout=120000
rm src/lib/agentic/fixtures/ucp-conformance-red.test.ts
```

Expected: `Tests  7 failed | 5 passed (12)`, with exactly these failures and reasons:

| Test | Why it fails today |
| --- | --- |
| `F7: every dev.ucp.shopping capability declares schema` | received `dev.ucp.shopping.catalog.search`, `dev.ucp.shopping.catalog.lookup` and `dev.ucp.shopping.cart` |
| `F34: the cart capability follows shared_cart_enabled` | the cart capability is still declared for a merchant whose `shared_cart_enabled` is false |
| `F1: a N39.98 row is priced 3998 minor units` | `expected 40 to be 3998` |
| `F1: a decimal major-unit price is a valid minor-unit amount` | three `… amount must be integer` errors under `/products/0` |
| `F3: every cart line item carries item.price` | `/line_items/0/item must have required property 'price'` |
| `F33: order totals and unit prices are minor units` | `expected 40 to be 3998` |
| `F42: a pending order has no zero-quantity fulfillment event` | `/fulfillment/events/0/line_items/0/quantity must be >= 1` |

- [ ] **Step 3: Run the real file**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/fixtures/ucp-conformance.test.ts --testTimeout=120000
```

Expected: `Test Files  1 passed (1)` and `Tests  5 passed | 7 expected fail (12)`.

- [ ] **Step 4: Format**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
npm_config_verify_deps_before_run=false pnpm exec biome check --write apps/web/src/lib/agentic/fixtures apps/web/src/lib/agentic/test-support
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/test-support/stub-agentic-env.ts apps/web/src/lib/agentic/fixtures/ucp-conformance-inputs.ts apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts
git status --short
LEFTHOOK_EXCLUDE=knip git commit -m "test(agentic): baseline UCP conformance with known-gap tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: MCP `2026-07-28` and ACP `2026-04-17` fixtures

**Files:**
- Create: `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/` (four JSON files and `SOURCE.md`)
- Test: `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts`
- Create: `apps/web/src/lib/agentic/fixtures/acp-2026-04-17/` (two JSON files and `SOURCE.md`)
- Test: `apps/web/src/lib/agentic/fixtures/acp-fixtures.test.ts`

Both sets are written by Baci from the specification, not copied: the MCP repository's licence is mixed, and the ACP examples are not needed. `SOURCE.md` in each folder cites the pins. MCP: tag `2026-07-28` at `5f5440bb26a62e2cf3440b92da5a667efa03b267` (tools page `https://modelcontextprotocol.io/specification/2026-07-28/server/tools`). ACP: release commit `9abf303f48088d170503a54502d612b8b1997897` of `agentic-commerce-protocol/agentic-commerce-protocol` (Apache-2.0), file `spec/2026-04-17/openapi/openapi.agentic_checkout.yaml`.

The MCP fixtures cover `tools/list` and `tools/call` for `search_ucp_catalog`: every request needs `params._meta` with `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`; a list result needs `resultType: "complete"`, `tools`, `ttlMs` and `cacheScope`; a call result needs `resultType` and `content`, with optional `structuredContent`. The ACP fixtures cover create-checkout-session: the request needs `line_items`, `currency` and `capabilities` and the headers `Idempotency-Key` and `API-Version`; the response is a `201` whose line items need `id`, `item.id`, `quantity` and `totals`, and whose totals need `type`, `display_text` and an integer `amount`. Two known gaps are pinned as `it.fails`: F40 (the server card says `2025-06-18`) and F41 (Baci advertises ACP `2026-04-30`, which has no release; the released versions are the spec directories `2025-09-29`, `2025-12-12`, `2026-01-16`, `2026-01-30` and `2026-04-17`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/agentic/fixtures/acp-fixtures.test.ts` with exactly:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAgenticEnv } from '../test-support/stub-agentic-env';

type JsonObject = Record<string, unknown>;

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'acp-2026-04-17'
);
// Spec directories published by the ACP repository at the pinned commit.
const RELEASED_ACP_VERSIONS = [
  '2025-09-29',
  '2025-12-12',
  '2026-01-16',
  '2026-01-30',
  '2026-04-17',
];

function readFixture(name: string): JsonObject {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

function record(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object');
  }
  return value as JsonObject;
}

function missing(value: JsonObject, keys: readonly string[]): string[] {
  return keys.filter((key) => !(key in value));
}

describe('ACP 2026-04-17 create-checkout-session request fixture', () => {
  const request = readFixture('create-checkout-session.request.json');
  const headers = record(request.headers);
  const body = record(request.body);

  it('carries the required Idempotency-Key and API-Version headers', () => {
    expect(missing(headers, ['Idempotency-Key', 'API-Version'])).toEqual([]);
    expect(headers['API-Version']).toBe('2026-04-17');
    const key = String(headers['Idempotency-Key']);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(255);
  });

  it('flags a request without an idempotency key', () => {
    const { 'Idempotency-Key': _removed, ...withoutKey } = headers;

    expect(missing(withoutKey, ['Idempotency-Key', 'API-Version'])).toEqual([
      'Idempotency-Key',
    ]);
  });

  it('carries line_items, currency and capabilities', () => {
    expect(missing(body, ['line_items', 'currency', 'capabilities'])).toEqual(
      []
    );
    const lineItems = body.line_items as JsonObject[];
    expect(lineItems.length).toBeGreaterThan(0);
    expect(lineItems.every((item) => typeof item.id === 'string')).toBe(true);
    expect(typeof body.currency).toBe('string');
    expect(typeof body.capabilities).toBe('object');
  });
});

describe('ACP 2026-04-17 create-checkout-session response fixture', () => {
  const response = readFixture('create-checkout-session.response.json');
  const request = readFixture('create-checkout-session.request.json');
  const body = record(response.body);

  it('is a 201 that echoes the idempotency key', () => {
    expect(response.status).toBe(201);
    expect(record(response.headers)['Idempotency-Key']).toBe(
      record(request.headers)['Idempotency-Key']
    );
  });

  it('carries every required checkout session field', () => {
    expect(
      missing(body, [
        'id',
        'status',
        'currency',
        'line_items',
        'totals',
        'fulfillment_options',
        'messages',
        'links',
        'capabilities',
      ])
    ).toEqual([]);
  });

  it('gives each line item an id, item.id, quantity and totals', () => {
    const lineItems = (body.line_items as unknown[]).map(record);

    expect(lineItems.length).toBeGreaterThan(0);
    for (const line of lineItems) {
      expect(missing(line, ['id', 'item', 'quantity', 'totals'])).toEqual([]);
      expect(typeof record(line.item).id).toBe('string');
      expect(line.quantity as number).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every total a type, display_text and integer amount', () => {
    const lineTotals = (body.line_items as JsonObject[]).flatMap(
      (line) => line.totals as unknown[]
    );
    const totals = [...(body.totals as unknown[]), ...lineTotals].map(record);

    expect(totals.length).toBeGreaterThan(0);
    for (const total of totals) {
      expect(missing(total, ['type', 'display_text', 'amount'])).toEqual([]);
      expect(Number.isInteger(total.amount)).toBe(true);
    }
  });
});

describe('known gaps against released ACP versions', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Roadmap Task 5 settles the advertised version (verify what OpenAI accepts
  // first); this test then starts failing and `.fails` must go. Baci
  // advertises 2026-04-30, which has no ACP release.
  it.fails('F41: the advertised ACP version is a released ACP version', async () => {
    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );
    const { buildAcpDiscoveryProfile } = await import(
      '@/lib/agentic/acp-discovery-profile'
    );
    const { AGENTIC_API_VERSION } = await import(
      '@/lib/agentic/request-integrity'
    );
    const profile = buildAcpDiscoveryProfile(
      buildAgentCommerceManifest(
        {
          business_name: 'Ogabassey',
          feature_settings: { pay_on_delivery_enabled: true },
          paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
          slug: 'ogabassey',
        },
        'https://ogabassey.com'
      )
    );

    expect(RELEASED_ACP_VERSIONS).toContain(AGENTIC_API_VERSION);
    expect(RELEASED_ACP_VERSIONS).toContain(profile.protocol.version);
  });
});
```

Create `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts` with exactly:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { UCP_SCHEMAS, validateUcpDocument } from '../ucp-schema-validator';

type JsonObject = Record<string, unknown>;

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_VERSION = '2026-07-28';
// Every 2026-07-28 request must carry these in params._meta.
const REQUIRED_META_KEYS = [
  'io.modelcontextprotocol/protocolVersion',
  'io.modelcontextprotocol/clientCapabilities',
] as const;

function readFixture(name: string): JsonObject {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

function record(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object');
  }
  return value as JsonObject;
}

function missingMetaKeys(params: JsonObject): string[] {
  const meta = record(params._meta);
  return REQUIRED_META_KEYS.filter((key) => !(key in meta));
}

describe('MCP 2026-07-28 request fixtures', () => {
  it.each([
    ['tools-list.request.json', 'tools/list'],
    ['tools-call.search-ucp-catalog.request.json', 'tools/call'],
  ])('%s is a stateless %s request', (file, method) => {
    const request = readFixture(file);
    const params = record(request.params);

    expect(request.jsonrpc).toBe('2.0');
    expect(request.method).toBe(method);
    expect(missingMetaKeys(params)).toEqual([]);
    expect(record(params._meta)[REQUIRED_META_KEYS[0]]).toBe(PROTOCOL_VERSION);
    expect(record(record(params._meta)[REQUIRED_META_KEYS[1]])).toEqual({});
  });

  it('flags a request that omits a required _meta key', () => {
    const params = record(readFixture('tools-list.request.json').params);
    const meta = { ...record(params._meta) };
    delete meta[REQUIRED_META_KEYS[0]];
    delete meta[REQUIRED_META_KEYS[1]];

    expect(missingMetaKeys({ _meta: meta })).toEqual([...REQUIRED_META_KEYS]);
  });
});

describe('MCP 2026-07-28 tools/list result fixture', () => {
  const result = record(readFixture('tools-list.result.json').result);

  it('is a complete, cacheable result', () => {
    expect(result.resultType).toBe('complete');
    expect(
      Number.isInteger(result.ttlMs) && (result.ttlMs as number) >= 0
    ).toBe(true);
    expect(['public', 'private']).toContain(result.cacheScope);
    expect(readFixture('tools-list.result.json').id).toBe(
      readFixture('tools-list.request.json').id
    );
  });

  it('lists search_ucp_catalog with an object input schema', () => {
    const tools = (result.tools as JsonObject[]).map(record);

    expect(tools.map((tool) => tool.name)).toEqual(['search_ucp_catalog']);
    expect(record(tools[0].inputSchema).type).toBe('object');
    expect(record(tools[0].annotations).readOnlyHint).toBe(true);
  });
});

describe('MCP 2026-07-28 tools/call fixtures', () => {
  const request = readFixture('tools-call.search-ucp-catalog.request.json');
  const response = readFixture('tools-call.search-ucp-catalog.result.json');
  const result = record(response.result);

  it('calls a listed tool with arguments that satisfy its input schema', () => {
    const tool = record(
      (
        record(readFixture('tools-list.result.json').result).tools as unknown[]
      )[0]
    );
    const params = record(request.params);

    const validate = new Ajv2020().compile(record(tool.inputSchema));

    expect(params.name).toBe(tool.name);
    expect(validate(params.arguments)).toBe(true);
    expect(validate({ limit: 0 })).toBe(false);
    expect(validate({ limit: 51 })).toBe(false);
  });

  it('completes with text content and structured content', () => {
    const structured = record(result.structuredContent);

    expect(response.id).toBe(request.id);
    expect(result.resultType).toBe('complete');
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([
      { type: 'text', text: 'UCP catalog search completed.' },
    ]);
    expect(structured.status).toBe('success');
  });

  it('carries a UCP catalog search response in minor units', () => {
    const { catalog } = record(result.structuredContent);

    expect(
      validateUcpDocument(UCP_SCHEMAS.catalogSearchResponse, catalog)
    ).toEqual({ errors: [], valid: true });
  });
});

describe('known gaps against MCP 2026-07-28', () => {
  // Roadmap Task 5 moves the card to 2026-07-28; this test then starts
  // failing and `.fails` must go. The server card still says 2025-06-18.
  it.fails('F40: the server card advertises MCP 2026-07-28', async () => {
    const { GET } = await import(
      '@/app/.well-known/mcp/server-card.json/route'
    );

    const body = await GET().json();

    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/fixtures/acp-fixtures.test.ts src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts --testTimeout=120000
```

Expected: both files FAIL while collecting tests: `Error: ENOENT: no such file or directory, open '…/src/lib/agentic/fixtures/mcp-2026-07-28/tools-list.result.json'` and `… open '…/fixtures/acp-2026-04-17/create-checkout-session.request.json'`, then `Test Files  2 failed (2)` and `Tests  no tests`.

- [ ] **Step 3: Write the ACP fixtures**

Create `apps/web/src/lib/agentic/fixtures/acp-2026-04-17/create-checkout-session.request.json` with exactly:

```json
{
  "headers": {
    "API-Version": "2026-04-17",
    "Authorization": "Bearer REDACTED",
    "Content-Type": "application/json",
    "Idempotency-Key": "idem_create_0001",
    "Request-Id": "request_0001"
  },
  "body": {
    "capabilities": {},
    "currency": "ngn",
    "line_items": [
      {
        "id": "variant-1",
        "name": "Kobo phone",
        "unit_amount": 3998
      }
    ]
  }
}
```

Create `apps/web/src/lib/agentic/fixtures/acp-2026-04-17/create-checkout-session.response.json` with exactly:

```json
{
  "status": 201,
  "headers": {
    "Content-Type": "application/json",
    "Idempotency-Key": "idem_create_0001",
    "Request-Id": "request_0001"
  },
  "body": {
    "capabilities": {},
    "currency": "ngn",
    "fulfillment_options": [],
    "id": "checkout_session_0001",
    "line_items": [
      {
        "id": "line_item_0001",
        "item": { "id": "variant-1" },
        "name": "Kobo phone",
        "quantity": 1,
        "totals": [
          {
            "type": "items_base_amount",
            "display_text": "Item price",
            "amount": 3998
          },
          { "type": "subtotal", "display_text": "Subtotal", "amount": 3998 },
          { "type": "total", "display_text": "Total", "amount": 3998 }
        ],
        "unit_amount": 3998
      }
    ],
    "links": [],
    "messages": [],
    "protocol": { "version": "2026-04-17" },
    "status": "ready_for_payment",
    "totals": [
      { "type": "items_base_amount", "display_text": "Items", "amount": 3998 },
      { "type": "subtotal", "display_text": "Subtotal", "amount": 3998 },
      { "type": "total", "display_text": "Total", "amount": 3998 }
    ]
  }
}
```

Create `apps/web/src/lib/agentic/fixtures/acp-2026-04-17/SOURCE.md` with exactly:

```markdown
# ACP 2026-04-17 fixtures

Baci-authored request and response examples for creating an Agentic Commerce
Protocol checkout session. They are written for Baci's tests, not copied from
the ACP repository, and they invent no credentials: `Authorization` is
`Bearer REDACTED`.

| | |
| --- | --- |
| Repository | https://github.com/agentic-commerce-protocol/agentic-commerce-protocol |
| Release commit | `9abf303f48088d170503a54502d612b8b1997897` ("RELEASE: 2026-04-17", 17 April 2026) |
| Licence of the specification | Apache-2.0 |
| Checked | 31 October 2026 |

## What the fixtures follow

- `spec/2026-04-17/openapi/openapi.agentic_checkout.yaml`, operation
  `createCheckoutSession`:
  - `Idempotency-Key` and `API-Version` are required headers.
  - `CheckoutSessionCreateRequest` requires `line_items`, `currency` and
    `capabilities`.
  - A created session answers `201` with `CheckoutSession`, which requires
    `id`, `status`, `currency`, `line_items`, `totals`, `fulfillment_options`,
    `messages`, `links` and `capabilities`.
  - `LineItem` requires `id`, `item`, `quantity` and `totals`; `Total`
    requires `type`, `display_text` and an integer minor-unit `amount`.
- `spec/2026-04-17/json-schema/schema.agentic_checkout.json`, the same shapes
  as JSON Schema. The fixtures were checked against it once when written.
- The currency is lower case (`ngn`), like the specification's own examples.

The OpenAPI path examples still show `items` in the create request body, which
the schema does not allow. The schema and the required list above decide.

## Files

- `create-checkout-session.request.json`: request headers and body.
- `create-checkout-session.response.json`: response status, headers and body.

`acp-fixtures.test.ts` checks the required fields above. It also records one
known gap as an `it.fails` test: Baci advertises ACP version `2026-04-30`,
which has no release (F41). The released versions in the test are the spec
directories of the commit above: `2025-09-29`, `2025-12-12`, `2026-01-16`,
`2026-01-30` and `2026-04-17`.
```

- [ ] **Step 4: Write the MCP fixtures**

These live under `src`, so Biome formats them; Step 7 runs it.

Create `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/tools-list.request.json` with exactly:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "baci-fixture-client",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Create `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/tools-list.result.json` with exactly:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resultType": "complete",
    "tools": [
      {
        "name": "search_ucp_catalog",
        "title": "Search UCP Catalog",
        "description": "Search Ogabassey products through the signed UCP catalog search route.",
        "inputSchema": {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "properties": {
            "cursor": { "type": "string", "minLength": 1 },
            "filters": {
              "type": "object",
              "propertyNames": { "type": "string" },
              "additionalProperties": {}
            },
            "limit": {
              "default": 20,
              "type": "integer",
              "exclusiveMinimum": 0,
              "maximum": 50
            },
            "query": { "type": "string", "minLength": 1 }
          }
        },
        "annotations": {
          "readOnlyHint": true,
          "destructiveHint": false,
          "openWorldHint": true
        }
      }
    ],
    "ttlMs": 300000,
    "cacheScope": "public",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "ogabassey-store",
        "version": "1.0.0"
      }
    }
  }
}
```

Create `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/tools-call.search-ucp-catalog.request.json` with exactly:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "search_ucp_catalog",
    "arguments": {
      "query": "kobo phone",
      "limit": 5
    },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "baci-fixture-client",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Create `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/tools-call.search-ucp-catalog.result.json` with exactly:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "resultType": "complete",
    "content": [{ "type": "text", "text": "UCP catalog search completed." }],
    "structuredContent": {
      "catalog": {
        "ucp": {
          "version": "2026-04-08",
          "status": "success",
          "capabilities": {
            "dev.ucp.shopping.catalog.search": [{ "version": "2026-04-08" }]
          }
        },
        "products": [
          {
            "id": "product-1",
            "title": "Kobo phone",
            "description": { "plain": "A phone priced with kobo" },
            "price_range": {
              "min": { "amount": 3998, "currency": "NGN" },
              "max": { "amount": 3998, "currency": "NGN" }
            },
            "variants": [
              {
                "id": "product-1",
                "title": "Kobo phone",
                "description": { "plain": "A phone priced with kobo" },
                "inputs": [{ "id": "product-1", "match": "featured" }],
                "price": { "amount": 3998, "currency": "NGN" },
                "availability": { "available": true }
              }
            ]
          }
        ],
        "pagination": { "has_next_page": false }
      },
      "endpoint": "https://ogabassey.com/api/agentic/catalog/search",
      "idempotency_key": null,
      "request_id": "request_0002",
      "status": "success"
    },
    "isError": false,
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "ogabassey-store",
        "version": "1.0.0"
      }
    }
  }
}
```

Create `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/SOURCE.md` with exactly:

```markdown
# MCP 2026-07-28 fixtures

Baci-authored JSON-RPC examples for the Model Context Protocol `2026-07-28`
revision. They are written for Baci's tests; nothing is copied from the MCP
repository, whose licence is mixed.

| | |
| --- | --- |
| Repository | https://github.com/modelcontextprotocol/modelcontextprotocol |
| Tag | `2026-07-28` |
| Commit | `5f5440bb26a62e2cf3440b92da5a667efa03b267` |
| Specification pages | https://modelcontextprotocol.io/specification/2026-07-28/server/tools and https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning |
| Checked | 31 October 2026 |

## What the fixtures follow

- Every request carries `params._meta` with
  `io.modelcontextprotocol/protocolVersion` and
  `io.modelcontextprotocol/clientCapabilities`; both are required. The fixtures
  also send `io.modelcontextprotocol/clientInfo`, which is recommended.
- A `tools/list` result has `resultType: "complete"`, `tools`, and the required
  cache fields `ttlMs` and `cacheScope` (`public` or `private`).
- A `tools/call` result has `resultType: "complete"`, `content`, and optional
  `structuredContent`.
- The tool is Baci's `search_ucp_catalog`. Its `inputSchema` is what Zod emits
  for `searchUcpCatalogInputSchema` in `agentic-ucp-client.ts`, and the call
  result wraps the way `buildUcpToolResponse` in `agentic-ucp-tools.ts` does,
  around a UCP catalog search response in minor units.

## Files

- `tools-list.request.json`, `tools-list.result.json`
- `tools-call.search-ucp-catalog.request.json`,
  `tools-call.search-ucp-catalog.result.json`

`mcp-fixtures.test.ts` in this folder checks the required fields and records one
known gap as an `it.fails` test: the server card still advertises
`2025-06-18` (F40).
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/fixtures/acp-fixtures.test.ts src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts --testTimeout=120000
```

Expected: `Test Files  2 passed (2)` and `Tests  15 passed | 2 expected fail (17)`: ACP is 7 passed and 1 expected fail, MCP is 8 passed and 1 expected fail.

- [ ] **Step 6: See the two gaps fail as ordinary tests**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
sed 's/it\.fails(/it(/' src/lib/agentic/fixtures/acp-fixtures.test.ts > src/lib/agentic/fixtures/acp-red.test.ts
sed 's/it\.fails(/it(/' src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts > src/lib/agentic/fixtures/mcp-2026-07-28/mcp-red.test.ts
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/fixtures/acp-red.test.ts src/lib/agentic/fixtures/mcp-2026-07-28/mcp-red.test.ts --testTimeout=120000
rm src/lib/agentic/fixtures/acp-red.test.ts src/lib/agentic/fixtures/mcp-2026-07-28/mcp-red.test.ts
```

Expected: exactly two failures. `F41: the advertised ACP version is a released ACP version` fails with `expected [ '2025-09-29', '2025-12-12', …(3) ] to include '2026-04-30'`, and `F40: the server card advertises MCP 2026-07-28` fails with `expected '2025-06-18' to be '2026-07-28'`. `Tests  2 failed | 15 passed (17)`.

- [ ] **Step 7: Format**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
npm_config_verify_deps_before_run=false pnpm exec biome check --write apps/web/src/lib/agentic/fixtures
```

Expected: no errors. Biome expands the MCP JSON the same way it did the vendored schemas; the shapes below are already in that form.

- [ ] **Step 8: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/fixtures/acp-2026-04-17 apps/web/src/lib/agentic/fixtures/acp-fixtures.test.ts apps/web/src/lib/agentic/fixtures/mcp-2026-07-28
git status --short
LEFTHOOK_EXCLUDE=knip git commit -m "test(agentic): add MCP 2026-07-28 and ACP 2026-04-17 fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Two-merchant synthetic harness

**Files:**
- Create: `apps/web/src/lib/agentic/test-support/synthetic-ids.ts`, `synthetic-merchants.ts`, `synthetic-catalog.ts`, `synthetic-actors.ts`, `synthetic-paystack.ts`
- Test: `synthetic-merchants.test.ts`, `synthetic-actors.test.ts`, `synthetic-paystack.test.ts` in the same folder

Deterministic data only, typed with the real types: `AgenticMerchantContext` (`merchant-context.ts`), `AgenticProduct` and `AgenticVariant` (`checkout-catalog.ts`), `UcpCatalogProductRow` (`ucp-catalog-adapters.ts`) and the argument types of `buildAgentCommerceManifest` and `confirmAgenticPaystackDvaPayment`.

- Merchant A is VAT registered and enrolled in shared cart; merchant B is neither. Each has its own ids, slug, host and Paystack subaccount. B keeps a stored VAT rate of 7.5 so a later VAT guard is tested on a merchant that has a rate but is not registered.
- Each merchant has the same four products: a N39.98 product, a refurbished laptop, a product whose only variant is out of stock, and a product whose variant has unknown stock (`manage_stock` null, which the storefront treats as available without a count).
- Two customers carry the buyer fields a checkout request takes. Two agent identities: a UCP platform agent with a profile URL and an ACP client. Baci reads only the `agent-id` and `user-agent` headers today and does not read a `UCP-Agent` header anywhere, so the profile URL is test data for later plans.
- Fake Paystack outcomes for a DVA checkout session: paid exact, paid one kobo short, timeout (indeterminate: no verified amount, reconcile and never retry as a new payment) and a duplicate webhook (the identical signed event twice).

The self-tests also run the real code against the harness: `merchantHasFeature` and `getStorefrontAgentAvailability` read the merchants and products, `buildAgentCommerceManifest` enables checkout only for the one configured agentic merchant (which documents the single-tenant limit that roadmap Task 5 removes), `verifyAgenticRequestIntegrity` accepts both agent ids, and `confirmAgenticPaystackDvaPayment` answers each outcome as described.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/agentic/test-support/synthetic-merchants.test.ts` with exactly:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapUcpCatalogProductRow } from '@/lib/agentic/ucp-catalog-adapters';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { getStorefrontAgentAvailability } from '@/lib/storefront-agent-availability';
import { stubAgenticEnv } from './stub-agentic-env';
import {
  buildSyntheticCatalog,
  SYNTHETIC_PRODUCT_SCENARIOS,
  type SyntheticCatalog,
} from './synthetic-catalog';
import {
  SYNTHETIC_MERCHANT_A,
  SYNTHETIC_MERCHANT_B,
} from './synthetic-merchants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('synthetic merchants', () => {
  it('are two distinct tenants', () => {
    const [a, b] = [SYNTHETIC_MERCHANT_A, SYNTHETIC_MERCHANT_B];

    expect(a.context.id).not.toBe(b.context.id);
    expect(a.context.slug).not.toBe(b.context.slug);
    expect(a.baseUrl).not.toBe(b.baseUrl);
    expect(a.context.paystack_subaccount_code).not.toBe(
      b.context.paystack_subaccount_code
    );
    expect(a.record.id).toBe(a.context.id);
    expect(b.record.slug).toBe(b.context.slug);
    expect(a.context.id).toMatch(UUID);
  });

  it('differ in VAT registration and shared-cart enrolment', () => {
    expect(SYNTHETIC_MERCHANT_A.record.vat_registration_status).toBe(
      'registered'
    );
    expect(SYNTHETIC_MERCHANT_B.record.vat_registration_status).toBe(
      'not_registered'
    );
    expect(merchantHasFeature(SYNTHETIC_MERCHANT_A.record, 'shared_cart')).toBe(
      true
    );
    expect(merchantHasFeature(SYNTHETIC_MERCHANT_B.record, 'shared_cart')).toBe(
      false
    );
  });
});

describe('synthetic merchants through the real agent manifest', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv('synthetic-alpha');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enable checkout only for the one configured agentic merchant', async () => {
    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const a = buildAgentCommerceManifest(
      SYNTHETIC_MERCHANT_A.manifestMerchant,
      SYNTHETIC_MERCHANT_A.baseUrl
    );
    const b = buildAgentCommerceManifest(
      SYNTHETIC_MERCHANT_B.manifestMerchant,
      SYNTHETIC_MERCHANT_B.baseUrl
    );

    expect(a.store.slug).toBe('synthetic-alpha');
    expect(a.capabilities).toContain('checkout.session.complete');
    expect(a.payment_methods).toEqual([
      'paystack_bank_transfer',
      'pay_on_delivery',
    ]);
    // Single-tenant today: partner-scoped onboarding is roadmap Task 5.
    expect(b.auth).toBeNull();
    expect(b.capabilities).toEqual(['catalog.read']);
  });
});

describe('synthetic catalogs', () => {
  const catalogA = buildSyntheticCatalog(SYNTHETIC_MERCHANT_A);
  const catalogB = buildSyntheticCatalog(SYNTHETIC_MERCHANT_B);

  it('hold every scenario for each merchant', () => {
    for (const catalog of [catalogA, catalogB]) {
      expect(Object.keys(catalog).sort()).toEqual(
        [...SYNTHETIC_PRODUCT_SCENARIOS].sort()
      );
    }
  });

  it('never share an id across merchants or scenarios', () => {
    const ids = [catalogA, catalogB].flatMap((catalog) =>
      Object.values(catalog).flatMap((entry) => [
        entry.product.id,
        ...(entry.variant ? [entry.variant.id] : []),
      ])
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => UUID.test(id))).toBe(true);
    expect(catalogA.kobo_price.row.merchant_id).toBe(
      SYNTHETIC_MERCHANT_A.context.id
    );
    expect(catalogB.kobo_price.row.merchant_id).toBe(
      SYNTHETIC_MERCHANT_B.context.id
    );
  });

  it('price the kobo product at 39.98 and 3998 minor units', () => {
    expect(catalogA.kobo_price.priceMajor).toBe(39.98);
    expect(catalogA.kobo_price.priceMinor).toBe(3998);
    for (const entry of Object.values(catalogA)) {
      expect(Math.round(entry.priceMajor * 100)).toBe(entry.priceMinor);
    }
  });

  it('keep a refurbished item and the variants for the stock scenarios', () => {
    expect(catalogA.refurbished.condition).toBe('refurbished');
    expect(catalogA.kobo_price.condition).toBe('new');
    for (const scenario of [
      'out_of_stock_variant',
      'unknown_stock_variant',
    ] as const) {
      const entry = catalogA[scenario];
      expect(entry.variant?.product_id).toBe(entry.product.id);
      expect(entry.variant?.merchant_id).toBe(SYNTHETIC_MERCHANT_A.context.id);
    }
  });

  it('read as in stock, out of stock and untracked through the real helpers', () => {
    const availability = (scenario: keyof SyntheticCatalog) =>
      getStorefrontAgentAvailability(catalogA[scenario].row);

    expect(availability('kobo_price')).toMatchObject({
      inventory_policy: 'tracked',
      is_purchasable: true,
    });
    expect(availability('out_of_stock_variant')).toMatchObject({
      inventory_policy: 'tracked',
      is_purchasable: false,
    });
    expect(availability('unknown_stock_variant')).toMatchObject({
      inventory_policy: 'untracked',
      quantity_available: null,
    });
    expect(catalogA.out_of_stock_variant.variant?.stock_quantity).toBe(0);
  });

  it('map into UCP catalog products', () => {
    const product = mapUcpCatalogProductRow({
      baseUrl: SYNTHETIC_MERCHANT_A.baseUrl,
      currency: 'NGN',
      row: catalogA.out_of_stock_variant.row,
    });

    expect(product?.variants[0].availability).toEqual({ available: false });
  });

  it('are identical on every build', () => {
    expect(buildSyntheticCatalog(SYNTHETIC_MERCHANT_A)).toEqual(catalogA);
  });
});
```

Create `apps/web/src/lib/agentic/test-support/synthetic-actors.test.ts` with exactly:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAgenticEnv } from './stub-agentic-env';
import {
  agentIdentityHeaders,
  SYNTHETIC_ACP_CLIENT,
  SYNTHETIC_CUSTOMER_ONE,
  SYNTHETIC_CUSTOMER_TWO,
  SYNTHETIC_UCP_AGENT,
} from './synthetic-actors';

describe('synthetic customers', () => {
  it('are two distinct buyers with valid buyer fields', () => {
    expect(SYNTHETIC_CUSTOMER_ONE.id).not.toBe(SYNTHETIC_CUSTOMER_TWO.id);
    expect(SYNTHETIC_CUSTOMER_ONE.buyer.email).not.toBe(
      SYNTHETIC_CUSTOMER_TWO.buyer.email
    );
    for (const { buyer } of [SYNTHETIC_CUSTOMER_ONE, SYNTHETIC_CUSTOMER_TWO]) {
      expect(buyer.email).toMatch(/^[^@\s]+@example\.test$/);
      expect(buyer.phone_number.length).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('synthetic agent identities', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('are a UCP agent with a profile URL and an ACP client without one', () => {
    expect(SYNTHETIC_UCP_AGENT.agentId).not.toBe(SYNTHETIC_ACP_CLIENT.agentId);
    expect(SYNTHETIC_UCP_AGENT.kind).toBe('ucp');
    expect(SYNTHETIC_UCP_AGENT.ucpAgentProfileUrl).toMatch(/^https:\/\//);
    expect(SYNTHETIC_ACP_CLIENT.kind).toBe('acp');
    expect(SYNTHETIC_ACP_CLIENT.ucpAgentProfileUrl).toBeNull();
  });

  it.each([
    SYNTHETIC_UCP_AGENT,
    SYNTHETIC_ACP_CLIENT,
  ])('pass the request integrity agent-id checks for the $kind agent', async (identity) => {
    const { ACP_STABLE_AGENTIC_API_VERSION, verifyAgenticRequestIntegrity } =
      await import('@/lib/agentic/request-integrity');
    const headers = new Headers(
      agentIdentityHeaders(identity, {
        apiVersion: ACP_STABLE_AGENTIC_API_VERSION,
        requestId: 'synthetic_request_1',
      })
    );

    // The agent id and version are accepted; only the signature is missing.
    expect(
      verifyAgenticRequestIntegrity({
        body: '',
        headers,
        secrets: ['synthetic-secret'],
      })
    ).toEqual({ error: 'Missing signature', ok: false });
  });
});
```

Create `apps/web/src/lib/agentic/test-support/synthetic-paystack.test.ts` with exactly:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { confirmAgenticPaystackDvaPayment } from '@/lib/agentic/paystack-dva-webhook';
import { SYNTHETIC_MERCHANT_A } from './synthetic-merchants';
import {
  buildSyntheticDvaSession,
  buildSyntheticPaystackOutcome,
  SYNTHETIC_DVA_ACCOUNT_NUMBER,
  type SyntheticPaystackOutcomeKind,
  signPaystackWebhook,
} from './synthetic-paystack';

const KINDS: SyntheticPaystackOutcomeKind[] = [
  'paid_exact',
  'paid_short',
  'timeout',
  'duplicate_webhook',
];

// No order yet, so a payment that clears the amount checks stops at the
// missing order instead of writing a transaction.
const SESSION = buildSyntheticDvaSession(SYNTHETIC_MERCHANT_A, {
  orderId: null,
  totalAmount: 79.96,
});

function fakeSupabase() {
  const sessions = {
    in: vi.fn().mockResolvedValue({ data: [SESSION], error: null }),
    or: vi.fn(),
  };
  sessions.or.mockReturnValue(sessions);
  const transactions = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  transactions.eq.mockReturnValue(transactions);
  return {
    from: vi.fn((table: string) => {
      if (table === 'checkout_sessions') {
        return { select: vi.fn(() => sessions) };
      }
      if (table === 'transactions') {
        return { select: vi.fn(() => transactions) };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function confirm(kind: SyntheticPaystackOutcomeKind) {
  const outcome = buildSyntheticPaystackOutcome(kind, SESSION);
  return confirmAgenticPaystackDvaPayment({
    accountNumber: SYNTHETIC_DVA_ACCOUNT_NUMBER,
    gatewayReference: outcome.gatewayReference,
    supabase: fakeSupabase() as never,
    verifiedAmount: outcome.verifiedAmount,
  });
}

describe('synthetic Paystack outcomes', () => {
  it.each(KINDS)('builds the %s outcome', (kind) => {
    const outcome = buildSyntheticPaystackOutcome(kind, SESSION);

    expect(outcome.kind).toBe(kind);
    expect(outcome.webhooks).toHaveLength(kind === 'duplicate_webhook' ? 2 : 1);
    expect(outcome.indeterminate).toBe(kind === 'timeout');
  });

  it('pays the exact total, one kobo short, or leaves it unverified', () => {
    const amount = (kind: SyntheticPaystackOutcomeKind) =>
      buildSyntheticPaystackOutcome(kind, SESSION).verifiedAmount;

    expect(amount('paid_exact')).toEqual({ amount: 79.96, currency: 'NGN' });
    expect(amount('duplicate_webhook')).toEqual({
      amount: 79.96,
      currency: 'NGN',
    });
    expect(amount('paid_short')).toEqual({ amount: 79.95, currency: 'NGN' });
    expect(amount('timeout')).toBeNull();
  });

  it('repeats the identical, identically signed webhook for a duplicate', () => {
    const { webhooks } = buildSyntheticPaystackOutcome(
      'duplicate_webhook',
      SESSION
    );
    const [first, second] = webhooks.map((event) =>
      signPaystackWebhook(event, 'synthetic-secret')
    );

    expect(first).toEqual(second);
    expect(first.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('is identical on every build', () => {
    expect(buildSyntheticPaystackOutcome('paid_exact', SESSION)).toEqual(
      buildSyntheticPaystackOutcome('paid_exact', SESSION)
    );
  });

  it('drives the real DVA confirmation to the matching result', async () => {
    await expect(confirm('paid_short')).resolves.toMatchObject({
      body: { error: 'Payment amount mismatch' },
      status: 400,
    });
    await expect(confirm('timeout')).resolves.toMatchObject({
      body: { error: 'Payment amount verification unavailable' },
      status: 400,
    });
    await expect(confirm('paid_exact')).resolves.toMatchObject({
      body: { error: 'Agentic checkout order not found' },
      status: 409,
    });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/test-support --testTimeout=120000
```

Expected: all three files FAIL at import: `Cannot find module './synthetic-actors' imported from …/synthetic-actors.test.ts`, `Cannot find module './synthetic-catalog' imported from …/synthetic-merchants.test.ts` and `Cannot find module './synthetic-merchants' imported from …/synthetic-paystack.test.ts`, then `Test Files  3 failed (3)` and `Tests  no tests`.

- [ ] **Step 3: Write the modules**

Create `apps/web/src/lib/agentic/test-support/synthetic-ids.ts` with exactly:

```ts
/**
 * Deterministic UUID-shaped ids. The checkout catalog only queries ids that
 * match the Postgres UUID pattern, so synthetic ids must look like UUIDs.
 */
export function syntheticUuid(namespace: number, index: number): string {
  const hex = (value: number, width: number) =>
    value.toString(16).padStart(width, '0');
  return `${hex(namespace, 8)}-0000-4000-8000-${hex(index, 12)}`;
}
```

Create `apps/web/src/lib/agentic/test-support/synthetic-merchants.ts` with exactly:

```ts
import type { buildAgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import type { AgenticMerchantContext } from '@/lib/agentic/merchant-context';
import type { CachedMerchant } from '@/lib/cached-data';
import { syntheticUuid } from './synthetic-ids';

type SyntheticManifestMerchant = Parameters<
  typeof buildAgentCommerceManifest
>[0];

/** The merchant fields that shared-cart and VAT decisions read. */
type SyntheticMerchantRecord = Pick<
  CachedMerchant,
  | 'business_name'
  | 'country'
  | 'feature_settings'
  | 'id'
  | 'payout_currency'
  | 'paystack_subaccount_code'
  | 'plan_expires_at'
  | 'plan_tier'
  | 'premium_features'
  | 'slug'
  | 'vat_rate'
  | 'vat_registration_status'
>;

export interface SyntheticMerchant {
  readonly baseUrl: string;
  /** What the scoped merchant-context RPC returns for this merchant. */
  readonly context: AgenticMerchantContext;
  /** Namespace for every synthetic id that belongs to this merchant. */
  readonly idNamespace: number;
  /** What `buildAgentCommerceManifest` takes. */
  readonly manifestMerchant: SyntheticManifestMerchant;
  /** The merchants-table fields behind shared cart and VAT. */
  readonly record: SyntheticMerchantRecord;
}

function buildSyntheticMerchant({
  businessName,
  domain,
  idNamespace,
  paystackSubaccountCode,
  payOnDelivery,
  premiumFeatures,
  slug,
  vatRegistrationStatus,
}: {
  businessName: string;
  domain: string;
  idNamespace: number;
  paystackSubaccountCode: string;
  payOnDelivery: boolean;
  premiumFeatures: string[];
  slug: string;
  vatRegistrationStatus: 'not_registered' | 'registered';
}): SyntheticMerchant {
  const id = syntheticUuid(idNamespace, 0);
  const featureSettings = {
    agentic_checkout_enabled: true,
    pay_on_delivery_enabled: payOnDelivery,
  };
  return {
    baseUrl: `https://${domain}`,
    context: {
      agent_user_agent_allowlist: [],
      agent_user_agent_denylist: [],
      agentic_checkout_enabled: true,
      business_name: businessName,
      custom_domain: domain,
      id,
      pay_on_delivery_enabled: payOnDelivery,
      paystack_subaccount_code: paystackSubaccountCode,
      slug,
    },
    idNamespace,
    manifestMerchant: {
      business_name: businessName,
      feature_settings: featureSettings,
      paystack_subaccount_code: paystackSubaccountCode,
      slug,
    },
    record: {
      business_name: businessName,
      country: 'NG',
      feature_settings: featureSettings,
      id,
      payout_currency: 'NGN',
      paystack_subaccount_code: paystackSubaccountCode,
      plan_expires_at: null,
      plan_tier: 'pro',
      premium_features: premiumFeatures,
      slug,
      // A rate is stored for every merchant; only registration turns VAT on.
      vat_rate: 7.5,
      vat_registration_status: vatRegistrationStatus,
    },
  };
}

/** VAT registered and enrolled in shared cart. */
export const SYNTHETIC_MERCHANT_A: SyntheticMerchant = buildSyntheticMerchant({
  businessName: 'Synthetic Alpha Store',
  domain: 'alpha.synthetic.test',
  idNamespace: 0xa,
  paystackSubaccountCode: 'ACCT_SYNTHALPHA00001',
  payOnDelivery: true,
  premiumFeatures: ['shared_cart'],
  slug: 'synthetic-alpha',
  vatRegistrationStatus: 'registered',
});

/** Not VAT registered and not enrolled in shared cart. */
export const SYNTHETIC_MERCHANT_B: SyntheticMerchant = buildSyntheticMerchant({
  businessName: 'Synthetic Bravo Store',
  domain: 'bravo.synthetic.test',
  idNamespace: 0xb,
  paystackSubaccountCode: 'ACCT_SYNTHBRAVO00002',
  payOnDelivery: false,
  premiumFeatures: [],
  slug: 'synthetic-bravo',
  vatRegistrationStatus: 'not_registered',
});
```

Create `apps/web/src/lib/agentic/test-support/synthetic-catalog.ts` with exactly:

```ts
import type { GPTLineItem } from '@/lib/agentic/checkout';
import type {
  AgenticProduct,
  AgenticVariant,
} from '@/lib/agentic/checkout-catalog';
import type { UcpCatalogProductRow } from '@/lib/agentic/ucp-catalog-adapters';
import { syntheticUuid } from './synthetic-ids';
import type { SyntheticMerchant } from './synthetic-merchants';

type SyntheticCondition = NonNullable<GPTLineItem['item']['condition']>;

type SyntheticStockState = 'in_stock' | 'out_of_stock' | 'unknown';

export const SYNTHETIC_PRODUCT_SCENARIOS = [
  'kobo_price',
  'refurbished',
  'out_of_stock_variant',
  'unknown_stock_variant',
] as const;

type SyntheticProductScenario = (typeof SYNTHETIC_PRODUCT_SCENARIOS)[number];

interface SyntheticProduct {
  readonly condition: SyntheticCondition;
  /** Storefront price in major units, as stored (for example 39.98). */
  readonly priceMajor: number;
  /** The same price in minor units (for example 3998). */
  readonly priceMinor: number;
  /** What the checkout quote reads for the parent product. */
  readonly product: AgenticProduct;
  /** What the UCP catalog adapters read for the parent product. */
  readonly row: UcpCatalogProductRow;
  readonly scenario: SyntheticProductScenario;
  /**
   * `unknown` means the merchant does not track stock (`manage_stock` is
   * null), which the storefront contract treats as available without a count.
   */
  readonly stockState: SyntheticStockState;
  /** The variant the scenario is about, or null for a plain product. */
  readonly variant: AgenticVariant | null;
}

export type SyntheticCatalog = Readonly<
  Record<SyntheticProductScenario, SyntheticProduct>
>;

interface ProductSpec {
  condition: SyntheticCondition;
  manageStock: boolean | null;
  name: string;
  priceMajor: number;
  priceMinor: number;
  scenario: SyntheticProductScenario;
  stock: number;
  stockState: SyntheticStockState;
  variant: { attributes: Record<string, string>; stockQuantity: number } | null;
}

const SPECS: readonly ProductSpec[] = [
  {
    condition: 'new',
    manageStock: true,
    name: 'Kobo phone',
    priceMajor: 39.98,
    priceMinor: 3998,
    scenario: 'kobo_price',
    stock: 25,
    stockState: 'in_stock',
    variant: null,
  },
  {
    condition: 'refurbished',
    manageStock: true,
    name: 'Refurbished laptop',
    priceMajor: 1250.5,
    priceMinor: 125050,
    scenario: 'refurbished',
    stock: 2,
    stockState: 'in_stock',
    variant: null,
  },
  {
    condition: 'new',
    manageStock: true,
    name: 'Two-colour speaker',
    priceMajor: 82.5,
    priceMinor: 8250,
    scenario: 'out_of_stock_variant',
    // Every variant is sold out, so the parent has nothing to sell either.
    stock: 0,
    stockState: 'out_of_stock',
    variant: { attributes: { colour: 'Black' }, stockQuantity: 0 },
  },
  {
    condition: 'new',
    manageStock: null,
    name: 'Untracked tee',
    priceMajor: 15.5,
    priceMinor: 1550,
    scenario: 'unknown_stock_variant',
    stock: 0,
    stockState: 'unknown',
    variant: { attributes: { size: 'M' }, stockQuantity: 0 },
  },
];

function buildProduct(
  merchant: SyntheticMerchant,
  spec: ProductSpec,
  index: number
): SyntheticProduct {
  const productId = syntheticUuid(merchant.idNamespace, 100 + index * 10);
  const slug = spec.name.toLowerCase().replaceAll(' ', '-');
  const variant: AgenticVariant | null = spec.variant
    ? {
        attributes: spec.variant.attributes,
        id: syntheticUuid(merchant.idNamespace, 100 + index * 10 + 1),
        merchant_id: merchant.context.id,
        product: {
          manage_stock: spec.manageStock,
          name: spec.name,
          price: spec.priceMajor,
        },
        product_id: productId,
        stock_quantity: spec.variant.stockQuantity,
      }
    : null;
  return {
    condition: spec.condition,
    priceMajor: spec.priceMajor,
    priceMinor: spec.priceMinor,
    product: {
      id: productId,
      manage_stock: spec.manageStock,
      name: spec.name,
      price: spec.priceMajor,
      stock: spec.stock,
      stock_quantity: spec.stock,
    },
    row: {
      id: productId,
      manage_stock: spec.manageStock,
      merchant_id: merchant.context.id,
      name: spec.name,
      price: spec.priceMajor,
      slug,
      status: 'active',
      stock: spec.stock,
      stock_quantity: spec.stock,
    },
    scenario: spec.scenario,
    stockState: spec.stockState,
    variant,
  };
}

/** The same four scenarios for any merchant, under that merchant's ids. */
export function buildSyntheticCatalog(
  merchant: SyntheticMerchant
): SyntheticCatalog {
  return Object.fromEntries(
    SPECS.map((spec, index) => [
      spec.scenario,
      buildProduct(merchant, spec, index),
    ])
  ) as SyntheticCatalog;
}
```

Create `apps/web/src/lib/agentic/test-support/synthetic-actors.ts` with exactly:

```ts
import { syntheticUuid } from './synthetic-ids';

/** The buyer fields a checkout request carries. */
interface SyntheticBuyer {
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly phone_number: string;
}

interface SyntheticCustomer {
  readonly buyer: SyntheticBuyer;
  readonly id: string;
}

export const SYNTHETIC_CUSTOMER_ONE: SyntheticCustomer = {
  buyer: {
    email: 'ada.synthetic@example.test',
    first_name: 'Ada',
    last_name: 'Synthetic',
    phone_number: '+2348000000001',
  },
  id: syntheticUuid(0xc, 1),
};

export const SYNTHETIC_CUSTOMER_TWO: SyntheticCustomer = {
  buyer: {
    email: 'tunde.synthetic@example.test',
    first_name: 'Tunde',
    last_name: 'Synthetic',
    phone_number: '+2348000000002',
  },
  id: syntheticUuid(0xc, 2),
};

interface SyntheticAgentIdentity {
  /** Value for the `agent-id` header; request-integrity limits its format. */
  readonly agentId: string;
  readonly kind: 'acp' | 'ucp';
  /**
   * The platform profile a UCP agent advertises in its `UCP-Agent` header.
   * Baci does not read that header today, so this is test data only.
   */
  readonly ucpAgentProfileUrl: string | null;
  readonly userAgent: string;
}

export const SYNTHETIC_UCP_AGENT: SyntheticAgentIdentity = {
  agentId: 'synthetic-ucp-platform',
  kind: 'ucp',
  ucpAgentProfileUrl: 'https://platform.example.com/.well-known/ucp',
  userAgent: 'SyntheticUcpPlatform/1.0',
};

export const SYNTHETIC_ACP_CLIENT: SyntheticAgentIdentity = {
  agentId: 'synthetic-acp-client',
  kind: 'acp',
  ucpAgentProfileUrl: null,
  userAgent: 'SyntheticAcpClient/1.0',
};

/** The unsigned identity headers an agentic request carries. */
export function agentIdentityHeaders(
  identity: SyntheticAgentIdentity,
  { apiVersion, requestId }: { apiVersion: string; requestId: string }
): Record<string, string> {
  return {
    'agent-id': identity.agentId,
    'api-version': apiVersion,
    'request-id': requestId,
    'user-agent': identity.userAgent,
  };
}
```

Create `apps/web/src/lib/agentic/test-support/synthetic-paystack.ts` with exactly:

```ts
import { createHmac } from 'node:crypto';
import type { SyntheticMerchant } from './synthetic-merchants';

/** The checkout_sessions columns the DVA payment confirmation reads. */
interface SyntheticDvaSession {
  readonly currency: string;
  readonly id: string;
  readonly merchant_id: string;
  readonly metadata: {
    readonly agentic: {
      readonly dva_account: { readonly account_number: string };
      readonly payment_state: 'payment_pending';
    };
  };
  readonly order_id: string | null;
  readonly session_id: string;
  readonly status: 'processing';
  /** Major units, as the NUMERIC column stores it. */
  readonly total_amount: number;
}

export const SYNTHETIC_DVA_ACCOUNT_NUMBER = '9930000902';

export function buildSyntheticDvaSession(
  merchant: SyntheticMerchant,
  {
    orderId = 'synthetic-order-1',
    totalAmount,
  }: { orderId?: string | null; totalAmount: number }
): SyntheticDvaSession {
  return {
    currency: 'NGN',
    id: 'synthetic-checkout-row-1',
    merchant_id: merchant.context.id,
    metadata: {
      agentic: {
        dva_account: { account_number: SYNTHETIC_DVA_ACCOUNT_NUMBER },
        payment_state: 'payment_pending',
      },
    },
    order_id: orderId,
    session_id: 'synthetic_session_1',
    status: 'processing',
    total_amount: totalAmount,
  };
}

interface PaystackChargeSuccessEvent {
  readonly data: {
    readonly amount: number;
    readonly authorization: {
      readonly receiver_bank_account_number: string;
    };
    readonly currency: string;
    readonly id: number;
    readonly reference: string;
    readonly status: 'success';
  };
  readonly event: 'charge.success';
}

export type SyntheticPaystackOutcomeKind =
  | 'duplicate_webhook'
  | 'paid_exact'
  | 'paid_short'
  | 'timeout';

interface SyntheticPaystackOutcome {
  readonly gatewayReference: string;
  /**
   * True when Baci cannot tell whether the customer paid. Reconcile with the
   * provider; never create a second payment attempt for it.
   */
  readonly indeterminate: boolean;
  readonly kind: SyntheticPaystackOutcomeKind;
  /**
   * What the webhook route derives from Paystack's verify response (kobo
   * divided by 100). Null when verification gave no amount.
   */
  readonly verifiedAmount: { amount: number; currency: string } | null;
  /** Webhook deliveries in arrival order. */
  readonly webhooks: readonly PaystackChargeSuccessEvent[];
}

const GATEWAY_REFERENCE = 'synthetic-paystack-ref-1';

function chargeSuccess(
  session: SyntheticDvaSession,
  amountKobo: number
): PaystackChargeSuccessEvent {
  return {
    data: {
      amount: amountKobo,
      authorization: {
        receiver_bank_account_number:
          session.metadata.agentic.dva_account.account_number,
      },
      currency: session.currency,
      id: 4_000_000_001,
      reference: GATEWAY_REFERENCE,
      status: 'success',
    },
    event: 'charge.success',
  };
}

/**
 * One fake Paystack outcome for a DVA checkout session. A short payment is one
 * kobo below the total, the smallest mismatch the confirmation must reject.
 */
export function buildSyntheticPaystackOutcome(
  kind: SyntheticPaystackOutcomeKind,
  session: SyntheticDvaSession
): SyntheticPaystackOutcome {
  const exactKobo = Math.round(session.total_amount * 100);
  const paidKobo = kind === 'paid_short' ? exactKobo - 1 : exactKobo;
  const event = chargeSuccess(session, paidKobo);
  const verified = { amount: paidKobo / 100, currency: session.currency };
  return {
    gatewayReference: GATEWAY_REFERENCE,
    indeterminate: kind === 'timeout',
    kind,
    verifiedAmount: kind === 'timeout' ? null : verified,
    webhooks: kind === 'duplicate_webhook' ? [event, event] : [event],
  };
}

/** The raw body and `x-paystack-signature` value for a webhook delivery. */
export function signPaystackWebhook(
  event: PaystackChargeSuccessEvent,
  secret: string
): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(event);
  return {
    rawBody,
    signature: createHmac('sha512', secret).update(rawBody).digest('hex'),
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/test-support --testTimeout=120000
```

Expected: `Test Files  3 passed (3)` and `Tests  22 passed (22)`: 10 in merchants, 4 in actors and 8 in Paystack.

- [ ] **Step 5: Format**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
npm_config_verify_deps_before_run=false pnpm exec biome check --write apps/web/src/lib/agentic/test-support
wc -l apps/web/src/lib/agentic/test-support/*.ts | sort -n | tail -3
```

Expected: Biome reports no errors; no file above 300 lines (the longest is `synthetic-merchants.test.ts`, about 170).

- [ ] **Step 6: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/test-support
git status --short
LEFTHOOK_EXCLUDE=knip git commit -m "test(agentic): add a two-merchant synthetic harness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Re-review the capability register (last)

The register is bound to the access map's provenance and to every file the map cites. This plan edited the map (Task 3) and added files it links to, so the gate fails until the register is re-reviewed. This task runs last, on the final code commit, and is redone after any rebase or other history change.

**Files:**
- Modify: `docs/product/baci-capabilities.json`
- Modify: `docs/product/agent-access-map.md`

> **Warning: `source_revision` must name a commit that exists on GitHub with the same ID.** Step 5 records the code commit's ID in the register, in the map header and in the table. The orchestrator's push script preserves commit IDs and fails on a mismatch. Never amend, rebase or squash after Step 5 without redoing the task, and do not push this branch yourself.

- [ ] **Step 1: Settle the base, then drop any earlier Task 8 commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
git fetch origin main
git status --short
git log -1 --format=%s
git diff --name-only HEAD...origin/main -- docs/product vps-workers/baci-editorial-context
```

Expected: `git status --short` prints nothing. If the log line is `docs(capabilities): re-review the agent access map after the surface evidence table`, that is an earlier Task 8 commit: run `git reset --hard HEAD~1` (only in that case) so the register is stamped on the final code commit. If the last command lists files, origin/main changed the register or the gate since you branched, so rebase first:

- Branched from `origin/main` (Task 0, case A): `git rebase origin/main`.
- Branched from plan 1's branch (case B) and #3869 has merged: `git rebase --onto origin/main ede636ee975607781318545ba9dbb581e0589b67 chore/agentic-baseline-evidence` (use the head you actually branched from if it differs), then the orchestrator retargets the pull request to `main`.
- Branched from plan 1's branch and #3869 is still open: no rebase; the gate compares against `origin/main`, which does not contain plan 1 yet, so it sees plan 1's changes as well as this plan's. That is expected and passes, because plan 1's cited-file changes are in your history.

Any rebase rewrites every commit ID, so the orchestrator must force-push the feature branch afterwards; that is why this task is last.

- [ ] **Step 2: Re-run this plan's tests**

These nine files are the evidence behind the four Local test cells that Step 5 records, and a rebase can break them.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/evidence src/lib/agentic/fixtures src/lib/agentic/test-support --testTimeout=120000
```

Expected: `Test Files  9 passed (9)` and `Tests  106 passed | 9 expected fail (115)`. A known-gap test that now reports a failure means someone fixed that gap: delete its `.fails`, and record the change in the pull request.

- [ ] **Step 3: Typecheck the web project once and lint the affected packages**

These are the only broad local checks; everything else is CI. Every file this plan adds under `apps/web` is in `src`, so one pass of the web project's own TypeScript configuration covers all of it. `--incremental false` avoids a stale `tsconfig.tsbuildinfo` hiding an error. Measured on a heavily loaded Mac: about 20 seconds, with a peak of roughly 11.5 GB of memory, which is the same compilation `pnpm typecheck` and CI run for the web package. Run it once; if the machine is short of memory, skip it and let CI typecheck, and say so in the pull request.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence/apps/web
npm_config_verify_deps_before_run=false pnpm exec tsc --noEmit -p tsconfig.json --incremental false; echo "tsc exit=$?"
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
TURBO_SCM_BASE=$(git merge-base HEAD origin/main) npm_config_verify_deps_before_run=false pnpm turbo lint --affected
```

Expected: `tsc` prints nothing and `tsc exit=0`; the lint run succeeds and only the web package runs. (`pnpm turbo typecheck --affected` would rerun the same `tsc` plus the tools, MCP and builder projects this plan does not touch.)

- [ ] **Step 4: Run the gate and watch it fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
BASE_SHA=$(git rev-parse origin/main) BACI_REGISTER_REQUIRE_FRESH=1 python3 vps-workers/baci-editorial-context/capability_gate.py; echo "gate exit=$?"
```

Expected, within a second: `capability sources changed without a register re-review; update docs/product/baci-capabilities.json (reviewed_at + digests) in this change` and `gate exit=1`. The access map changed and the register's `reviewed_at` and `source_revision` have not advanced.

- [ ] **Step 5: Stamp the register, the map header, the table and the digests**

The first command must print nothing (a clean tree), because the script records `HEAD`. The script sets the register's `reviewed_at`, `source_revision` and `review_scope`, rewrites the first paragraph of the map, writes the code commit's ID into every Source revision cell, and records the four Local test cells as `fail` with the dated test file as evidence (each `fail` is a known gap or documented limitation pinned by a test from Tasks 5 to 7). The claim, limitations and status of the `agent-protocols` row do not change: no cited capability source changed, so this review is of the new table only.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
git status --short
RESTAMP="${TMPDIR:-/tmp}/agentic-baseline-restamp.py"
cat > "$RESTAMP" <<'PY'
import datetime as dt
import json
import pathlib
import re
import subprocess
import textwrap

rev = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
stamp = now.strftime("%Y-%m-%dT%H:%M:%S+00:00")
day = f"{now.day} {now:%B} {now.year}"

register_path = pathlib.Path("docs/product/baci-capabilities.json")
register = register_path.read_text()
scope = (
    "Source evidence only. Added the agent surface evidence table to the access "
    "map from the cited agentic sources, the 31 October 2026 production profile "
    "baseline and new local fixture and conformance tests; no cited capability "
    "source changed and the agent-protocols claim, limitations and status are "
    "unchanged. The support-chat health probe, OAuth connected discovery, "
    "anonymous compatibility and refresh receipts retain their prior review. "
    "New-endpoint conversational and native acceptance remain pending. No "
    "production promotion; deployment and transaction readiness require "
    "separate verification."
)
for key, value in (
    ("reviewed_at", stamp),
    ("source_revision", rev),
    ("review_scope", scope),
):
    register, count = re.subn(
        rf'("{key}"\s*:\s*)"(?:[^"\\]|\\.)*"', lambda m: m.group(1) + json.dumps(value), register, count=1
    )
    assert count == 1, key
register_path.write_text(register)

map_path = pathlib.Path("docs/product/agent-access-map.md")
text = map_path.read_text()
body = (
    f"`{rev}`. Added an agent surface evidence table with explicit unknowns "
    "for the seven agent surfaces; the cited capability claims are unchanged. "
    "This is a navigation map, not authorization or proof of current "
    "deployment. Check the current implementation, live tool discovery and "
    "merchant entitlement before calling or claiming a tool."
)
header = f"Reviewed {day} against source revision\n{textwrap.fill(body, 80)}\n\n"
text, count = re.subn(r"(?s)(?<=\n\n)Reviewed .*?\n\n", lambda m: header, text, count=1)
assert count == 1, "header"
local_tests = {
    "OpenAI MCP handoff": ("fail", "MCP 2026-07-28 fixtures", "../../apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts"),
    "ACP direct checkout": ("fail", "ACP 2026-04-17 fixtures", "../../apps/web/src/lib/agentic/fixtures/acp-fixtures.test.ts"),
    "Google UCP cart": ("fail", "UCP conformance baseline", "../../apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts"),
    "Multi-merchant onboarding": ("fail", "two synthetic merchants", "../../apps/web/src/lib/agentic/test-support/synthetic-merchants.test.ts"),
}
test_day = now.strftime("%Y-%m-%d")
lines = text.split("\n")
start = lines.index("## Agent surface evidence")
for index in range(start, len(lines)):
    line = lines[index]
    if line.startswith("## ") and index > start:
        break
    if line.startswith("| ") and not line.startswith(("| Surface ", "| ---")):
        cells = line[2:-2].split(" | ")
        cells[4] = rev
        if cells[0] in local_tests:
            outcome, label, target = local_tests[cells[0]]
            cells[5] = f"{outcome} {test_day} [{label}]({target})"
        lines[index] = "| " + " | ".join(cells) + " |"
map_path.write_text("\n".join(lines))
print(f"reviewed_at={stamp}\nsource_revision={rev}")
PY
python3 "$RESTAMP"
python3 vps-workers/baci-editorial-context/register_digests.py --write
git diff --stat
```

Expected: the script prints `reviewed_at=…` and `source_revision=` followed by the 40-character commit; the digest tool prints both digests and `updated …/docs/product/baci-capabilities.json`; the diff touches only `docs/product/agent-access-map.md` and `docs/product/baci-capabilities.json`.

- [ ] **Step 6: Commit the re-review**

The gate compares committed changes, so commit before running it.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
coderabbit review --agent -t uncommitted
git add docs/product/baci-capabilities.json docs/product/agent-access-map.md
LEFTHOOK_EXCLUDE=knip git commit -m "docs(capabilities): re-review the agent access map after the surface evidence table" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Run the gate and the freshness check**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
BASE_SHA=$(git rev-parse origin/main) BACI_REGISTER_REQUIRE_FRESH=1 python3 vps-workers/baci-editorial-context/capability_gate.py; echo "gate exit=$?"
python3 vps-workers/baci-editorial-context/register_status.py
(cd apps/web && npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/evidence --testTimeout=120000)
```

Expected: the gate runs its binding suite (about 45 seconds; `Ran 178 tests`), ends with `OK` and prints `gate exit=0` (the test count can change when the suite does; `BACI_REGISTER_REQUIRE_FRESH=1` is what CI sets for pull requests). Lines from the suite's own negative tests, such as `capability gate: cannot compute the changed-path set for base bbbbbbbbbbbb`, appear in the middle and are not failures; the final `OK` and the exit status decide. `register_status.py` prints `fresh`. The vitest run reports `Tests  44 passed (44)`, which proves the table still validates with the revisions in place.

If the gate fails before running its suite:

- `cited change not bound at source_revision: <path>`: a file changed after Step 5. Reset the Task 8 commit and redo from Step 1.
- `capability sources changed without a register re-review` and the base register's `source_revision` is plan 1's commit, which is no longer an ancestor because #3869 was squash-merged: the gate's squash bridge only accepts the change when every cited file is byte-identical between plan 1's head and `origin/main`. If other pull requests changed cited files since, rebase onto the merged `origin/main` (Step 1, case B) and redo; if it still fails, stop and tell the orchestrator.

- [ ] **Step 8: Hand the branch to the orchestrator**

Report the branch name, the code commit ID that `source_revision` names (`git rev-parse HEAD~1`), the register commit ID, and the CodeRabbit status. The orchestrator pushes with commit IDs intact and confirms the pushed IDs equal these.

---

### Task 9: Draft pull request and review request

There is no production check beyond Task 1, because nothing runtime changes.

- [ ] **Step 1: Assemble the pull-request body**

The baseline paragraph is read from the evidence file, so the answers plans 3 and 5 wait for (shared cart and VAT) are in the description without retyping.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
cat > "$WORK/prbaseline.py" <<'PY'
import pathlib
import re

text = pathlib.Path("docs/superpowers/evidence/agentic/2026-10-31-baseline.md").read_text()


def value(label):
    match = re.search(rf"^\| {re.escape(label)}[^|]*\| (.*?) \|$", text, re.M)
    return match.group(1) if match else "unavailable"


def summary(key):
    match = re.search(rf"^{key}=(\S+)$", text, re.M)
    return match.group(1) if match else "unavailable"


print(f"- Shared cart: `premium_features` contains `shared_cart`: {value('shared_cart enrolled')}")
print(f"- VAT: `{value('vat_registration_status')}` at rate {value('vat_rate')}; plan tier `{value('plan_tier')}`")
print(f"- Migration ledger: {value('Ledger rows')} rows against {value('Repository versions')} repository versions; newest 40 absent from the ledger: {value('Newest 40 repository versions absent from the ledger')}")
print(f"- Public profile: plain request {summary('plain_status')}, browser request {summary('browser_status')}; cart declared: {summary('cart_declared')}; checkout declared: {summary('checkout_declared')}")
PY
python3 "$WORK/prbaseline.py" > "$WORK/pr-baseline.md"
cat "$WORK/pr-baseline.md"
```

Expected: four bullet lines (shared cart, VAT, migration ledger, public profile). A value of `unavailable` means Task 1 did not obtain it.

- [ ] **Step 2: Write the body**

Set `CODERABBIT_LINE` to the sentence that is true. The default is the conservative one; use the commented line only if CodeRabbit really ran on the final commits.

````bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
CODERABBIT_LINE='CodeRabbit: skipped (rate-limited or unavailable); no review claimed.'
# CODERABBIT_LINE='CodeRabbit: ran, no valid critical or high findings remain.'
cat > "$WORK/pr-body.md" <<MD
## Summary

Plan 2 of Milestone 0 (roadmap Task 1). Nothing runs differently in production: this pull request adds a read-only production baseline, an access-map table of agent surfaces with explicit unknowns, vendored UCP \`2026-04-08\` schemas with an offline validator, MCP \`2026-07-28\` and ACP \`2026-04-17\` fixtures, a conformance baseline for Baci's UCP builders, and a two-merchant test harness. Every place Baci falls short of a schema or spec is pinned by an \`it.fails\` test that names its finding and the task that will fix it.

## Production baseline (read-only, 31 October 2026)

$(cat "$WORK/pr-baseline.md")

Full record: \`docs/superpowers/evidence/agentic/2026-10-31-baseline.md\`. These answers decide plan 3 (shared-cart gate) and plan 5 (VAT cutover).

## What changed

- Task 1: the baseline evidence file (F8 observations kept separate from the new probes).
- Tasks 2 and 3: \`apps/web/src/lib/agentic/evidence/agent-surface-evidence.ts\` and the "Agent surface evidence" table in \`docs/product/agent-access-map.md\` for the seven surfaces; status cells accept only \`unknown\`, \`not applicable\`, or a dated \`pass\`/\`fail\` with a link or commit.
- Task 4: 61 UCP schema files pinned by commit \`9c9d6fce39\` (the tag was re-cut on 22 October), a manifest of parsed-JSON hashes, and \`ucp-schema-validator.ts\`.
- Task 5: conformance tests for the profile, catalog, cart and order builders.
- Task 6: Baci-authored MCP and ACP fixtures.
- Task 7: the synthetic two-merchant harness.
- Task 8: capability register re-reviewed; the claim and limitations of \`agent-protocols\` are unchanged.

## Known gaps now pinned (flip when fixed)

| Test | Finding | Fixed by |
| --- | --- | --- |
| \`F1\` (two tests) | catalog prices are rounded major units, not minor units | plan 4 |
| \`F3\` | cart line items carry no \`item.price\` | plan 4 |
| \`F7\` | catalog and cart capabilities omit \`schema\` | plan 3 |
| \`F33\` | order totals and unit prices are rounded major units | plan 4 |
| \`F34\` | cart is declared whether or not shared cart is enrolled | plan 3 |
| \`F40\` | MCP server card advertises \`2025-06-18\` | roadmap Task 5 |
| \`F41\` | ACP version \`2026-04-30\` has no release | roadmap Task 5 |
| \`F42\` | a \`pending\` order gets a zero-quantity fulfillment event | plan 4 |

## Checks

- Tests (this plan's nine files): 106 passed, 9 expected failures.
- Web project typecheck (`tsc --noEmit`) and lint on affected packages: passed.
- Capability gate: \`OK\`; register status: \`fresh\`.
- $CODERABBIT_LINE
- Full suites run in CI.

## Follow-ups

- Fix the pinned gaps in the plans above; delete each \`.fails\` as its test starts failing.
- Add checkout-response and webhook conformance, and request-direction (\`ucp_request\`) validation, when plans 4 to 6 touch those paths.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
MD
````

- [ ] **Step 3: Orchestrator opens the draft pull request and requests review**

After the first checkpoint push (Task 1's commit), and again for the final push:

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-baseline-evidence
export WORK="${TMPDIR:-/tmp}/agentic-baseline-2026-10-31"
gh pr create --draft --title "chore(agentic): baseline evidence, UCP/MCP/ACP fixtures and a two-merchant harness" --body-file "$WORK/pr-body.md"
gh pr comment "$(gh pr view --json number --jq .number)" --body "@codex review"
```

In case B, add `--base fix/agentic-remove-admin-client` to `gh pr create`. If the pull request already exists, update its body with `gh pr edit "$(gh pr view --json number --jq .number)" --body-file "$WORK/pr-body.md"` instead. Comment `@codex review` again after the final push (a new head needs a new verdict), keep building while reviews run, and do not merge or deploy without the owner's approval.

---

## Roadmap and tracker updates

For the orchestrator, in a separate docs change; none of this is in the code pull request.

**New findings for the roadmap's findings register.**

| ID | ✓ | Finding | Exposure | Task |
| --- | --- | --- | --- | --- |
| F40 | | The MCP server card advertises `protocolVersion: "2025-06-18"` (`apps/web/src/app/.well-known/mcp/server-card.json/route.ts:15`). The latest MCP revision is `2026-07-28`, which requires `io.modelcontextprotocol/protocolVersion` and `clientCapabilities` in every request's `_meta`, `ttlMs` and `cacheScope` on list results, and removes sessions. Pinned by `it.fails('F40: …')` in `apps/web/src/lib/agentic/fixtures/mcp-2026-07-28/mcp-fixtures.test.ts`. | Advertised | 5 |
| F41 | | `AGENTIC_API_VERSION` (`apps/web/src/lib/agentic/request-integrity.ts:5`) and the ACP discovery default (`acp-discovery-profile.ts:10`, advertised as the highest supported version at line 43) are `2026-04-30`, which has no ACP release; the newest release is `2026-04-17` (ACP repository, commit `9abf303f48`). Verify what OpenAI accepts before Milestone C. Pinned by `it.fails('F41: …')` in `apps/web/src/lib/agentic/fixtures/acp-fixtures.test.ts`. | Advertised | 5 |
| F42 | | `buildUcpOrderResponse` (`apps/web/src/lib/agentic/ucp-response-adapters.ts`) emits a fulfillment event for every order, including the default `pending` status, with quantity 0 for lines nothing has shipped. The UCP order schema requires quantity of at least 1, so a newly placed order's response fails the schema. Found by this plan's conformance baseline; pinned by `it.fails('F42: …')` in `ucp-conformance.test.ts`. | Advertised | 4 |

**Roadmap Task 1 checkboxes this plan satisfies.** The separate rows for seven surfaces with market, currency, products and authentication (the table); `unknown` as an explicit state; the `2026-04-08` UCP and `2026-07-28` MCP fixtures and the ACP `2026-04-17` fixtures; the two-merchant harness with new and used items, price and stock variants, agents, customers and fake Paystack outcomes; the 200 and 403 profile observations recorded separately (F8) with fresh probes. Not satisfied: the harness has no fake webhook for non-Paystack providers, and the Google-accessible profile and WAF behaviour stay unverified because Google's access cannot be probed without spoofing.

**Roadmap Appendix B row.** `| 31 Oct (plan 2) | efe7a20f74 | F40, F41, F42; known-gap tests pin F1, F3, F7, F33, F34 |`

**Tracker.** Tick plan 2's boxes as they complete. Docs-log rows for 31 October already in the tracker: UCP tags re-cut on 22 October so fixtures pin the commit (`v2026-04-08` is `9c9d6fce39`); Google's cart supports create-and-transfer `POST /carts` only, with update and cancel optional in the sandbox; MCP `2026-07-28` is still the latest and Baci's card advertises `2025-06-18` (F40); ACP `2026-04-17` is the newest release while OpenAI's page still shows `2025-09-12` and Baci advertises `2026-04-30` (F41). Add one docs-log row from this plan: `| 31 Oct | Capability gate | Map-cited paths and links are bound sources | Plans 3 to 6 re-review the map when they edit a path the table cites |`. Add to the change log: `| 31 Oct | Plan 2 written; Task 1 production reads await the owner's approval |`. The owner decision "Approve read-only production queries for plan 2's baseline" stays open until Task 1 runs.

**Which task flips which test.**

| Known-gap test | File | Flips when |
| --- | --- | --- |
| F1 (two), F3, F33, F42 | `ucp-conformance.test.ts` | plan 4 converts catalog, cart and order amounts to minor units, adds `item.price`, and removes the zero-quantity event |
| F7, F34 | `ucp-conformance.test.ts` | plan 3 adds `schema` and gates the cart capability on shared-cart enrolment |
| F41 | `acp-fixtures.test.ts` | roadmap Task 5 settles the advertised ACP version |
| F40 | `mcp-fixtures.test.ts` | roadmap Task 5 moves the server card to `2026-07-28` |

---

## Self-review

- **Roadmap coverage:** the seven surface rows with market, currency, eligible products and authentication (Tasks 2, 3, 8); `unknown` explicit and never success (Task 2); the migration-ledger comparison, shared-cart, VAT and plan answers, and the F8 profile observations (Task 1); `2026-04-08` UCP, `2026-07-28` MCP and `2026-04-17` ACP fixtures pinned by commit (Tasks 4 and 6); the two-merchant harness (Task 7); the register and map re-review (Task 8, F31).
- **Design conflicts found in the code, and how the plan handles them:** the roadmap's `AGENTIC_MERCHANT_SLUG` is really `BACI_AGENTIC_MERCHANT_SLUG` with `OPENAI_AGENTIC_MERCHANT_SLUG` as the legacy name; `shared_cart_enabled` is not a column (Task 1 reads `premium_features`); the TypeScript project lists for `tools` and `mcp-server` are pinned and CI typechecks only `src`, so the validator and the MCP fixtures live under `src/lib/agentic`; the JSON Schema's business profile does not require `schema` (F7 uses the platform schema); the schema `$id` of the discovery profile contradicts its own `$ref` paths (registered under a corrected base); Baci never reads a `UCP-Agent` header, so the harness's UCP profile URL is data only; the CI link checker rejects `https://ucp.dev/schemas/...` and `.test` hosts.
- **Ordering:** Task 3's four Local test cells wait for Tasks 5 to 7 and are filled in Task 8, together with every Source revision, because the access-map checker requires every link target to exist. Task 8 is last and is redone after any history change.
- **Names:** `validateAgentSurfaceEvidence`, `formatSurfaceEvidenceErrors`, `parseSurfaceStatus`, `validateUcpDocument`, `UCP_SCHEMAS`, `stubAgenticEnv`, `SYNTHETIC_MERCHANT_A`, `SYNTHETIC_MERCHANT_B`, `buildSyntheticCatalog` and `buildSyntheticPaystackOutcome` are spelled the same in every task.
- **Unverified here:** Task 1's production values and the profile statuses (they need the owner's approval); the affected-package lint, the CI link checker and Knip (configuration read, not run); and the gate's squash-merge bridge if cited files change before #3869 lands.
