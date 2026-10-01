# OgaBassey CWV Measurement Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formally adopt the existing `ogabassey` VPS as one fail-closed, reproducible, shared-host-isolated Core Web Vitals measurement authority and produce the secret-free `H0_RUNNER_ATTESTATION_SHA256` required before any H0 browser campaign.

**Architecture:** Retire Ollama, pin CPUs `2-3` and an `8 GiB` hard memory ceiling to one Dockerized GitHub runner, and constrain all non-measurement user-space work to CPUs `0-1` only while a campaign lease is active. A repository-owned policy, reversible quiescence controller, canonical attestation tool, read-only GitHub auditor App, immutable tag ruleset, and infrastructure-only attestation workflow enforce the contract. The VPS remains shared outside campaigns; during a campaign, deployments, cron-owned workers, and all other GitHub runners are stopped, maintenance timers are paused, existing application containers remain available on CPUs `0-1`, and every slot fails closed on host, cgroup, steal-time, pressure, disk, network, or GitHub-authority drift.

**Tech Stack:** Ubuntu 24.04 KVM VPS, Docker 29/cgroup v2/systemd, GitHub Actions runner `2.335.1`, Node.js `24.18.0`, pnpm `11.7.0`, Google Chrome `150.0.7871.128`, Node `node:test`, GitHub Actions, GitHub REST API, repository rulesets, SHA-256 canonical JSON receipts.

## Global Constraints

- Normative contract: `docs/superpowers/plans/2026-07-13-ogabassey-home-critical-shell-v4.md`, SHA-256 `3503ca9613b6a511b2e37fb3d35b48830d19e8559e7e3c5df136487fce9efdca`.
- Exact implementation base: deployed and browser/Googlebot coherent `f706fc9f309516aa776515e094120039e2431d34`, deployment run `29733124902`, attempt `2`, marker `29733124902_2_f706fc9f309516aa7765`.
- Owner approvals: on 2026-07-20 the repository owner approved (a) the shared-VPS isolation exception and Ollama retirement and (b) the personal-public-repository exact-run exception: the runner remains offline except for one exact owner-dispatched run, a root-owned admission record binds repository/workflow/ref/SHA/run id/attempt, every other job is rejected before steps, guard/credentials remain read-only, and the runner stops plus the host restores on every terminal path.
- Public-repository disclosure decision: this plan retains only non-secret host identity and topology values that are already present in tracked public operational files and are required for byte-exact fail-closed tests; obscurity is not a security boundary. The complete public evidence allowlist is the exact one-member/nested-key Task 6 artifact schema; no other key, member, result, identifier, or digest is approved. Its workflow run id/attempt/public URL and dedicated runner id/name/generation bind the public Actions execution to the one registered measurement identity. Its only resource aggregates are `ollamaCgroupMemoryCurrentBytesBefore`, `ollamaCgroupMemoryCurrentBytesAfter`, `hostMemAvailableBytesBefore`, `hostMemAvailableBytesAfter`, `modelStoreAllocatedBytesBefore`, `rootFreeBytesBefore`, `rootFreeBytesAfter`, and derived `recoveredDiskBytes`; no per-process, environment, command-line, address, route, or unreviewed path/value field is public. Credentials, tokens, raw environment values, full admission/inventory/host/controller receipt bodies, every other live mutable identifier, and unreviewed inventory values remain outside Git.
- Owner/administrator/recovery contact: GitHub repository owner `@ogabasseyy`; host administrator account `bassey`; operational alert destination is the repository's GitHub Actions failure notification channel for `@ogabasseyy` and the exact run URL recorded in every receipt.
- Host: `ogabassey` (`82.29.190.219`), KVM, four AMD EPYC 9354P vCPUs, 15 GiB RAM, cgroup v2 with `cpuset cpu io memory pids`, Docker systemd cgroup driver.
- Every SSH operation uses only Git-mode-`100755` executable `infra/cwv-runner/vps-ssh.sh`, and every command block first requires `test -x` on that exact source-manifest-bound path. The wrapper targets exact `bassey@82.29.190.219:22`, accepts no caller-selected host/user/port/config or proxy/jump option, and invokes `/usr/bin/ssh` with exact `-F /dev/null` so neither user nor system SSH configuration is parsed. Its frozen options include `HostKeyAlgorithms=ssh-ed25519`, `StrictHostKeyChecking=yes`, `CheckHostIP=yes`, `GlobalKnownHostsFile=/dev/null`, the dedicated repository `infra/cwv-runner/ogabassey-known-hosts` as its sole `UserKnownHostsFile`, `ProxyCommand=none`, `ProxyJump=none`, `PermitLocalCommand=no`, `ClearAllForwardings=yes`, `ForwardAgent=no`, `ForwardX11=no`, `ControlMaster=no`, `ControlPath=none`, `ControlPersist=no`, `IdentityAgent=none`, and `Tunnel=no`. The file contains exactly one newline-terminated `82.29.190.219 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMQU7lcSgUHypgyEvjqyQgE6Wh4716Z5ODHkKM/udBvB` row, raw SHA-256 `d73d074536e1beaf206f23994fe01d6116d8e3cfdd8b759be450d8f781567d66`, and approved fingerprint `SHA256:irNFP+fnGB0cPJDSXKvbuxAf8qN1kNfsrc/V1TcXM7o`. Before every connection the wrapper no-follow opens and rehashes that exact regular repository/source-manifest-bound file, runs fixed `/usr/bin/ssh-keygen -lf ... -E sha256`, requires the exact algorithm/fingerprint, and fails before `/usr/bin/ssh` on any byte/path/type/mode/fingerprint drift. Tests stub `/usr/bin/ssh`/`ssh-keygen`, freeze complete argv, and prove no environment, SSH configuration, known-hosts source, alternate algorithm, second key, redirect, multiplexing, forwarding, local command, proxy, or caller option can weaken the pin.
- Shared-host exception: application services may remain available only on CPUs `0-1`; the measurement runner is the only user-space workload allowed on CPUs `2-3` while the campaign lease exists. Shared kernel and egress are accepted only with fail-closed steal-time, PSI, network-idle, and concurrency gates before every request.
- Required workflow selector: exactly `runs-on: [self-hosted, baci-cwv-measurement]`; exactly one registered runner across all online and offline rows may carry the dedicated label, and that same row is online only for its admitted run; no hosted fallback, matrix, alternate label, or second measurement runner.
- Measurement runner resources: CPU set `2-3`, `memory.max=8 GiB`, `memory.swap.max=0`, and `1024` PIDs. The only runner process set is exactly one `Runner.Listener`, at most one `Runner.Worker` while the admitted `--once` job executes, and only policy-approved descendants whose executable hashes and cgroup ancestry are attested; a second listener/worker, an unapproved descendant, or a process outside the measurement cgroup refuses. Exactly one job may run at a time. This is a ceiling, not a reservation or a guarantee of available RAM; admission still requires the live available-memory and PSI gates.
- Dedicated runtime: the CWV daemon/control plane uses only `baci-cwv-containerd.service`, `baci-cwv-docker.service`, Unix sockets and execution state under `/run/baci-cwv/`, data roots under `/srv/baci-cwv/`, and one explicitly created Docker network `baci-cwv-net` whose Linux bridge is `baci-cwv0` on `172.31.255.0/28` with gateway `172.31.255.1`. The dedicated daemon has its default bridge and all iptables/IP-forward/IP-masquerade management disabled; it may create only this receipt-bound network after collision checks pass. The root campaign transaction alone may install the exact comment-tagged forward/return/NAT rules frozen below, after hashing their shared-chain baselines, and must remove only those exact rules before deleting the network. A read-only 2026-07-20 host inventory found only `172.17.0.0/16` through `172.21.0.0/16`; install and every campaign must re-prove no route, address, bridge, network name, socket, service, data-root, firewall-rule, or comment collision. The production Docker/containerd services, sockets, data roots, bridges, networks, shims, and Docker-managed firewall rules are never reconfigured or resource-limited.
- Non-measurement campaign resources: CPUs `0-1`; existing production containers remain running, but every other GitHub runner and all nonessential maintenance timers are stopped for the lease.
- Idle acceptance immediately before every request: no other `Runner.Worker`, Chrome, Chromium, Lighthouse, PSI, or DebugBear process; load-1 `<=0.50`; CPU PSI `full.avg10=0`; I/O PSI `full.avg10<=0.10`; memory PSI `full.avg10=0`; CPU steal `<=0.50%`; available memory `>=6 GiB`; root free disk `>=30 GiB`; aggregate ambient/non-measurement egress and ingress each `<=1 MiB/s` over the preceding ten seconds. A root-owned campaign nftables table counts total externally forwarded traffic, exact-measurement forwarded traffic, host-local external ingress, and host-originated external egress. The campaign classifier is an `inet forward` base chain at priority `-150`; it can set the campaign conntrack mark only for flows whose validated ingress is the runner host-veth/interface identity and whose destination is non-local. Forwarded-total and marked-measurement ingress are counted later in a distinct `inet forward` chain at priority `0`. The total rule requires only `iifname <validated-external-interface>` plus non-local destination so it includes production-container and every other externally forwarded ingress; the measurement-subset rule additionally requires the validated runner-facing output identity and exact campaign conntrack mark. A separate host-local-ingress base chain runs at `inet input` priority `0` with the same external `iifname`; because only packets selected for local delivery traverse `input`, DNATed/forwarded production ingress cannot also increment this counter. Forwarded-total and marked-measurement egress counters remain at `inet postrouting` priority `0` with `oifname <validated-external-interface>` plus `meta iif != 0`, while a separate host-egress counter at that same hook requires `oifname <validated-external-interface>` plus `meta iif 0`. Ambient ingress is `(forwarded ingress total - measurement ingress) + host-local external ingress`; ambient egress is `(forwarded egress total - measurement egress) + host-originated external egress`, using matched monotonic intervals within each declared hook family. Bridge-only/container-local traffic and Docker-embedded container DNS cannot satisfy those external-interface selectors; host-local responses, host-proxied DNS, production-container traffic, and every other host external byte are deliberately ambient exactly once, while direct external DNS forwarded from the runner is measurement traffic and is marked/subtracted like any other runner flow. The sampler makes no external request while collecting live slot samples. Missing/changed interface, veth, container, conntrack-mark, table/chain/rule/handle/selector identity, counter reset/wrap, negative subtraction, classification priority not preceding the forward counter, local/forward mutual-exclusion failure, or unclassified measurement traffic refuses the sample; whole-interface or container-netns counters are never mixed with nftables counters.
- Network-rate conversion is exact and shared by preflight and spanning samples. For each matched monotonic interval whose duration is exactly `thresholds.networkSampleSeconds=10`, use overflow-safe unsigned integer arithmetic to compute `ambientIngressBytes = checkedAdd(checkedSubtract(forwardedIngressDelta, measurementIngressDelta), hostLocalIngressDelta)` and the analogous egress value with host-originated egress. Accept inclusively only when each ambient byte value is `<= checkedMultiply(the corresponding networkRxBytesPerSecondMax or networkTxBytesPerSecondMax, networkSampleSeconds)`; a counter/product overflow, non-ten-second interval, reset, negative subtraction, or unit conversion by division/refloating refuses. Boundary fixtures prove exactly `10 * 1,048,576` bytes over ten seconds passes as `1 MiB/s`, one byte more fails, and `10 MiB/s` traffic (`10 * 10 * 1,048,576` bytes) fails.
- A threshold refusal invalidates that request opportunity; it never lowers the threshold, substitutes another host, or silently contributes a metric row.
- The later H0 slot implementation must bind the fresh pre-request sample and every host sample spanning the navigation through raw-artifact readback. Each spanning sample uses the same validated external-interface selectors, subtracts marked measurement bytes only from totals at the same forward/postrouting hook as their respective total, and then adds the separate host-local-ingress/host-originated-egress counters, so the navigation's own external bytes are excluded while every other externally forwarded, host-local inbound, or host-originated outbound byte remains ambient evidence. Any mid-slot pressure, CPU-set escape, runner overlap, ambient-network threshold breach, interface/veth/mark/counter/selector ambiguity, or accounting failure invalidates the slot; a clean preflight alone is insufficient.
- Ollama retirement is permanent for this program: stop/disable `ollama.service` and `ollama-watchdog.timer`, remove `ollama-loopback`, record package/model inventory hashes without model bytes, and remove `/usr/share/ollama/.ollama` only after the dependency scan is empty. Record measured pre/post cgroup memory, host available memory, and disk bytes; do not promise a fixed RAM recovery. The current model store is approximately `21 GiB`, but the receipt records the actual recovered bytes.
- Repository authority exception: `ogabasseyy/Baci` is a public repository owned by a personal account, so GitHub workflow-restricted self-hosted runner groups are unavailable. The owner explicitly approved the Task 6 offline exact-run controller as the compensating control. Runner registration remains blocked until its fail-closed tests, root ownership, terminal cleanup, and independent review are green.
- Never stop or restart application containers merely to make a metric pass. If CPU/network isolation cannot hold with them available, H0-RUNNER returns `STOPPED_REROUTED`.
- Never run a storefront request, Lighthouse, PSI, DebugBear, or browser navigation in H0-RUNNER. This phase proves infrastructure only.
- Never expose a runner registration token, GitHub App private key, installation token, Actions runtime token, PSI key, PostHog key, cookie, raw environment dump, or Docker socket inside an artifact or committed file.
- Protect `apps/web/src/proxy.ts`, existing migrations, and both `supabase/.temp/cli-latest` paths. H0-RUNNER changes none of them.
- Every created runtime source or shell file has one primary responsibility, a colocated test or static contract test, and at most 300 lines.
- **Plan-only governance commit:** this procedure is prospective only: it does not retroactively govern, rewrite, or validate any already-created H0 implementation commit. Do not rebase an existing H0 implementation commit to insert this plan. First generate a one-record NUL-delimited `H0_PLAN_ONLY_MANIFEST` for this plan alone, with exact `status`, `mode`, raw blob SHA-256, and path, and record its digest. Create a fresh detached review worktree at the pre-plan base, materialize only that exact plan record, regenerate its complete NUL `git status --porcelain=v1 -z`/mode/blob/path projection, and require byte equality with `H0_PLAN_ONLY_MANIFEST` plus no extra changed or untracked path. Run `coderabbit review --agent -t uncommitted -c AGENTS.md` and the independent plan review only from that proved plan-only worktree before any index mutation in the integration worktree. Any plan fix invalidates both reviews and requires a fresh plan record, digest, exact worktree materialization, and reviews. Stage/commit only this plan after an exact source-versus-index manifest equality check. Record that normal docs-only commit as `H0_PLAN_COMMIT_SHA`. This separate governance review never sees or authorizes implementation bytes.
- **Current Task 1-6 cumulative integration rule:** from `H0_PLAN_COMMIT_SHA`, use a clean integration worktree to merge/integrate the existing H0 implementation normally; do not rebase those commits. Generate and freeze a separate NUL-delimited `H0_IMPLEMENTATION_MANIFEST` for the resulting integration, covering only final H0-owned paths under `.github/` and `infra/cwv-runner/`; it must contain no plan path and records exact `status`, `mode`, raw blob bytes/hash, and path. An owner/reviewer independently publishes its literal 64-hex raw SHA-256 as `REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256` out of band; that variable, not the mutable manifest or any companion digest file, is the authority for both worktree and index verifier invocations. Do not enumerate or pre-stage a guessed path count. Immediately before the normal integration commit, its complete staged path/status/mode/blob set must equal this manifest, while the plan path remains unmodified and unstaged. Any implementation fix, docs-plan change, or base-tree change invalidates this manifest, the independently published digest, and all reviews; keep the existing commits intact, restart the clean integration from the appropriate current base, and regenerate the manifest and reviews.
- The authoritative Task 1-6 integration gate runs exactly `node --test --test-concurrency=1 infra/cwv-runner/*.test.mjs .github/scripts/cwv-runner-*.test.mjs`, both normal and tools-worker web typechecks, full web lint, Bash syntax, ShellCheck, actionlint, the manifest-scoped line-limit check below, protected-marker, and `git diff --check` checks. The line-limit check reads only the frozen `H0_IMPLEMENTATION_MANIFEST`, validates and hash-verifies every canonical four-field NUL record, and applies the `<=300` limit only to its closed source/test/runtime/workflow predicate; it must not substitute a directory walk:

  ```bash
  : "${REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256:?owner/reviewer must supply the independently reviewed literal}"
  readonly REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256
  case "$REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256" in (*[!0-9a-f]*|'') exit 1;; esac
  test "${#REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256}" = 64
  : "${H0_MANIFEST_VIEW:?set exactly worktree or index before each verifier invocation}"
  readonly H0_MANIFEST_VIEW
  case "$H0_MANIFEST_VIEW" in (worktree|index) ;; (*) exit 1;; esac
  export REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256
  export H0_MANIFEST_VIEW
  H0_IMPLEMENTATION_MANIFEST=.superpowers/sdd/h0-implementation.manifest node <<'NODE'
  const { createHash } = require('node:crypto');
  const { execFileSync } = require('node:child_process');
  const { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } = require('node:fs');
  const { relative, resolve, sep } = require('node:path');
  const fail = (message) => { throw new Error(`H0 implementation manifest: ${message}`); };
  const git = '/usr/bin/git';
  const runGit = (args, options = {}) => execFileSync(git, args, { maxBuffer: 64 * 1024 * 1024, ...options });
  const reviewedManifestSha256 = process.env.REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256;
  if (!/^[a-f0-9]{64}$/.test(reviewedManifestSha256 ?? '')) fail('missing or malformed independently reviewed manifest digest');
  const manifest = readFileSync(process.env.H0_IMPLEMENTATION_MANIFEST);
  if (createHash('sha256').update(manifest).digest('hex') !== reviewedManifestSha256) fail('raw manifest digest differs from independently reviewed literal');
  const fields = manifest.toString('utf8').split('\0');
  if (fields.pop() !== '' || fields.length === 0 || fields.length % 4 !== 0) fail('malformed records');
  const view = process.env.H0_MANIFEST_VIEW;
  if (view !== 'worktree' && view !== 'index') fail('view must be worktree or index');
  const planPath = 'docs/superpowers/plans/2026-07-14-ogabassey-cwv-measurement-runner.md';
  const paths = new Set();
  const records = [];
  const hasSafeSegments = (path) => path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && /^[A-Za-z0-9._@+-]+$/.test(segment));
  const isLineLimitedCodeOrContract = (path) => path === 'infra/cwv-runner/Dockerfile' || /^(?:(?:\.github|infra\/cwv-runner)\/[^\0\n]+\.(?:mjs|js|ts|tsx|sh)|\.github\/workflows\/[^\0\n]+\.ya?ml)$/.test(path);
  for (let index = 0; index < fields.length; index += 4) {
    const [status, mode, hash, path] = fields.slice(index, index + 4);
    if (!/^[AM]$/.test(status) || !/^(100644|100755)$/.test(mode) || !/^[a-f0-9]{64}$/.test(hash) || !/^(?:\.github\/|infra\/cwv-runner\/)[^\0\n]+$/.test(path) || !hasSafeSegments(path) || paths.has(path)) fail('invalid record');
    if (records.length && Buffer.compare(Buffer.from(records.at(-1).path), Buffer.from(path)) >= 0) fail('noncanonical record order');
    paths.add(path);
    records.push({ status, mode, hash, path });
  }
  const statusArgs = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'];
  const porcelainBefore = view === 'index' ? runGit(statusArgs) : null;
  const indexTreeBefore = view === 'index' ? runGit(['write-tree'], { encoding: 'utf8' }).trim() : null;
  if (indexTreeBefore !== null && !/^[a-f0-9]{40,64}$/.test(indexTreeBefore)) fail('invalid index tree');
  const porcelain = runGit(statusArgs);
  if (porcelainBefore !== null && !porcelainBefore.equals(porcelain)) fail('status drifted before index snapshot');
  const changed = porcelain.length === 0 ? [] : porcelain.subarray(0, -1).toString('utf8').split('\0');
  if (porcelain.length !== 0 && porcelain.at(-1) !== 0) fail('unterminated status');
  if (changed.length !== records.length) fail('changed-path count differs');
  const changedByPath = new Map();
  for (const entry of changed) {
    if (entry.length < 4 || entry[2] !== ' ') fail('malformed status');
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path === planPath) fail('plan path must remain clean and unstaged');
    if (!paths.has(path) || changedByPath.has(path)) fail('unexpected or duplicate changed path');
    changedByPath.set(path, code);
  }
  const stableStat = (stat) => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
  const sameNode = (left, right) => left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
  const canonicalWorktreeRoot = realpathSync.native(runGit(['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const assertSafeWorktreeParents = (path) => {
    const parts = path.split('/');
    const rootStat = lstatSync(canonicalWorktreeRoot, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync.native(canonicalWorktreeRoot) !== canonicalWorktreeRoot) fail('unsafe canonical worktree root');
    let current = canonicalWorktreeRoot;
    const parentIdentity = [[current, rootStat.dev, rootStat.ino, rootStat.mode].map(String).join(':')];
    for (const part of parts.slice(0, -1)) {
      current = resolve(current, part);
      const relation = relative(canonicalWorktreeRoot, current);
      if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || resolve(canonicalWorktreeRoot, relation) !== current) fail(`worktree parent escapes canonical root: ${path}`);
      const stat = lstatSync(current, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(current) !== current) fail(`unsafe worktree parent: ${path}`);
      parentIdentity.push([current, stat.dev, stat.ino, stat.mode].map(String).join(':'));
    }
    const filename = resolve(canonicalWorktreeRoot, path);
    const filenameRelation = relative(canonicalWorktreeRoot, filename);
    if (!filenameRelation || filenameRelation === '..' || filenameRelation.startsWith(`..${sep}`) || resolve(canonicalWorktreeRoot, filenameRelation) !== filename) fail(`worktree file escapes canonical root: ${path}`);
    return { filename, parentIdentity: parentIdentity.join('\0') };
  };
  const readWorktreeFile = (path) => {
    if (typeof constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW is unavailable');
    const parentBefore = assertSafeWorktreeParents(path);
    let descriptor;
    try {
      descriptor = openSync(parentBefore.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = fstatSync(descriptor, { bigint: true });
      if (!before.isFile()) fail(`unsafe worktree path: ${path}`);
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor, { bigint: true });
      if (stableStat(before) !== stableStat(after)) fail(`worktree path drift: ${path}`);
      const leaf = lstatSync(parentBefore.filename, { bigint: true });
      if (!leaf.isFile() || leaf.isSymbolicLink() || !sameNode(leaf, before)) fail(`worktree leaf drift: ${path}`);
      const parentAfter = assertSafeWorktreeParents(path);
      if (parentAfter.filename !== parentBefore.filename || parentAfter.parentIdentity !== parentBefore.parentIdentity) fail(`worktree parent drift: ${path}`);
      return { bytes, mode: (before.mode & 0o111n) !== 0n ? '100755' : '100644' };
    } catch (error) {
      fail(`cannot safely read worktree path ${path}: ${error.message}`);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  };
  const readIndexSnapshotFile = (tree, path) => {
    const entry = runGit(['ls-tree', '-z', tree, '--', path]);
    if (entry.length === 0 || entry.at(-1) !== 0) fail(`missing index snapshot record: ${path}`);
    const records = entry.subarray(0, -1).toString('utf8').split('\0');
    if (records.length !== 1) fail(`ambiguous index snapshot record: ${path}`);
    const tab = records[0].indexOf('\t');
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})$/.exec(records[0].slice(0, tab));
    if (tab < 1 || !match || records[0].slice(tab + 1) !== path) fail(`invalid index snapshot record: ${path}`);
    return { bytes: runGit(['cat-file', 'blob', match[2]]), mode: match[1] };
  };
  const actual = [];
  for (const record of records) {
    const expectedCode = view === 'worktree'
      ? (record.status === 'A' ? '??' : ' M')
      : `${record.status} `;
    if (changedByPath.get(record.path) !== expectedCode) fail(`status mismatch: ${record.path}`);
    const source = view === 'worktree'
      ? readWorktreeFile(record.path)
      : readIndexSnapshotFile(indexTreeBefore, record.path);
    const { bytes, mode } = source;
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (mode !== record.mode || hash !== record.hash) fail(`mode or hash mismatch: ${record.path}`);
    const text = bytes.toString('utf8');
    const lineCount = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (isLineLimitedCodeOrContract(record.path) && lineCount > 300) fail(`line limit: ${record.path}`);
    actual.push(record.status, mode, hash, record.path);
  }
  const actualManifest = Buffer.from(`${actual.join('\0')}\0`);
  if (!actualManifest.equals(manifest)) fail('complete status/mode/hash/path projection differs');
  if (view === 'index') {
    const indexTreeAfter = runGit(['write-tree'], { encoding: 'utf8' }).trim();
    const porcelainAfter = runGit(statusArgs);
    if (indexTreeAfter !== indexTreeBefore || !porcelainAfter.equals(porcelain)) fail('index tree or status drifted during verification');
  }
  NODE
  ```

  Run that exact verifier in two fresh Bash invocations with the owner/reviewer-supplied `REVIEWED_H0_IMPLEMENTATION_MANIFEST_SHA256` exported both times: first set `H0_MANIFEST_VIEW=worktree` immediately before review, then set `H0_MANIFEST_VIEW=index` after staging only the frozen manifest paths and immediately before the integration commit. The readonly out-of-band digest is revalidated against the raw mutable manifest before either invocation parses it. Then run one non-overlapping `coderabbit review --agent -t uncommitted -c AGENTS.md` and a fresh independent Sol exact-diff review of the frozen implementation manifest; fix valid critical/high/major findings and regenerate the manifest/digest before staging. This H0 manifest intentionally admits only additions and modifications; any deletion, rename, mixed index/worktree state, unexpected staged or untracked path, plan-path change, or raw-byte/mode/hash drift refuses and requires a fresh governed plan before that change class can be accepted. A review failure or rate limit blocks the implementation commit.
- **CodeRabbit provider-cap fallback:** first request one whole-manifest review. Only if CodeRabbit rejects before analysis with its `too_many_files` provider-cap result may the integration owner partition the already frozen canonical NUL-delimited implementation manifest. `infra/cwv-runner/review-manifest-batches.mjs` is the sole partitioner: it parses exact four-field NUL records, validates each `A|M` status, `100644|100755` mode, lowercase 64-hex raw blob hash, and safe unique UTF-8 path; rejects noncanonical input; and applies the checked-in, closed, ordered H0 domain profile. Every manifest path must match exactly one profile domain: an unmatched or ambiguously matched path refuses. Within each domain it canonical-sorts records by path and emits batches of at most `60` records. It then recanonicalizes the complete nonoverlapping status/mode/blob/path union across all domains and requires byte equality with `H0_IMPLEMENTATION_MANIFEST`; no concatenation or batch-emission order is authority. Its colocated tests include malformed/truncated records, duplicate paths, newline-containing paths, noncanonical input, unmatched/ambiguous domain paths, per-domain sorting, the `60 + 1` boundary, and complete recanonicalized union equality. For each batch, create a fresh detached review worktree at `H0_PLAN_COMMIT_SHA`, materialize only that batch's exact status/mode/blob bytes, regenerate its NUL `git status --porcelain=v1 -z`/blob-hash projection, and require byte equality with the batch manifest plus no extra changed or untracked path. Run `coderabbit review --agent -t uncommitted -c AGENTS.md` sequentially—never concurrently—once per batch; retain every result and require the recanonicalized complete nonoverlapping status/mode/blob/path union equals `H0_IMPLEMENTATION_MANIFEST` with no overlap or omission. No alternate invocation is asserted equivalent to this repository-mandated command. Any non-`too_many_files` provider error, rate limit, failed materialization, manifest/status/mode/blob mismatch, unmatched/ambiguous path, duplicate/omitted entry, or unresolved valid finding blocks the commit. Any fix invalidates every batch result: regenerate the implementation manifest/digest, rerun the authoritative Task 1-6 integration gate, and retry whole-manifest review before the same sole fallback. The independent Sol exact-diff review is always full and unpartitioned.
- This governance plan is committed only through the plan-only procedure above. It is never implicitly staged by the Task 1-6 implementation commit, and the implementation manifest never contains it.
- Existing PR #2686 is not adopted as H0-RUNNER: its stale head `67585ec88f22a18c518fd5d349a097e2ed1f60ff` provides local measurement tooling but no authoritative infrastructure workflow. Record it as superseded for H0-RUNNER and reconsider individual parser modules only in the later H0 plan.

## Frozen Supply-Chain Inputs

| Component | Immutable input |
|---|---|
| Ubuntu | full reference `ubuntu@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90`; official archive/security snapshot id `20260720T000000Z` |
| GitHub runner | `v2.335.1`, exact URL `https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz`, archive SHA-256 `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf` |
| Runner secret-input contract | `actions/runner@v2.335.1` exact source URL `https://raw.githubusercontent.com/actions/runner/v2.335.1/src/Runner.Listener/CommandSettings.cs`, SHA-256 `937f6552579f7d1eeb0a6d0201586781eb3e2e5ea2ab3878429076560e0cab08`; `ACTIONS_RUNNER_INPUT_TOKEN` is masked, copied to the internal arg map, then removed from the process environment |
| Node | `v24.18.0`; Linux x64 exact URL `https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz`, SHA-256 `55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742`; owner-workstation Darwin arm64 exact URL `https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.xz`, SHA-256 `4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6` |
| pnpm | `11.7.0`, official npm tarball `https://registry.npmjs.org/pnpm/-/pnpm-11.7.0.tgz`, SHA-256 `deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee`, npm integrity `sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==` |
| Chrome | `150.0.7871.128-1`, exact URL `https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_150.0.7871.128-1_amd64.deb`, Debian SHA-256 `83ed59c85878ebb8fa53915ebe7066cafc58d1c04c1c95449486e6f9d99a1efb` |
| Artifact redirect origins | runner: `https://github.com`, `https://release-assets.githubusercontent.com`; runner CommandSettings source: `https://raw.githubusercontent.com`; Node: `https://nodejs.org`; pnpm: `https://registry.npmjs.org`; Chrome: `https://dl.google.com`. No other initial or final origin is permitted. |
| Checkout action | existing repository pin `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` |
| Upload action | `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` |
| Download action | `actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0` |
| App-token action for later H0 consumption | `actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1` |
| Owner dispatcher GitHub CLI | `gh v2.93.0`, macOS arm64 ZIP SHA-256 `a86be4e0a86c26456cf71177d6572d6f1165cf1679e532b72f7f15918ee51fd2` |
| Runner vendor provenance | GitHub release API asset id `442283019`, exact name `actions-runner-linux-x64-2.335.1.tar.gz`, size `225628509`, and digest `sha256:4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf` |
| Node vendor provenance | official `SHASUMS256.txt` SHA-256 `3927bab574a00ca0560c9583fe19655ba19603a1c5851414e4325d34ac50e469`, detached signature SHA-256 `d771440acfe010e7510a3c01d248525f771daa9cf75dae5784c97ea2b08d9393`, and active-key `pubring.kbx` from `nodejs/release-keys` commit `b28073028e6d6855cfb53bf7fa0137599c01f967`, SHA-256 `8e6f89521a0694e445f42decd022f48369c634f1b5bcb5975135b69c88629ae8` |
| pnpm vendor provenance | exact registry version-document URL `https://registry.npmjs.org/pnpm/11.7.0` whose selected `version`, `dist.tarball`, `dist.integrity`, and `dist.shasum` must equal policy; frozen `dist.shasum` is `bea54364524dadf0a42dae28dbfeeab25ff177e5` |
| Chrome vendor provenance | signed APT `InRelease` SHA-256 `103b34e58da0ab8d2150b921d827c730f98de9329f1b5c393fa41279dc78feca`, referenced `Packages.gz` SHA-256 `e46bfc093b1b728d0e7a6e5419b90be8672f9b113ddaf50b21a910f40c583173`, and Google Linux signing-key bytes SHA-256 `54dea5f6c2a26091578cf52a999cebc6b64df478d37ad4dce96376b711e3b27c`; the signed package stanza must name the exact file/version/architecture and artifact SHA-256 |
| Owner CLI vendor provenance | exact archive URL `https://github.com/cli/cli/releases/download/v2.93.0/gh_2.93.0_macOS_arm64.zip`, extracted binary SHA-256 `a38e8ea1b9794a445a1ce746392e36111ca00a3242a6447b49cd4c162cb191a7`, and official `gh_2.93.0_checksums.txt` SHA-256 `f62a3bc9dedc88262c9c2b56eb653cb3ded6bde8076bdbb151f4cce9c8729da5` |
| VPS SSH host key | exact dedicated known-hosts row `82.29.190.219 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMQU7lcSgUHypgyEvjqyQgE6Wh4716Z5ODHkKM/udBvB`, raw file SHA-256 `d73d074536e1beaf206f23994fe01d6116d8e3cfdd8b759be450d8f781567d66`, fingerprint `SHA256:irNFP+fnGB0cPJDSXKvbuxAf8qN1kNfsrc/V1TcXM7o`; no other host key, host, user, port, config, proxy, or known-hosts source is accepted |

## File Map

### Repository policy and verification

- Create `infra/cwv-runner/policy.json`: the immutable shared-host, resource, threshold, label, supply-chain, ruleset, and receipt contract.
- Create `infra/cwv-runner/policy.schema.mjs`: validates `policy.json` without reading secrets.
- Create `infra/cwv-runner/policy.schema.test.mjs`: covers valid policy and every fail-closed boundary.
- Create `infra/cwv-runner/canonical-json.mjs`: deterministic object-key canonicalization and SHA-256.
- Create `infra/cwv-runner/canonical-json.test.mjs`: proves stable hashing and rejects unsupported JSON values.
- Create `.github/scripts/cwv-runner-authority.mjs`: verifies live runner inventory, artifact retention, App permissions, ruleset readback, and attestation identity.
- Create `.github/scripts/cwv-runner-authority.test.mjs`: tests missing/offline/idle/ambiguous/wrong-label/over-scoped/ruleset/retention/drift cases.
- Create `.github/scripts/cwv-runner-contract.test.mjs`: freezes workflow selector, pins, permissions, no-network H0-RUNNER boundary, file limits, and no hosted fallback.
- Modify `.github/workflows/deploy.yml`: include `infra/cwv-runner/**` in the automatic web/prebuilt deployment filter so PR A's exact merge SHA receives the required production deployment/coherence run.

### Container and host controls

- Create `infra/cwv-runner/Dockerfile`: pinned runner/Node/pnpm/Chrome image with an unprivileged `runner` user.
- Create `infra/cwv-runner/build-image.mjs` and `infra/cwv-runner/build-image.test.mjs`: schema-validated no-shell build wrapper that derives every supply-chain build argument from `policy.json` and statically rejects Dockerfile duplication.
- Create `infra/cwv-runner/download-artifact.sh` and `infra/cwv-runner/download-artifact.test.mjs`: generic redirect-limited HTTPS downloader that enforces the policy-derived initial/final origin set and checksum before atomic publication.
- Create `infra/cwv-runner/supply-chain-provenance.mjs` and `infra/cwv-runner/supply-chain-provenance.test.mjs`: policy-driven verifier for GitHub release-asset metadata, Node signed checksums, pnpm registry SRI metadata, Chrome signed APT metadata, and the owner CLI checksum manifest.
- Create `infra/cwv-runner/verify-node-bootstrap.sh` and `infra/cwv-runner/verify-node-bootstrap.test.mjs`: shell/`gpgv` bootstrap that authorizes the pinned Node archive before any Node interpreter exists.
- Create `infra/cwv-runner/verify-apt-snapshot.sh` and `infra/cwv-runner/verify-apt-snapshot.test.mjs`: isolated shell/`gpgv` verifier for signed snapshot indexes, exact selected Debian package rows, and a canonical package receipt before APT installation.
- Create `infra/cwv-runner/entrypoint.sh`: tiny normal-mode Bash wrapper that immediately `exec`s the pinned Node lifecycle; registration never invokes this wrapper.
- Create `infra/cwv-runner/entrypoint.mjs`: shared pinned-Node lifecycle. Normal mode holds then launches the sealed listener once; registration mode is invoked through Docker's exact direct-Node entrypoint override, waits for root token-unmount proof, then same-PID `execve`s the copied Listener configure process.
- Create `infra/cwv-runner/entrypoint.test.mjs`: static and fake-command tests for the distinct normal Bash-to-Node and registration direct-Node lifecycles, registration-only token access, root-owned pre-exec token deletion barrier, fail-closed egress release, no secret logging, and persistent registration.
- Create `infra/cwv-runner/isolation-probe.sh` and `infra/cwv-runner/isolation-probe.test.mjs`: no-network disposable container/cgroup validation that never starts `Runner.Listener`.
- Create `infra/cwv-runner/registration-egress-probe.mjs` and `infra/cwv-runner/registration-egress-probe.test.mjs`: one secret-free policy-bound DNS/TLS connectivity proof used only before first registration.
- Create `infra/cwv-runner/direct-listener-conformance.mjs` and `infra/cwv-runner/direct-listener-conformance.test.mjs`: pinned actual-Listener configure/run protocol and lifecycle conformance harness plus fake-listener refusal tests.
- Create `infra/cwv-runner/runner-identity-gate.mjs` and `infra/cwv-runner/runner-identity-gate.test.mjs`: sealed, secret-free first-job-step verifier for the exact runner/admission/run identity before checkout or token creation.
- Create `infra/cwv-runner/campaign-quiesce.sh`: acquire an exclusive lease, snapshot reversible host state, constrain cgroups, stop other runners/timers, and start the measurement unit.
- Create `infra/cwv-runner/campaign-restore.sh`: consume the lease receipt once and restore exact prior runner/timer/cgroup/container state.
- Create `infra/cwv-runner/campaign-state.mjs`: validates and hashes the quiescence/restore state document.
- Create `infra/cwv-runner/campaign-state.test.mjs`: red/green tests for stale lease, double restore, missing state, and mismatched host.
- Create `infra/cwv-runner/cron-inventory.json`: exact whole-crontab hash plus line hashes, runner roots, commands, and campaign dispositions for every active user cron entry.
- Create `infra/cwv-runner/host-attest.sh`: collect only the approved secret-free machine/network/service and sealed-host-runner fields.
- Create `infra/cwv-runner/host-attestation.mjs` and `infra/cwv-runner/host-attestation.test.mjs`: canonical host/runtime identity normalization, digest construction, and refusal tests.
- Create `infra/cwv-runner/container-attest.sh`: collect only pinned image/runtime identity inside a credential-free `--network=none` probe.
- Create `infra/cwv-runner/container-attestation.test.mjs`: prove runtime paths are collected only inside the image and that the probe receives no network, runner credentials, hook, or admission record.
- Create `infra/cwv-runner/host-idle-check.sh`: enforce the frozen pressure/load/steal/disk/network/concurrency thresholds.
- Create `infra/cwv-runner/identity-contract.json`: exact raw command argv, normalized field mapping, frozen expectation, and refusal rule for every stable host identity field.
- Create `infra/cwv-runner/host-scripts.test.mjs`: PATH-stubbed tests for all refusal dimensions and reversible service/timer handling.
- Create `infra/cwv-runner/baci-cwv-host-sampler.service`: essential host-side oneshot that atomically refreshes secret-free live evidence.
- Create `infra/cwv-runner/baci-cwv-host-sampler.timer`: continuous ten-second network/pressure samples with a two-second inactive interval, active only while a campaign lease exists.
- Create `infra/cwv-runner/baci-cwv-measurement.service`: systemd unit that starts exactly one pinned container in `cwv-measurement.slice`.
- Create `infra/cwv-runner/baci-cwv-containerd.service`, `infra/cwv-runner/baci-cwv-docker.service`, `infra/cwv-runner/containerd.toml`, and `infra/cwv-runner/daemon.json`: dedicated disabled CWV-only container control plane with isolated sockets, roots, default bridge disabled, one transactionally created exact network, and no production-daemon dependency.
- Create `infra/cwv-runner/cwv-measurement-control.slice`: hard CPU/memory/swap/PID/I/O ceiling for the dedicated daemons and import client.
- Create `infra/cwv-runner/cwv-measurement.slice`: CPU/memory/accounting policy for CPUs `2-3`.
- Create `infra/cwv-runner/source-manifest.mjs` and `infra/cwv-runner/source-manifest.test.mjs`: freeze and verify NUL-safe changed-path status/blob manifests plus the separately closed full `infra/cwv-runner/` source-archive projection across squash, rebase, or merge results without assuming ancestry.
- Create `infra/cwv-runner/seal-source.sh` and `infra/cwv-runner/seal-source.test.mjs`: root-side, fixed-tool verifier that accepts only a previously root-copied exact-digest helper plus the manifest-bound source archive and atomically seals either a temporary scan tree or `/srv/baci-cwv/source/<merge-sha>/` before any repository script executes.
- Create `infra/cwv-runner/install.sh`: idempotent host installation, locked account/directory creation, off-host archive import, service install, and receipt locations.
- Create `infra/cwv-runner/install.test.mjs`: root transaction, registration barrier, import, recovery, and terminal cleanup contract tests.
- Create Git-mode-`100755` `infra/cwv-runner/vps-ssh.sh`, `infra/cwv-runner/vps-ssh.test.mjs`, and `infra/cwv-runner/ogabassey-known-hosts`: the sole executable SSH transport, its fail-closed argv/host-key/mode tests, and the exact one-row Ed25519 authority file.
- Create `infra/cwv-runner/retire-ollama.sh`: dependency-scan-first, reversible metadata capture, service/timer/container retirement, and model-byte deletion.
- Create `infra/cwv-runner/ollama-active-inventory.json`: exact reviewed active unit/drop-in/environment/proxy/container/cron/process inventory and dispositions used by retirement apply.
- Create `infra/cwv-runner/exact-run-controller.sh` and `infra/cwv-runner/job-start-hook.sh`: owner-approved root-owned offline-runner controller and GitHub job-start admission hook.
- Create `infra/cwv-runner/owner-dispatch.sh`: owner-workstation coordinator using the existing authenticated pinned GitHub CLI; no Actions-write credential is copied to the VPS.
- Create `infra/cwv-runner/verify-owner-cli.sh` and `infra/cwv-runner/verify-owner-cli.test.mjs`: development-Mac-only, host-Node-independent verifier for the already-downloaded policy-pinned GitHub CLI checksum file, archive, extracted binary, and version.
- Create `infra/cwv-runner/task9-bootstrap-bundle.mjs`, `infra/cwv-runner/task9-bootstrap-bundle-cli.mjs`, `infra/cwv-runner/task9-held-file.mjs`, `infra/cwv-runner/task9-node-archive.mjs`, `infra/cwv-runner/task9-output-directory.mjs`, `infra/cwv-runner/task9-fsync-directory.mjs`, and their colocated tests: the generator is the sole post-merge production composer for the fixed Task 9 bootstrap bundle and detached review envelope, the closed scalar-flag CLI is its only production entrypoint, held-descriptor reads reject input replacement, the prepared Node bytes are re-extracted from the policy-hashed archive before publication, payload/envelope directory entries are durably synced, and successful output publication remains bound to the exclusively created directory identity. A post-creation failure intentionally retains that owner-only directory for later reviewed reconciliation; it never performs pathname-recursive automatic cleanup. The fixed seven-file payload intentionally excludes `task9-bootstrap-runtime.mjs`: its exact source-archive row is hash-bound as `runtime.launcherSha256`, and the dispatcher copies it only from the same exact manifest-bound source before the launcher revalidates its own bytes against that envelope value. Fixtures and ad hoc shell/JSON assembly are never production authority.
- Create `infra/cwv-runner/task9-bootstrap.mjs` and `infra/cwv-runner/task9-bootstrap.test.mjs`: self-contained post-merge bootstrap verifier that uses the independently hash-pinned Darwin Node executable to validate the canonical bootstrap receipt, final manifest/digests, and complete normalized source archive before any checkout program or GitHub credential is used.
- Create `infra/cwv-runner/owner-api-transport.mjs` and `infra/cwv-runner/owner-api-transport.test.mjs`: policy-pinned Darwin Node transport for the finite Task 9 GitHub REST state machine, redirect-disabled authenticated reads/writes, and transaction-bound manual pagination.
- Create `infra/cwv-runner/exact-run-guard.test.mjs`: fail-closed tests for repository/workflow/ref/SHA/run-id/attempt binding, file ownership, offline default, terminal cleanup, and workflow-label exclusivity.
- Create `infra/cwv-runner/campaign-watchdog.sh`, `infra/cwv-runner/baci-cwv-campaign-watchdog@.service`, and `infra/cwv-runner/campaign-watchdog.test.mjs`: independent root-owned systemd cleanup after controller death, timeout, or reboot.

### GitHub authority and evidence

- Modify `.github/actionlint.yaml`: add only `baci-cwv-measurement` to known self-hosted labels.
- Modify `.github/workflows/actionlint.yml`: include the new label in the deprecation guidance and trigger on `.github/actionlint.yaml`.
- Create `.github/workflows/cwv-runner-attestation.yml`: infrastructure-only manual verifier on the dedicated runner, no storefront network request.
- Create `docs/ops/cwv-measurement-runner.md`: installation, campaign lease, rollback, incident, replacement-generation, and secret-handling runbook.
- Create `docs/ops/evidence/h0-runner-attestation.json`: canonical secret-free identity produced only after live verification.
- Create `docs/ops/evidence/h0-runner-receipt.md`: owner approval, live proof, tests, App/ruleset ids and digests, artifact retention, and final attestation hash.

---

### Task 1: Freeze the shared-host runner policy and canonical receipt format

**Files:**
- Create: `infra/cwv-runner/policy.json`
- Create: `infra/cwv-runner/policy.schema.mjs`
- Create: `infra/cwv-runner/policy.schema.test.mjs`
- Create: `infra/cwv-runner/canonical-json.mjs`
- Create: `infra/cwv-runner/canonical-json.test.mjs`

**Interfaces:**
- Produces `parseRunnerPolicy(value): RunnerPolicy`, `deriveCampaignMark(transactionId): number`, `canonicalJson(value): string`, and `canonicalSha256(value): string`; the CLI exposes the same helper only as `policy.schema.mjs campaign-mark <transaction-id>`.
- `policy.json` is the only source for the normative contract path/hash, implementation base, deployment run/attempt/marker, labels, resource partitions, thresholds, immutable software inputs, ruleset/network-accounting namespaces, and its own policy schema version. The canonical attestation/receipt shape is frozen later by Tasks 4, 6, and 9; Task 1 does not invent an undeclared receipt-schema field.
- Digest terminology is closed: `policyFileSha256` and `/srv/baci-cwv/sealed/policy.sha256` always mean raw SHA-256 over the exact reviewed `policy.json` file bytes; `policyCanonicalSha256` alone means SHA-256 over `canonicalJson(parsedPolicy)`. Every authorization and embedded-file comparison uses the raw digest and exact bytes. The canonical digest is supplementary semantic evidence only. An unsuffixed “policy digest” in later steps means `policyFileSha256` unless the field is explicitly named `policyCanonicalSha256`.
- Later shell scripts consume individual values through `node infra/cwv-runner/policy.schema.mjs get <json-pointer>`; they do not duplicate constants.
- Every later service/template, Docker argv builder, verifier, and cumulative contract test must either obtain CPU sets, memory/swap bytes, and PID limits through that accessor or prove exact parsed-value equality against the generated bytes. Unchecked hardcoded resource constants are forbidden.

- [ ] **Step 1: Write canonicalization and policy RED tests**

Create tests that assert:

```js
assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
assert.equal(canonicalSha256({ b: 2, a: 1 }), canonicalSha256({ a: 1, b: 2 }));
assert.throws(() => canonicalSha256({ value: undefined }), /unsupported JSON value/);
assert.deepEqual(policy.authority, {
  normativeContractPath: 'docs/superpowers/plans/2026-07-13-ogabassey-home-critical-shell-v4.md',
  normativeContractSha256: '3503ca9613b6a511b2e37fb3d35b48830d19e8559e7e3c5df136487fce9efdca',
  implementationBaseSha: 'f706fc9f309516aa776515e094120039e2431d34',
  deploymentRunId: 29733124902,
  deploymentRunAttempt: 2,
  deploymentMarker: '29733124902_2_f706fc9f309516aa7765',
});
assert.equal(policy.runner.labels.join(','), 'self-hosted,Linux,X64,baci-cwv-measurement');
assert.deepEqual(policy.processAllowSet, {
  schemaVersion: 1,
  receiptBinding: 'image-process-map-v1',
  phases: ['held', 'listener-idle', 'assigned', 'cleanup'],
  executables: {
    bash: {path: '/usr/bin/bash', maxInstancesByPhase: [1, 0, 1, 0]},
    runtimeNode: {path: '/opt/node/bin/node', maxInstancesByPhase: [1, 1, 1, 1]},
    listener: {path: '/opt/runner/bin/Runner.Listener', maxInstancesByPhase: [0, 1, 1, 1]},
    worker: {path: '/opt/runner/bin/Runner.Worker', maxInstancesByPhase: [0, 0, 1, 1]},
    pluginHost: {path: '/opt/runner/bin/Runner.PluginHost', maxInstancesByPhase: [0, 0, 1, 1]},
    actionNode: {path: '/opt/runner/externals/node24/bin/node', maxInstancesByPhase: [0, 0, 1, 1]},
    git: {path: '/usr/bin/git', maxInstancesByPhase: [0, 0, 1, 0]},
    gitRemoteHttps: {path: '/usr/lib/git-core/git-remote-https', maxInstancesByPhase: [0, 0, 1, 0]},
  },
});
assert.deepEqual(policy.resources, {
  measurementCpuSet: '2-3',
  otherCpuSet: '0-1',
  memoryBytes: 8589934592,
  memorySwapBytes: 0,
  shmBytes: 1073741824,
  pidsLimit: 1024,
});
assert.deepEqual(policy.installationImport, {
  workerServices: ['baci-cwv-docker.service', 'baci-cwv-containerd.service'],
  cpuSet: '2-3',
  cpuQuotaPercent: 100,
  memoryBytes: 2147483648,
  memorySwapBytes: 0,
  pidsLimit: 256,
  ioWeight: 10,
  sampleSeconds: 2,
});
assert.deepEqual(policy.dedicatedRuntime, {
  dockerService: 'baci-cwv-docker.service',
  containerdService: 'baci-cwv-containerd.service',
  dockerSocket: '/run/baci-cwv/docker.sock',
  containerdSocket: '/run/baci-cwv/containerd/containerd.sock',
  dockerDataRoot: '/srv/baci-cwv/docker',
  dockerExecRoot: '/run/baci-cwv/docker-exec',
  dockerPidFile: '/run/baci-cwv/docker.pid',
  containerdRoot: '/srv/baci-cwv/containerd/root',
  containerdState: '/run/baci-cwv/containerd',
  networkName: 'baci-cwv-net',
  bridgeName: 'baci-cwv0',
  subnet: '172.31.255.0/28',
  gateway: '172.31.255.1',
  daemonIptables: false,
  daemonIpForward: false,
  daemonIpMasq: false,
  enableIpv6: false,
  firewallBackend: 'iptables-nft',
  firewallInputChain: 'INPUT',
  firewallForwardChain: 'DOCKER-USER',
  firewallNatChain: 'POSTROUTING',
  ownedInputChainPrefix: 'BACI_CWV_IN_',
  ownedForwardChainPrefix: 'BACI_CWV_FW_',
  ruleCommentPrefix: 'baci-cwv:',
  deniedDestinationCidrs: ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4'],
  requiredHostIpv4Forward: 1,
  registrationProbeHost: 'github.com',
  registrationProbePort: 443,
  registrationProbeTimeoutSeconds: 10,
});
assert.deepEqual(policy.networkAccounting, {
  family: 'inet',
  table: 'baci_cwv_measurement',
  classifyChain: 'classify',
  classifyHook: 'forward',
  classifyPriority: -150,
  ingressChain: 'external_ingress',
  hostIngressChain: 'host_external_ingress',
  ingressHook: 'forward',
  hostIngressHook: 'input',
  egressChain: 'external_egress',
  hostEgressChain: 'host_external_egress',
  egressHook: 'postrouting',
  counterPriority: 0,
  markPrefix: 2952790016,
  markHashBits: 28,
});
assert.equal(policy.host.sharedHostException.approved, true);
assert.deepEqual(policy.repositoryAuthority, {
  mode: 'personal-public-exact-run',
  approved: true,
  approvedOn: '2026-07-20',
  workflowPath: '.github/workflows/cwv-runner-attestation.yml',
  workflowRef: 'refs/heads/main',
  hookTimeoutSeconds: 5,
  admissionChallengeTtlSeconds: 30,
  inventoryReceiptTtlSeconds: 5,
  queueDeadlineSeconds: 120,
  listenerHoldTimeoutSeconds: 120,
  controllerTimeoutSeconds: 1200,
  watchdogTimeoutSeconds: 1800,
  artifactDownload: {
    hostPattern: '^productionresultssa[0-9]+\\.blob\\.core\\.windows\\.net$',
    pathPrefix: '/actions-results/',
    allowedQueryKeys: ['rscd', 'rsct', 'se', 'sig', 'ske', 'skoid', 'sks', 'skt', 'sktid', 'skv', 'sp', 'spr', 'sr', 'st', 'sv'],
    maxBytes: 1048576,
    connectTimeoutSeconds: 10,
    headerTimeoutSeconds: 10,
    bodyInactivityTimeoutSeconds: 10,
    overallTimeoutSeconds: 30,
  },
});
assert.equal(policy.supplyChain.chrome.sha256, '83ed59c85878ebb8fa53915ebe7066cafc58d1c04c1c95449486e6f9d99a1efb');
assert.equal(policy.supplyChain.ubuntu.reference, 'ubuntu@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90');
assert.equal(policy.supplyChain.ubuntu.snapshotId, '20260720T000000Z');
assert.deepEqual(policy.supplyChain.ubuntu.sources, [
  {uri: 'https://archive.ubuntu.com/ubuntu', suites: ['noble', 'noble-updates'], components: ['main', 'universe', 'restricted', 'multiverse']},
  {uri: 'https://security.ubuntu.com/ubuntu', suites: ['noble-security'], components: ['main', 'universe', 'restricted', 'multiverse']},
]);
assert.equal(policy.supplyChain.ubuntu.architecture, 'amd64');
assert.equal(policy.supplyChain.ubuntu.signedBy, '/usr/share/keyrings/ubuntu-archive-keyring.gpg');
assert.equal(policy.supplyChain.runner.url, 'https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz');
assert.deepEqual(policy.supplyChain.runner.allowedFinalOrigins, ['https://github.com', 'https://release-assets.githubusercontent.com']);
assert.equal(policy.supplyChain.runner.commandSettingsUrl, 'https://raw.githubusercontent.com/actions/runner/v2.335.1/src/Runner.Listener/CommandSettings.cs');
assert.equal(policy.supplyChain.runner.commandSettingsSha256, '937f6552579f7d1eeb0a6d0201586781eb3e2e5ea2ab3878429076560e0cab08');
assert.deepEqual(policy.supplyChain.runner.commandSettingsAllowedFinalOrigins, ['https://raw.githubusercontent.com']);
assert.equal(policy.supplyChain.node.url, 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz');
assert.deepEqual(policy.supplyChain.node.allowedFinalOrigins, ['https://nodejs.org']);
assert.equal(policy.supplyChain.node.ownerDarwinArm64Url, 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.xz');
assert.equal(policy.supplyChain.node.ownerDarwinArm64Sha256, '4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6');
assert.equal(policy.supplyChain.chrome.url, 'https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_150.0.7871.128-1_amd64.deb');
assert.deepEqual(policy.supplyChain.chrome.allowedFinalOrigins, ['https://dl.google.com']);
assert.deepEqual(policy.supplyChain.pnpm, {
  version: '11.7.0',
  url: 'https://registry.npmjs.org/pnpm/-/pnpm-11.7.0.tgz',
  sha256: 'deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee',
  integrity: 'sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==',
  allowedFinalOrigins: ['https://registry.npmjs.org'],
});
assert.equal(policy.supplyChainProvenance.runner.assetId, 442283019);
assert.equal(policy.supplyChainProvenance.runner.assetDigest, `sha256:${policy.supplyChain.runner.sha256}`);
assert.equal(policy.supplyChainProvenance.node.checksumsSha256, '3927bab574a00ca0560c9583fe19655ba19603a1c5851414e4325d34ac50e469');
assert.equal(policy.supplyChainProvenance.node.keyringSha256, '8e6f89521a0694e445f42decd022f48369c634f1b5bcb5975135b69c88629ae8');
assert.equal(policy.supplyChainProvenance.pnpm.distShasum, 'bea54364524dadf0a42dae28dbfeeab25ff177e5');
assert.equal(policy.supplyChainProvenance.chrome.packagesSha256, 'e46bfc093b1b728d0e7a6e5419b90be8672f9b113ddaf50b21a910f40c583173');
assert.equal(policy.supplyChainProvenance.ownerCli.binarySha256, 'a38e8ea1b9794a445a1ce746392e36111ca00a3242a6447b49cd4c162cb191a7');
assert.deepEqual(policy.workflowActions, {
  checkout: 'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  downloadArtifact: 'actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0',
  createGithubAppToken: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
});
assert.deepEqual(policy.ruleset, {
  name: 'ogabassey-rollout-progress-immutable',
  target: 'tag',
  enforcement: 'active',
  tagIncludes: ['refs/tags/ogabassey-rollout-claim/*', 'refs/tags/ogabassey-rollout-progress/**/*', 'refs/tags/ogabassey-semantic-admission/*'],
  tagExcludes: [],
  rules: ['update', 'deletion'],
  bypassActors: [],
});
assert.equal(policy.artifactRetentionDays, 90);
```

The two mark fields have one fixed interpretation and no implementation-defined packing: `markPrefix` is unsigned `0xb0000000`, occupying the upper four bits under prefix mask `0xf0000000`; `markHashBits=28` occupies only the lower bits under hash mask `0x0fffffff` with shift `0`. `deriveCampaignMark(transactionId)` in `policy.schema.mjs` derives `hashWord` from bytes `0..3` of SHA-256 over the exact UTF-8 transaction id in network/big-endian order, then computes unsigned `campaignMark = 0xb0000000 | (hashWord & 0x0fffffff)`. Classifier creation, collision audit, accounting readback, and cleanup call that exact export/CLI and may not reimplement it or rename/re-encode the input. Tests require `(markPrefix & hashMask) === 0`, the exact masks/shift/byte order, stable shared known vectors including `campaign-001 -> 0xb6de43ae` (`3068019630`), variation across transaction ids, range `0xb0000000..0xbfffffff`, and collision refusal against both exact and masked mark use.

The positive authority test also reads the normative contract path as a regular repository file and recomputes its raw SHA-256, proves `git cat-file -e <implementationBaseSha>^{commit}`, and derives the marker exactly as `<deploymentRunId>_<deploymentRunAttempt>_<implementationBaseSha.slice(0,20)>`; no prose-only equality is accepted. Add table cases that reject any missing or drifted authority path/hash/base/deployment-run/attempt/marker, a second measurement label, CPU overlap, nonzero container swap, missing or relaxed installation-import CPU/memory/swap/PID/I/O/sample bounds, any installation worker-service mismatch with the dedicated runtime, changed/missing/non-Unix socket or non-isolated data/exec/state/pid/network/bridge/subnet/gateway field, enabled daemon iptables/IP-forward/IP-masquerade or IPv6, changed firewall backend/input/forward/NAT anchor, owned-chain prefix, comment identity, denied-destination CIDR/order, or host IPv4 forwarding expectation other than exact enabled-without-mutation, changed registration TLS probe host/port/timeout, unknown `hostedFallback` or mutable `imageTag` fields, any changed/missing/extra network-accounting family/table/chain/hook/priority/mark field, a changed/missing/full-image Ubuntu reference, snapshot id, architecture, signed-by path, official source URI, suite, component, or source order, any changed/missing/reordered/extra artifact or provenance allowed-final-origin, any changed/missing runner/CommandSettings/Node/pnpm/Chrome URL or SHA, changed/missing pnpm integrity, any changed/missing/extra runner asset identity, Node checksum/signature/keyring, pnpm metadata/SRI linkage, Chrome signed-metadata/key, or owner-CLI checksum/binary field, retention other than exactly 90 days, missing threshold, threshold relaxation, unapproved shared-host mode, an unapproved or unknown repository-authority mode, wrong workflow path/ref, relaxed or conflated queue/listener-hold/controller/hook/watchdog deadlines, missing owner, missing alert destination, and any secret-shaped key. Task 6 separately enforces the workflow-level no-hosted-fallback invariant.

The same Task 1 matrix must reject any missing/extra/drifted `workflowActions` key/ref and any missing/extra/drifted ruleset `target`, `enforcement`, include, exclude, rule, or bypass field. It rejects admission TTL other than exact `30`, inventory TTL other than exact `5`, either field missing/swapped, or any consumer selecting another policy deadline. It also tests the exact `deriveCampaignMark()` known vector and CLI equality and rejects a different mask, shift, prefix overlap, SHA byte order, transaction-id encoding, input renaming, or transaction-id-insensitive derivation.

- [ ] **Step 2: Run the tests and prove RED**

Run:

```bash
node --test infra/cwv-runner/canonical-json.test.mjs infra/cwv-runner/policy.schema.test.mjs
```

Expected: FAIL because the files/exports do not exist.

- [ ] **Step 3: Implement the canonicalizer, policy parser, and exact policy**

Implement `canonicalJson(value)` as recursively sorted object keys, unchanged array order, finite JSON numbers only, and rejection of `undefined`, functions, symbols, BigInt, cycles, and non-plain objects. `canonicalSha256(value)` hashes the exact UTF-8 bytes returned by `canonicalJson(value)` with `node:crypto` SHA-256. Tasks 2 and 3 must import this serializer for canonical receipt/capture bytes rather than implement an equivalent second canonicalizer.

`policy.json` must contain these exact top-level keys:

```json
{
  "schemaVersion": 1,
  "authority": {
    "normativeContractPath": "docs/superpowers/plans/2026-07-13-ogabassey-home-critical-shell-v4.md",
    "normativeContractSha256": "3503ca9613b6a511b2e37fb3d35b48830d19e8559e7e3c5df136487fce9efdca",
    "implementationBaseSha": "f706fc9f309516aa776515e094120039e2431d34",
    "deploymentRunId": 29733124902,
    "deploymentRunAttempt": 2,
    "deploymentMarker": "29733124902_2_f706fc9f309516aa7765"
  },
  "repository": {"id": 1100488586, "name": "ogabasseyy/Baci"},
  "repositoryAuthority": {
    "mode": "personal-public-exact-run",
    "approved": true,
    "approvedOn": "2026-07-20",
    "workflowPath": ".github/workflows/cwv-runner-attestation.yml",
    "workflowRef": "refs/heads/main",
    "hookTimeoutSeconds": 5,
    "admissionChallengeTtlSeconds": 30,
    "inventoryReceiptTtlSeconds": 5,
    "queueDeadlineSeconds": 120,
    "listenerHoldTimeoutSeconds": 120,
    "controllerTimeoutSeconds": 1200,
    "watchdogTimeoutSeconds": 1800,
    "artifactDownload": {
      "hostPattern": "^productionresultssa[0-9]+\\.blob\\.core\\.windows\\.net$",
      "pathPrefix": "/actions-results/",
      "allowedQueryKeys": ["rscd", "rsct", "se", "sig", "ske", "skoid", "sks", "skt", "sktid", "skv", "sp", "spr", "sr", "st", "sv"],
      "maxBytes": 1048576,
      "connectTimeoutSeconds": 10,
      "headerTimeoutSeconds": 10,
      "bodyInactivityTimeoutSeconds": 10,
      "overallTimeoutSeconds": 30
    }
  },
  "host": {
    "hostname": "ogabassey",
    "virtualization": "kvm",
    "adminAccount": "bassey",
    "runnerAccount": "baci-cwv",
    "runnerUid": 10001,
    "runnerGid": 10001,
    "owner": "ogabasseyy",
    "recoveryContact": "ogabasseyy",
    "alertDestination": "GitHub Actions failure notifications for ogabasseyy/Baci",
    "sharedHostException": {"approved": true, "approvedOn": "2026-07-20"}
  },
  "runner": {
    "name": "baci-cwv-measurement-01",
    "labels": ["self-hosted", "Linux", "X64", "baci-cwv-measurement"],
    "maxConcurrentJobs": 1,
    "disableUpdate": true
  },
  "processAllowSet": {
    "schemaVersion": 1,
    "receiptBinding": "image-process-map-v1",
    "phases": ["held", "listener-idle", "assigned", "cleanup"],
    "executables": {
      "bash": {"path": "/usr/bin/bash", "maxInstancesByPhase": [1, 0, 1, 0]},
      "runtimeNode": {"path": "/opt/node/bin/node", "maxInstancesByPhase": [1, 1, 1, 1]},
      "listener": {"path": "/opt/runner/bin/Runner.Listener", "maxInstancesByPhase": [0, 1, 1, 1]},
      "worker": {"path": "/opt/runner/bin/Runner.Worker", "maxInstancesByPhase": [0, 0, 1, 1]},
      "pluginHost": {"path": "/opt/runner/bin/Runner.PluginHost", "maxInstancesByPhase": [0, 0, 1, 1]},
      "actionNode": {"path": "/opt/runner/externals/node24/bin/node", "maxInstancesByPhase": [0, 0, 1, 1]},
      "git": {"path": "/usr/bin/git", "maxInstancesByPhase": [0, 0, 1, 0]},
      "gitRemoteHttps": {"path": "/usr/lib/git-core/git-remote-https", "maxInstancesByPhase": [0, 0, 1, 0]}
    }
  },
  "resources": {
    "measurementCpuSet": "2-3",
    "otherCpuSet": "0-1",
    "memoryBytes": 8589934592,
    "memorySwapBytes": 0,
    "shmBytes": 1073741824,
    "pidsLimit": 1024
  },
  "installationImport": {
    "workerServices": ["baci-cwv-docker.service", "baci-cwv-containerd.service"],
    "cpuSet": "2-3",
    "cpuQuotaPercent": 100,
    "memoryBytes": 2147483648,
    "memorySwapBytes": 0,
    "pidsLimit": 256,
    "ioWeight": 10,
    "sampleSeconds": 2
  },
  "dedicatedRuntime": {
    "dockerService": "baci-cwv-docker.service",
    "containerdService": "baci-cwv-containerd.service",
    "dockerSocket": "/run/baci-cwv/docker.sock",
    "containerdSocket": "/run/baci-cwv/containerd/containerd.sock",
    "dockerDataRoot": "/srv/baci-cwv/docker",
    "dockerExecRoot": "/run/baci-cwv/docker-exec",
    "dockerPidFile": "/run/baci-cwv/docker.pid",
    "containerdRoot": "/srv/baci-cwv/containerd/root",
    "containerdState": "/run/baci-cwv/containerd",
    "networkName": "baci-cwv-net",
    "bridgeName": "baci-cwv0",
    "subnet": "172.31.255.0/28",
    "gateway": "172.31.255.1",
    "daemonIptables": false,
    "daemonIpForward": false,
    "daemonIpMasq": false,
    "enableIpv6": false,
    "firewallBackend": "iptables-nft",
    "firewallInputChain": "INPUT",
    "firewallForwardChain": "DOCKER-USER",
    "firewallNatChain": "POSTROUTING",
    "ownedInputChainPrefix": "BACI_CWV_IN_",
    "ownedForwardChainPrefix": "BACI_CWV_FW_",
    "ruleCommentPrefix": "baci-cwv:",
    "deniedDestinationCidrs": ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"],
    "requiredHostIpv4Forward": 1,
    "registrationProbeHost": "github.com",
    "registrationProbePort": 443,
    "registrationProbeTimeoutSeconds": 10
  },
  "networkAccounting": {
    "family": "inet",
    "table": "baci_cwv_measurement",
    "classifyChain": "classify",
    "classifyHook": "forward",
    "classifyPriority": -150,
    "ingressChain": "external_ingress",
    "hostIngressChain": "host_external_ingress",
    "ingressHook": "forward",
    "hostIngressHook": "input",
    "egressChain": "external_egress",
    "hostEgressChain": "host_external_egress",
    "egressHook": "postrouting",
    "counterPriority": 0,
    "markPrefix": 2952790016,
    "markHashBits": 28
  },
  "thresholds": {
    "load1Max": 0.5,
    "cpuPsiFullAvg10Max": 0,
    "ioPsiFullAvg10Max": 0.1,
    "memoryPsiFullAvg10Max": 0,
    "cpuStealPercentMax": 0.5,
    "availableMemoryBytesMin": 6442450944,
    "rootFreeBytesMin": 32212254720,
    "networkRxBytesPerSecondMax": 1048576,
    "networkTxBytesPerSecondMax": 1048576,
    "networkSampleSeconds": 10
  },
  "ruleset": {
    "name": "ogabassey-rollout-progress-immutable",
    "target": "tag",
    "enforcement": "active",
    "tagIncludes": [
      "refs/tags/ogabassey-rollout-claim/*",
      "refs/tags/ogabassey-rollout-progress/**/*",
      "refs/tags/ogabassey-semantic-admission/*"
    ],
    "tagExcludes": [],
    "rules": ["update", "deletion"],
    "bypassActors": []
  },
  "workflowActions": {
    "checkout": "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    "uploadArtifact": "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "downloadArtifact": "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
    "createGithubAppToken": "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"
  },
  "artifactRetentionDays": 90,
  "supplyChain": {
    "ubuntu": {"reference": "ubuntu@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90", "snapshotId": "20260720T000000Z", "architecture": "amd64", "signedBy": "/usr/share/keyrings/ubuntu-archive-keyring.gpg", "sources": [{"uri": "https://archive.ubuntu.com/ubuntu", "suites": ["noble", "noble-updates"], "components": ["main", "universe", "restricted", "multiverse"]}, {"uri": "https://security.ubuntu.com/ubuntu", "suites": ["noble-security"], "components": ["main", "universe", "restricted", "multiverse"]}]},
    "runner": {"version": "2.335.1", "url": "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", "sha256": "4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf", "allowedFinalOrigins": ["https://github.com", "https://release-assets.githubusercontent.com"], "commandSettingsUrl": "https://raw.githubusercontent.com/actions/runner/v2.335.1/src/Runner.Listener/CommandSettings.cs", "commandSettingsSha256": "937f6552579f7d1eeb0a6d0201586781eb3e2e5ea2ab3878429076560e0cab08", "commandSettingsAllowedFinalOrigins": ["https://raw.githubusercontent.com"]},
    "node": {"version": "24.18.0", "url": "https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz", "sha256": "55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742", "allowedFinalOrigins": ["https://nodejs.org"], "ownerDarwinArm64Url": "https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.xz", "ownerDarwinArm64Sha256": "4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6"},
    "pnpm": {"version": "11.7.0", "url": "https://registry.npmjs.org/pnpm/-/pnpm-11.7.0.tgz", "sha256": "deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee", "integrity": "sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==", "allowedFinalOrigins": ["https://registry.npmjs.org"]},
    "chrome": {"version": "150.0.7871.128-1", "url": "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_150.0.7871.128-1_amd64.deb", "sha256": "83ed59c85878ebb8fa53915ebe7066cafc58d1c04c1c95449486e6f9d99a1efb", "allowedFinalOrigins": ["https://dl.google.com"]}
  },
  "supplyChainProvenance": {
    "runner": {"releaseApiUrl": "https://api.github.com/repos/actions/runner/releases/tags/v2.335.1", "assetId": 442283019, "assetName": "actions-runner-linux-x64-2.335.1.tar.gz", "assetSize": 225628509, "assetDigest": "sha256:4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf", "allowedFinalOrigins": ["https://api.github.com"]},
    "node": {"checksumsUrl": "https://nodejs.org/dist/v24.18.0/SHASUMS256.txt", "checksumsSha256": "3927bab574a00ca0560c9583fe19655ba19603a1c5851414e4325d34ac50e469", "signatureUrl": "https://nodejs.org/dist/v24.18.0/SHASUMS256.txt.sig", "signatureSha256": "d771440acfe010e7510a3c01d248525f771daa9cf75dae5784c97ea2b08d9393", "keyringUrl": "https://raw.githubusercontent.com/nodejs/release-keys/b28073028e6d6855cfb53bf7fa0137599c01f967/gpg-only-active-keys/pubring.kbx", "keyringSha256": "8e6f89521a0694e445f42decd022f48369c634f1b5bcb5975135b69c88629ae8", "allowedFinalOrigins": ["https://nodejs.org", "https://raw.githubusercontent.com"]},
    "pnpm": {"metadataUrl": "https://registry.npmjs.org/pnpm/11.7.0", "distShasum": "bea54364524dadf0a42dae28dbfeeab25ff177e5", "allowedFinalOrigins": ["https://registry.npmjs.org"]},
    "chrome": {"inReleaseUrl": "https://dl.google.com/linux/chrome/deb/dists/stable/InRelease", "inReleaseSha256": "103b34e58da0ab8d2150b921d827c730f98de9329f1b5c393fa41279dc78feca", "packagesUrl": "https://dl.google.com/linux/chrome/deb/dists/stable/main/binary-amd64/Packages.gz", "packagesSha256": "e46bfc093b1b728d0e7a6e5419b90be8672f9b113ddaf50b21a910f40c583173", "signingKeyUrl": "https://dl.google.com/linux/linux_signing_key.pub", "signingKeySha256": "54dea5f6c2a26091578cf52a999cebc6b64df478d37ad4dce96376b711e3b27c", "allowedFinalOrigins": ["https://dl.google.com"]},
    "ownerCli": {"version": "2.93.0", "archiveUrl": "https://github.com/cli/cli/releases/download/v2.93.0/gh_2.93.0_macOS_arm64.zip", "archiveSha256": "a86be4e0a86c26456cf71177d6572d6f1165cf1679e532b72f7f15918ee51fd2", "binarySha256": "a38e8ea1b9794a445a1ce746392e36111ca00a3242a6447b49cd4c162cb191a7", "checksumsUrl": "https://github.com/cli/cli/releases/download/v2.93.0/gh_2.93.0_checksums.txt", "checksumsSha256": "f62a3bc9dedc88262c9c2b56eb653cb3ded6bde8076bdbb151f4cce9c8729da5", "allowedFinalOrigins": ["https://github.com", "https://release-assets.githubusercontent.com"]}
  }
}
```

- [ ] **Step 4: Run GREEN and formatting checks**

Run:

```bash
node --test infra/cwv-runner/canonical-json.test.mjs infra/cwv-runner/policy.schema.test.mjs
pnpm exec biome check infra/cwv-runner/*.mjs infra/cwv-runner/*.json
git diff --check
```

Expected: all tests pass, Biome passes, and no whitespace errors.

- [ ] **Historical Step 5 seed — do not execute: commit the policy unit**

> **Non-executable historical block.** The cumulative Task 1-6 integration rule supersedes this per-task CodeRabbit, `git add`, and `git commit` example. Use it only to understand the original design boundary; stage and commit only the final manifest-driven integration set.

```text
Historical boundary only: the policy source, schema, canonical-JSON helper, artifact-cap contract, and their tests formed the policy unit. No review, staging, or commit command from the superseded per-task procedure is retained.
```

---

### Task 2: Build the pinned single-runner container

**Files:**
- Create: `infra/cwv-runner/Dockerfile`
- Create: `infra/cwv-runner/entrypoint.sh`
- Create: `infra/cwv-runner/entrypoint.mjs`
- Create: `infra/cwv-runner/entrypoint.test.mjs`
- Create: `infra/cwv-runner/isolation-probe.sh`
- Create: `infra/cwv-runner/isolation-probe.test.mjs`
- Create: `infra/cwv-runner/registration-egress-probe.mjs`
- Create: `infra/cwv-runner/registration-egress-probe.test.mjs`
- Create: `infra/cwv-runner/direct-listener-conformance.mjs`
- Create: `infra/cwv-runner/direct-listener-conformance.test.mjs`
- Create: `infra/cwv-runner/runner-identity-gate.mjs`
- Create: `infra/cwv-runner/runner-identity-gate.test.mjs`
- Create: `infra/cwv-runner/build-image.mjs`
- Create: `infra/cwv-runner/build-image.test.mjs`
- Create: `infra/cwv-runner/download-artifact.sh`
- Create: `infra/cwv-runner/download-artifact.test.mjs`
- Create: `infra/cwv-runner/supply-chain-provenance.mjs`
- Create: `infra/cwv-runner/supply-chain-provenance.test.mjs`
- Create: `infra/cwv-runner/verify-node-bootstrap.sh`
- Create: `infra/cwv-runner/verify-node-bootstrap.test.mjs`
- Create: `infra/cwv-runner/verify-apt-snapshot.sh`
- Create: `infra/cwv-runner/verify-apt-snapshot.test.mjs`

**Interfaces:**
- Produces the policy-derived image tag `baci-cwv-runner:2.335.1-chrome150` from parsed runner and Chrome versions and captures its immutable image digest after build; `build-image.mjs --print-tag` is the only consumer-facing source for that tag.
- Embeds the exact reviewed `policy.json` bytes at `/opt/baci-cwv/policy.json`. Registration and normal modes require a separate read-only `/run/baci-cwv-policy/policy.sha256` container mount backed by persistent host `/srv/baci-cwv/sealed/policy.sha256`; that file contains SHA-256 over the exact reviewed raw `policy.json` bytes, and the entrypoint hashes the embedded file bytes before parsing and refuses mismatch. A separately named `policyCanonicalSha256` may describe parsed semantic canonicalization in manifests/receipts, but it never authorizes bytes and cannot replace `policyFileSha256`. Task 2 uses fixture mounts; Task 5 atomically creates the root-owned raw-file digest, verifies exact embedded/reviewed byte equality plus both digests on every start/reboot, and owns the real bind in both modes.
- A normal container starts only in sealed pre-listener hold mode. It exposes its Docker-created network endpoint while running no `Runner.Listener`, waits at most the parsed `listenerHoldTimeoutSeconds` for root-owned `/run/baci-cwv-listener-release/release.json`, validates that record against its campaign/policy/container identity, then and only then uses the already-running sealed `runtimeNode` lifecycle to spawn exactly `/opt/runner/bin/Runner.Listener run --once` with an argv array, inherited stdio, fixed cwd `/opt/runner`, and no shell. That normal argv contains only `run` and `--once`; it never appends configure-only `--disableupdate` or any other argument. No direct normal-listener mode exists. `DISABLE_RUNNER_UPDATE=1`, read-only runner bytes, and refusal of restart/update exits form the normal update-prevention contract; `--disableupdate` is used only by direct registration `configure`. Listener exit `0` is success and every other exit, signal, spawn error, retry/update code, or attempted second Listener is terminal and restores rather than restarting.
- A registration-only container consumes one host token created at `/run/baci-cwv-registration/<nonce>/token`, where the cryptographically random nonce directory is `0700 root:root` and the token is `0440 root:baci-cwv`; the host path is direct-bind-mounted read-only at `/run/secrets/runner-registration-token`, so UID/GID `10001` can read the mounted file inside the registration container but cannot traverse or discover its host parent. It configures in one random runner-owned child bind-mounted at `/registration-staging`, then exits. The image contains an empty `0700` UID/GID-10001 `/registration-staging` mount point; normal mode requires that path remain unmounted and empty, while registration requires it be the dedicated mount. Registration uses Docker's exact `--entrypoint /opt/node/bin/node` override with fixed argv `/opt/baci-cwv/entrypoint.mjs --mode registration`; it never runs the image's normal Bash wrapper. Before container start, root installs a receipt-bound registration egress chain whose default action drops every packet from that container. The earlier credential-free TLS probe uses a separate temporary allow transaction that is removed and counter-verified before the token is read. A root-owned identity/mount guard is active before token creation through container exit. It first requires zero UID/GID-10001 identities, then exactly one receipt-bound registration container/cgroup/user namespace/mount namespace and one hash-bound PID-1 Node. Node validates/copies the token into one mutable buffer, writes one secret-free `registration-ready` receipt into staging, and waits without constructing the child environment or executing Listener. Root validates that receipt/PID/namespaces, enters only that mount namespace, unmounts the receipt-bound token, deletes the host token and nonce directory, and proves the container path returns `ENOENT`; Node independently observes the same absence. Root then revalidates the still-running hash-bound Node/PID/namespaces/argv, token absence, and zero egress counters, atomically activates the already-prepared narrow policy-derived registration egress rule, and writes one mode-`0440 root:baci-cwv` one-use pre-exec release record bound to those receipt digests. The trusted Node lifecycle is statically and behaviorally proven to perform no network operation: after validating that release, its next external action is to construct the minimal environment, overwrite its read buffer, and atomically replace the same PID with hash-bound `/registration-staging/actions-runner/bin/Runner.Listener configure` through pinned `process.execve()`. Root then verifies the exact same-PID executable/argv/environment transition; an exec failure or transition timeout immediately returns egress to default-drop and terminates/restores. No packet may leave before the pre-exec release, while Listener traffic after it is expected. No `config.sh`, `env.sh`, shell, dependency probe, helper process, sibling, child, reparented process, or post-config survivor is permitted. Any second PID, identity/namespace drift, wrong executable/argv/environment, retained/readable token, pre-release packet/counter delta, release replay/drift, or mount beyond the exact phase-specific token/policy/staging/release set synchronously stops registration and restores. Every pre-exec error unmounts/deletes first; every later error removes staging and restores the host. After Listener exits, root validates and seals the generated runner bytes and removes the staging child before any normal listener starts.
- The pre-exec release has a separate trust path. Root creates outer `/run/baci-cwv-registration-release/<nonce>/` as `0700 root:root` and its `handoff/` child as `0750 root:baci-cwv`, then direct-bind-mounts only that empty child read-only at `/run/baci-cwv-registration-release`; it is never inside runner-writable staging and is absent from normal mode. After the token-absence/Node/zero-counter checks and egress activation, root writes canonical `release.json.tmp`, fsyncs, sets `0440 root:baci-cwv`, and atomically renames it to `release.json`. Its closed schema binds schema version, registration nonce, campaign/capture/policy/image/container ids, exact PID/cgroup/user/mount namespaces, Node executable/argv digest, registration-ready digest, token-unmount/delete/absence digests, zero-counter and active-egress-rule digests, monotonic creation/expiry no more than five seconds later, and generation exactly `1`. Node opens it once with no-follow semantics, requires a regular exact-mode/owner file and canonical bytes, validates every binding and freshness, marks it consumed in memory, and never rereads or retries; its next external action is `process.execve`. Root deletes the host release immediately after verified exec or on any failure, removes/unmounts the handoff, and refuses an existing file, second generation, replayed nonce/digest, stale release, exec retry, or release mount in normal mode.
- Normal runs mount the sealed runner application/config/credentials read-only at `/opt/runner`, with separate writable mounts only at `/opt/runner/_diag`, `/runner-work`, and explicitly tested scratch paths. Normal runs have no registration-token mount.
- The final image copies `runner-identity-gate.mjs` as a root-owned read-only regular file at `/opt/baci-cwv/runner-identity-gate.mjs` and binds its raw SHA-256 into the image/process/source receipts. The workflow's first step, before checkout, App-token creation, repository code, or any secret-bearing action, is a fixed Bash `exec` of the sealed action Node with only this sealed gate. The step-level environment maps exactly `BACI_CWV_ADMISSION_ID: ${{ inputs.admission_id }}`; the untrusted input never appears in `run:`, argv construction, a shell expansion, or a file. The gate reads only that named value, the exact root-mounted admission/allow record, and the named default `RUNNER_NAME`, `RUNNER_OS`, `RUNNER_ARCH`, `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_ID`, `GITHUB_WORKFLOW_REF`, `GITHUB_WORKFLOW_SHA`, `GITHUB_REF`, `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, and `GITHUB_JOB` values; it first requires the named admission value is exactly 64 lowercase hexadecimal characters, then compares it to the root record and requires exact runner name `baci-cwv-measurement-01`, OS `Linux`, architecture `X64`, and the record's already owner/API-verified runner id/name/generation plus repository/workflow/ref/SHA/run/attempt/job/admission bindings. It outputs only a secret-free Boolean/digest receipt, never reads the event body or environment wholesale, and fails before later steps on any missing/extra/drifted identity. Static tests reject `${{ inputs.* }}` in every `run:` scalar, any second input mapping, environment enumeration, event-body parsing, and admission input in argv. The job-start hook remains the earlier pre-step boundary; this first workflow step independently proves the concrete assigned identity from inside the job before any checkout or credential action.
- Rehearsal runs use `--network=none --entrypoint /opt/baci-cwv/isolation-probe.sh`, mount no runner identity/credentials/hook/allow record, and emit only UID/GID/cpuset/cgroup/resource/read-only-root assertions. The probe contains no browser or `Runner.Listener` invocation.
- Before first registration only, `registration-egress-probe.mjs` runs in a separate credentials-free container attached to the exact dedicated network, parses the embedded policy, resolves only `registrationProbeHost`, completes a CA-validated TLS handshake with exact SNI/port/timeout, emits no DNS answer/certificate bytes, and exits. It has no token, registration staging, runner identity, hook, allow record, browser, HTTP request, or arbitrary host input. A failed proof removes the network transaction before the token is mounted.
- `build-image.mjs --execute --source-manifest <path> --source-manifest-sha256 <digest> --output-archive <path> --output-receipt <path>` is the sole image-build entrypoint and is permitted only on the development Mac. It refuses execution until Task 5's `source-manifest.mjs freeze` has produced canonical schema-v1 bytes and their exact raw SHA-256 from the merged/deployed PR A tree. The manifest contains exactly `schemaVersion`, `policyFileSha256` over exact reviewed `policy.json` bytes, separately named `policyCanonicalSha256` over parsed canonical JSON, the exact policy `/authority` projection, `prNumber`, `reviewedHeadSha`, `baseSha`, `mergeSha`, `entries`, and `sourceArchive`. `entries` is the path-sorted complete PR-diff manifest whose rows have exactly `path`, `status`, `mode`, and `blobSha256` (or an explicit `absent:true` deletion). `sourceArchive` has exactly `prefix:"infra/cwv-runner/"` and path-sorted `entries`; those rows have exactly `path`, `mode`, and `blobSha256` for every regular Git blob under that prefix in the exact merge tree, whether changed or unchanged. Freeze recursively enumerates the complete Git tree beneath the prefix before projection: tree nodes are permitted only as traversal nodes, while every leaf must be a blob with mode exactly `100644` or `100755`; symlink `120000`, gitlink `160000`, unknown/non-blob, device-like, or ambiguous modes fail closed rather than being omitted into only the broader diff. Paths are repository-relative UTF-8 without NUL, `.`/`..`, or ambiguity. The builder requires canonical manifest bytes (`canonicalJson(JSON.parse(bytes))` byte-equal to input), recomputes the supplied manifest digest, requires `policyFileSha256` to equal the raw reviewed file and embedded image bytes, requires `policyCanonicalSha256` and the authority projection to equal the parsed policy, and binds both policy digests plus the complete manifest digest into the receipt; only the raw-file digest authorizes policy bytes. Task 5 separately proves PR/tree semantics from Git object bytes and GitHub identity. The builder schema-validates `policy.json`, passes `UBUNTU_IMAGE` equal to the complete parsed Ubuntu reference, derives the image tag, snapshot, canonical deb822 Ubuntu source document, and every runner/Node/pnpm/Chrome URL, digest, integrity, version, and allowed-final-origin build argument only from parsed policy fields, and invokes local `docker buildx build --platform linux/amd64 --output type=docker,dest=<path>` with an argv array and no shell. It refuses a remote builder/daemon context or a host identified as the production VPS. `--verify-archive` requires the same source-manifest path/digest plus output flags and revalidates their receipt binding. `--cleanup-output` accepts only `--output-archive` and `--output-receipt`; no `--archive`, `--receipt`, or `--directory` aliases exist. Cleanup verifies both paths are direct children of one owner-created temporary directory and are not symlinks, removes only those two files if present, refuses a directory-recursive target, and emits no content. `--dry-run-json` requires a canonical fixture source manifest/digest and emits only secret-free argv for tests; `--print-tag` emits only the derived tag. The Dockerfile contains generic `ARG` consumers and no duplicated supply-chain URL, image repository/digest, source document, checksum, integrity, origin, version, tag, or mutable fallback literal.
- The exact non-secret build-argument allowlist is closed to these 31 names: `SOURCE_MANIFEST_SHA256`, `UBUNTU_IMAGE`, `UBUNTU_SNAPSHOT`, `UBUNTU_SOURCES_BASE64`, `RUNNER_URL`, `RUNNER_SHA256`, `RUNNER_VERSION`, `RUNNER_ASSET_ID`, `RUNNER_ALLOWED_FINAL_ORIGINS`, `COMMAND_SETTINGS_URL`, `COMMAND_SETTINGS_SHA256`, `COMMAND_SETTINGS_ALLOWED_FINAL_ORIGINS`, `NODE_URL`, `NODE_SHA256`, `NODE_VERSION`, `NODE_ALLOWED_FINAL_ORIGINS`, `PNPM_METADATA_URL`, `PNPM_URL`, `PNPM_SHA256`, `PNPM_INTEGRITY`, `PNPM_SHA1`, `PNPM_VERSION`, `PNPM_ALLOWED_FINAL_ORIGINS`, `CHROME_URL`, `CHROME_SHA256`, `CHROME_VERSION`, `CHROME_ALLOWED_FINAL_ORIGINS`, `CHROME_INRELEASE_SHA256`, `CHROME_PACKAGES_SHA256`, `CHROME_SIGNING_KEY_SHA256`, and `SUPPLY_CHAIN_PROVENANCE_JSON`. Every value is derived from the validated manifest or the named parsed policy field; none may come from environment fallback, caller input, or a secret. `build-image.mjs` requires exact set equality and one occurrence per name before invoking BuildKit. The exported final image history/config are also closed: normalized history may contain only the exact final-stage `ARG UBUNTU_IMAGE`, policy-derived pinned `FROM`, one `COPY --from=verifier /runtime-root/ /`, fixed `USER runner`, fixed `WORKDIR /runner-work`, fixed `ENTRYPOINT ["/opt/baci-cwv/entrypoint.sh"]`, and the reviewed digest/version labels; config may contain only those fixed runtime fields, declared non-secret locale/timezone variables, and receipt/digest/version labels. No build-argument value other than the explicitly reviewed digest/version labels may survive final config/history. `--verify-archive` parses every layer, config, label, environment row, and normalized history entry; it rejects an undeclared/duplicate/missing build argument or history/config row, any secret-shaped name/value (`TOKEN`, `KEY`, `PASSWORD`, `AUTH`, cookie, credential, `.env`), any raw URL/query/signature/provenance document, or a policy value in an unauthorized final field. Tests enumerate all 31 approved arguments, delete/change/add one at a time, seed secret/undeclared values into both config and history, and prove only the closed final projection passes.
- The image build also resolves every `policy.processAllowSet.executables.*.path` inside the accepted image with no symlink ambiguity, records its canonical real path, regular-file mode/owner, raw SHA-256, role, and exact `maxInstancesByPhase` vector in the canonical `image-process-map-v1` receipt, and refuses a missing/extra role, path alias, duplicate real path across unequal roles, wrong four-element vector, or undeclared executable required by the frozen container-lifecycle/workflow/action command graph. Vector positions are exactly the policy `phases` order `held`, `listener-idle`, `assigned`, `cleanup`; zero forbids the role. Here `cleanup` is the assigned GitHub job's in-process action/post-action cleanup subphase while the one `actionNode` remains responsible for securely removing job-private material; it is not the root controller's terminal host-restore phase. After `Runner.Listener` exits and terminal host restore begins, every runner/job role (`Listener`, `Worker`, `PluginHost`, `actionNode`, `git`, and `gitRemoteHttps`) must be zero; only separately attested root controller/watchdog processes outside this image map may remain. The accepted image contributes two exact lifecycle graphs: normal mode binds the reviewed Bash wrapper to its immediate same-PID `exec` into `runtimeNode`, then the one direct `Runner.Listener run --once` child; registration mode binds Docker's direct `/opt/node/bin/node /opt/baci-cwv/entrypoint.mjs --mode registration` override to token-unmount proof, root's one-use pre-exec egress release, and the same-PID `Runner.Listener configure` replacement. The static workflow separately contributes the transient assigned `run:` Bash that immediately `exec`s `actionNode`. Upstream `config.sh`, `env.sh`, `run.sh`, `run-helper.sh.template`, `safe_sleep.sh`, and any generated `run-helper.sh` are never invoked, copied, generated, or writable in either runtime lifecycle. Normal Bash maxima are exactly `[1,0,1,0]`; registration permits zero Bash processes. `runtimeNode` is PID 1, performs held validation/release waiting/cleanup with Node built-ins, and in normal mode spawns exactly one Listener without a shell, forwards `SIGINT`/`SIGTERM` once, waits for it, refuses restart/update exit codes, and exits with the Listener's exact status (or `128+signal`) after bounded cleanup. Registration Node never spawns and never networks: it waits for token-unmount plus pre-exec release, then its next external action is `execve`. A second child/PID or signal-handler/listener mismatch is terminal. Static and behavioral contract tests prove both lifecycle graphs, distinguish job `cleanup` from terminal host restore, prove all runner/job roles are absent after Listener exit, prove read-only `/opt/runner` remains byte-identical, shadow `cp`, `id`, `dirname`, `readlink`, `rm`, and `safe_sleep.sh` with failing shims to prove none execute, bind the exact four pinned actions, and prove every workflow `run:` step can invoke only the closed role set. If a pinned action or runner version needs another executable or changes Listener CLI behavior, policy and plan require fresh review rather than runtime discovery. Task 5 seals both graphs with the image receipt. The host sampler validates each descendant's `/proc/<pid>/exe` real path/inode/raw hash, measurement-cgroup ancestry, parent chain, phase, role, and cardinality against the applicable sealed graph before release, throughout assignment, and through cleanup; terminal restore separately requires the runner/job cgroup empty. Transition receipts bind registration-ready, token unmount/delete, pre-exec registration egress release, exec transition, normal release, job-start hook, worker exit, direct Listener exit, and zero-process terminal boundary. Unknown/replaced/wrong-phase/over-cardinality executables, an unapproved parent, an executable disappearing during sampling, or any surviving runner/job role at terminal restore cancels and restores.
- `download-artifact.sh` is the one generic Docker build helper for immutable byte inputs that have a frozen raw SHA-256 in policy. It requires HTTPS, no URL credentials, and a nonempty 64-hex expected digest. Before the first request and before following each of at most five redirects, it resolves the next `Location` against the current URL and requires HTTPS, no credentials, no visited-URL loop, and membership of that hop's lowercase origin in the policy-derived allowed-origin JSON; no unapproved hop is ever contacted. Each hop uses a ten-second connect timeout and thirty-second no-progress deadline, while one monotonic 120-second overall deadline covers the full chain/body; timeout abort removes partial bytes. It captures the final effective URL without logging its query, verifies SHA-256 before atomic destination rename, and removes partial bytes on every failure. It never accepts the semantically pinned but raw-hashless GitHub release API or pnpm registry metadata endpoints. The pnpm integrity check remains an additional independent verification after Node is installed.
- The pre-install trust root is the content-addressed Ubuntu rootfs selected by exact `FROM ubuntu@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90`, before any APT source change or package unpack. The two pre-install verifiers use shell built-ins plus only the closed external executable set `/usr/bin/bash`, `/usr/bin/gpgv`, `/usr/bin/sha256sum`, `/usr/bin/awk`, `/usr/bin/stat`, `/usr/bin/dpkg-query`, and `/usr/bin/mv`; static tests parse both scripts and reject any command, command substitution, helper, shebang, or PATH lookup outside that exact set. The build records every listed executable, its ELF interpreter and complete transitive linked-library closure, plus `/usr/share/keyrings/ubuntu-archive-keyring.gpg`, with canonical real path, regular-file/no-symlink mode/owner, package/version, and raw SHA-256 in the base-tool receipt bound to the complete Ubuntu image digest. The test suite constructs an exact pinned-base fixture from that image inventory and requires every executable, interpreter, transitive library, and keyring row/hash to exist before any APT source mutation; no selected package may create or repair this receipt. It rechecks the entire inventory immediately before each verifier and again before the first unpack; any missing/extra/path/package/library/keyring/hash/mode/owner drift or any unpack/configure state reported by the frozen `dpkg-query` refuses. This content-addressed base authorization is established before Node or any selected APT package is installed; neither downloaded metadata nor a package being authorized may supply or replace any verifier executable, interpreter, library, or keyring.
- `verify-node-bootstrap.sh` runs before any Node interpreter or third-party archive extraction. Using only the authorized frozen Ubuntu shell, `/usr/bin/sha256sum`, `/usr/bin/awk`, and the base-authorized `/usr/bin/gpgv`, it verifies the already-downloaded Node checksum file, signature, and keyring byte hashes; verifies the detached signature; requires exactly one checksum row for the exact archive basename and exact policy SHA-256; recomputes the archive SHA-256; then atomically writes a canonical, secret-free authorization receipt binding the base-tool receipt, all four input hashes, and the archive basename. Only a matching receipt permits extraction into a temporary bootstrap path.
- `verify-apt-snapshot.sh` runs after the one canonical Ubuntu source is installed but before any selected Ubuntu runtime package is unpacked. Its selected-package set explicitly excludes Google Chrome, every Google repository/key/metadata row, and any third-party package; Chrome is never part of this pre-Node APT receipt. It accepts only the base-authorized Ubuntu archive keyring, an owner-created exact snapshot-list directory, an exact Ubuntu-runtime selected-package row file/archive directory, the base-tool receipt, and one owner-selected receipt path; verifies every Ubuntu `InRelease` with the base-authorized `/usr/bin/gpgv`, requires each referenced amd64 Packages digest/size/path exactly once, binds every selected Ubuntu archive to exactly one package/version/architecture/filename/SHA-256 stanza, rejects symlinks/duplicates/extra fields, and atomically emits byte-exact canonical read-only schema-v1 package-receipt bytes using only frozen-base shell tools and its restricted character grammar. Before the first Ubuntu-runtime unpack, the shell verifier re-reads the exact receipt bytes, recomputes their SHA-256 and every authorized archive SHA-256, and requires equality with the just-verified rows; no Node runtime participates in this pre-install authority decision. After those authorized Ubuntu packages and the separately raw-hash/`gpgv`-authorized Node archive bootstrap the pinned Node runtime, `supply-chain-provenance.mjs` independently reparses the same receipt with `canonicalJson()`, rejects noncanonical/extra/missing rows, and requires its recomputed digest to equal the pre-install shell digest before the image or build receipt can be accepted. The builder binds both the base-tool and package-receipt digests into image config/history and the exact build receipt.
- `supply-chain-provenance.mjs` runs only with that authorized temporary pinned Node. It consumes schema-validated policy, the bootstrap receipt, and already-downloaded raw-hash-verified metadata bytes, including the exact policy-pinned `CommandSettings.cs` source. Only for `runner.releaseApiUrl` and `pnpm.metadataUrl`, whose response envelopes have no stable vendor raw digest, it performs a bounded semantic JSON fetch using pinned Node HTTPS: exact policy URL only, no caller-selected URL, no credentials/cookies, CA validation, status `200`, JSON content type, and at most 1 MiB before parse. Before the first request and before every one of at most five redirects it resolves the next URL, requires HTTPS, no URL credentials, no visited-URL loop, and membership of that hop's lowercase origin in that field's policy allowlist; an unapproved hop is never contacted. Every hop has a ten-second connect/header deadline and ten-second body-inactivity deadline, and the complete redirect/body operation has one monotonic thirty-second deadline; each timeout destroys the active request/socket and discards buffered bytes. It emits neither raw bytes nor redirect/query data. It revalidates the Node receipt against policy and recomputes the extracted Node executable hash for the later sealed-image receipt; requires `CommandSettings.cs` raw bytes and SHA-256 to equal the frozen policy URL/hash, verifies the reviewed source contract that secret environment input is masked, copied to the internal argument map, and removed from the process environment, and emits a source-contract receipt bound to the runner archive before any registration path may rely on `ACTIONS_RUNNER_INPUT_TOKEN`; selects the exact GitHub runner asset by immutable asset id and verifies name/size/vendor digest; requires pnpm registry `version`, `dist.tarball`, `dist.integrity`, and `dist.shasum` to equal policy and recomputes both SHA-256 and SRI over the already raw-hash-verified tarball; verifies Chrome `InRelease` with `gpgv` against the hash-pinned Google key, verifies the signed `Packages.gz` digest, and requires exactly one matching package/version/architecture/filename/SHA-256 stanza. Only after that pinned-Node Chrome receipt is durable may the exact raw-hash-verified Chrome `.deb` be unpacked; no APT resolver or pre-Node receipt authorizes Chrome. It also requires the owner CLI checksum manifest to contain exactly one matching archive row before separately checking the extracted binary hash. Neither semantic document can authorize an install without the independent frozen artifact SHA/integrity check. Missing, duplicate, oversized, wrong-content-type, timeout/stall, unsigned, stale, redirected-to-unapproved-origin, parse-failed, key/signature, bootstrap-receipt, source-contract, or cross-document mismatch refuses before the affected install or extraction.

- [ ] **Step 1: Write RED tests for immutable inputs and token hygiene**

The test must read the Dockerfile/entrypoint and assert:

```js
assert.match(dockerfile, /^ARG UBUNTU_IMAGE$/m);
assert.match(dockerfile, /^FROM \$\{UBUNTU_IMAGE\}$/m);
for (const name of ['UBUNTU_SNAPSHOT', 'UBUNTU_SOURCES_BASE64', 'RUNNER_URL', 'RUNNER_SHA256', 'RUNNER_ALLOWED_FINAL_ORIGINS', 'NODE_URL', 'NODE_SHA256', 'NODE_ALLOWED_FINAL_ORIGINS', 'PNPM_URL', 'PNPM_SHA256', 'PNPM_INTEGRITY', 'PNPM_ALLOWED_FINAL_ORIGINS', 'CHROME_URL', 'CHROME_SHA256', 'CHROME_ALLOWED_FINAL_ORIGINS', 'SUPPLY_CHAIN_PROVENANCE_JSON']) {
  assert.match(dockerfile, new RegExp(`^ARG ${name}$`, 'm'));
}
assert.doesNotMatch(dockerfile, /https:\/\/|4ef2f25285f0|55aa7153f9d8|deafa7ec98a1|83ed59c85878/);
assert.doesNotMatch(dockerfile, /:latest|stable_current/);
assert.match(entrypoint, /configure[\s\S]*--disableupdate/);
assert.doesNotMatch(entrypoint, /--replace/);
assert.match(entrypoint, /\/opt\/runner\/bin\/Runner\.Listener/);
assert.match(entrypoint, /run.*--once/);
assert.doesNotMatch(entrypoint, /run[^\n]*--disableupdate|--once[^\n]*--disableupdate/);
assert.match(entrypoint, /DISABLE_RUNNER_UPDATE/);
assert.match(entrypoint, /shell:\s*false/);
assert.doesNotMatch(entrypoint, /run\.sh|run-helper|safe_sleep\.sh|shell:\s*true/);
assert.match(entrypoint, /ACTIONS_RUNNER_INPUT_TOKEN/);
assert.doesNotMatch(entrypoint, /--token/);
assert.doesNotMatch(entrypoint, /cp .*token|mv .*token|cat .*token/);
assert.doesNotMatch(entrypoint, /set -x|echo.*token|env\b|printenv/);
```

Use a fake sealed `Runner.Listener` plus an injectable `process.execve` seam to prove registration can read the exact token mount and write only its random staging child, derives repository/name/custom-label arguments only from a schema-validated embedded policy whose raw file SHA-256 equals the fixed read-only `/run/baci-cwv-policy/policy.sha256` fixture and whose bytes equal the reviewed policy file, rejects byte-different semantic equivalents plus missing/malformed/extra-line/digest/policy drift, never copies or logs the token, and invokes exactly one same-PID direct `Runner.Listener configure` transition with the frozen argv/environment. Prove the registration command uses Docker's direct Node entrypoint override and that invoking the normal Bash wrapper in registration mode refuses. Prove Node writes the secret-free ready receipt, makes no network attempt while default-drop is closed, retains only the mutable buffer while waiting, and observes token-path `ENOENT` after root unmount/delete. Root must then revalidate exact Node/PID/namespaces/argv and zero counters, activate the narrow rule, and atomically publish the closed one-use release at the separate read-only `/run/baci-cwv-registration-release/release.json` mount. Prove Node accepts only one exact regular `0440 root:baci-cwv` canonical receipt with matching nonce/digests/generation/freshness, never rereads it, constructs the minimal exec environment only afterward, overwrites the buffer immediately before `process.execve`, and preserves no parent memory on successful exec; an immediate Listener connection after exec may proceed because release already occurred. Wrong path/mount/owner/mode/type/schema, missing/stale/replayed release, second generation/read, readable token, pre-release counter delta, or release without exact Node revalidation refuses. Any failed exec leaves Node alive only long enough for root to return egress to default-drop, delete/unmount the release handoff, and terminate/restore. Sealing is mandatory before normal start; normal start refuses any token, registration-release or active staging mount, populated staging path, and an existing `.runner` with changed repository/name/labels. Record/test the separate canonical semantic digest only under `policyCanonicalSha256`. Derive `custom_labels` by requiring exactly one each of `self-hosted`, `Linux`, and `X64`, subtracting those three defaults from `runner.labels`, requiring exactly one remaining label `baci-cwv-measurement`, and joining only the remainder; absent/duplicate/reordered-policy drift or a second custom/default label refuses. Pre-listener tests prove `Runner.Listener` is never spawned before a valid release, hold timeout/signal/malformed/expired/wrong campaign/wrong container/wrong policy/wrong classifier digest all fail without a listener, and no argv/env/mode bypasses the hold. Direct-listener tests require exact argv/cwd/update-disable/signal/exit behavior and fail if any runner shell/helper or general shell-spawn path executes. Static tests reject repository/name/label literals in entrypoint command construction. Task 2 tests entrypoint refusal logic and expected mount paths with fixtures; Task 5 owns executable Linux UID/GID `10001`, real mount immutability, normal-service mount absence, same-PID `execve`/token-unmount/egress-release behavior, and installer terminal-path cleanup proofs.

`direct-listener-conformance.mjs` makes both direct-launch decisions finite and pinned-version-specific rather than assuming either `Runner.Listener run --once` or `Runner.Listener configure` is interchangeable with upstream launchers. Its unit suite uses an injectable `process.execve` seam and fake Listener only to prove harness refusal behavior. Task 5 must then run the same harness with the accepted image's exact hash-verified Linux `/opt/node/bin/node` `v24.18.0` and exact hash-verified `v2.335.1` `Runner.Listener` in an isolated disposable container and local TLS runner-protocol fixtures with generated throwaway token/config/credential material. The registration fixture accepts exactly one direct `configure` transaction through the ready/unmount/default-drop/pre-exec-release/same-PID real-`process.execve` lifecycle; the run fixture admits exactly one synthetic no-op job with argv exactly `run --once` and proves adding `--disableupdate` is rejected by the pinned binary while update prevention remains effective through the reviewed environment/read-only/refusal contract. Neither fixture has an external endpoint. The conformance receipt binds Node binary/hash/version, Runner binary/hash/version, exact cwd/argv, complete allowlisted environment including the configure token input or normal update-disable/hook variables, protocol transcript hash, pre/post-exec PID and `/proc` identity, token-buffer cleanup observation, child process tree, token-mount unmount observation, pre-release network counters, egress-release receipt, job-start/finish, signal, cleanup, writable-path, and exit observations. Positive cases prove the actual pinned Node performs same-PID replacement, token path absence before exec, parent memory/process disappearance after exec, zero packets before pre-exec release, one direct configuration with no shell/helper, normal one-job exit, SIGINT and SIGTERM forwarding with no orphan Worker/PluginHost, required bootstrap/environment behavior, job/private-file cleanup, and exact exit-status propagation. Negative cases make real `process.execve` fail, omit/drift each required environment/config/input, retain token mount after ready, release/deliver egress early, fail buffer cleanup, fork a helper, request update/restart/second job, append configure-only flags to normal run, replace either binary, alter cwd/argv, induce Worker/PluginHost failure, or leave an orphan/writable sealed byte; every error path must return egress to default-drop, remove token/staging, leave zero process, and refuse image authorization. The harness records the pinned upstream `config.sh`/`env.sh` and `runsvc.sh`/`run.sh` source hashes and a reviewed semantic comparison showing which bootstrap responsibilities are supplied by the already-proven image dependencies and direct Node lifecycles; any later Node/runner version or behavior change requires a new proof and process-map review. Neither fixture contacts GitHub or starts a browser.

`registration-egress-probe.test.mjs` uses a local DNS/TLS fixture and test CA to prove only the parsed exact host/port/SNI/timeout can connect and that output is one secret-free Boolean receipt. It rejects DNS failure, timeout, bad CA/hostname, HTTP/plaintext, redirect or arbitrary URL input, a token/staging/runner/hook/admission mount, environment enumeration, browser launch, and any second destination.

`build-image.test.mjs` parses `policy.json`, executes the wrapper's dry-run mode, and proves `UBUNTU_IMAGE` equals `supplyChain.ubuntu.reference` byte-for-byte; `UBUNTU_SOURCES_BASE64` decodes to the one canonical policy-derived deb822 document with exact HTTPS URIs, suites, components, `Architectures: amd64`, `Signed-By`, and `Snapshot`; and every runner, CommandSettings, Node, pnpm, and Chrome URL/hash/integrity/version/allowed-origin argument equals the corresponding parsed policy field. It also proves `SUPPLY_CHAIN_PROVENANCE_JSON` equals the canonical serialization of the complete parsed `supplyChainProvenance` object, Node authorization invokes only `verify-node-bootstrap.sh` before the temporary Node extraction, and the authorized pinned Node invokes `supply-chain-provenance.mjs` for all remaining checks before their corresponding extraction or installation. It rejects a missing/extra argument, changed/reordered source/origin, changed policy value, literal supply-chain repository/URL/source/hash/integrity/origin/version in the Dockerfile, shell execution, Node execution before a valid bootstrap receipt, an unpinned platform, an in-VPS build path, or a direct Docker build contract outside the wrapper. Cleanup-mode tests accept only the documented `--output-archive` and `--output-receipt` flags, reject the stale `--archive`/`--receipt`/`--directory` aliases, symlinks, mixed parents, and recursive-directory deletion, and prove only the two exact output files are removed. A fake-root APT fixture begins with hostile `/etc/apt/sources.list`, `.list`, and `.sources` entries and proves the build deletes every default/live/third-party source, writes only the canonical policy source, refuses any second source or HTTP URI, validates the base archive keyring path/bytes, requires every selected suite's snapshot `InRelease` signature and referenced Packages index digest before package selection, and rejects signature, Release/index hash, package filename/version/architecture/hash, or post-verification source drift before installation. An exact pinned-base fixture proves the complete pre-APT executable/interpreter/library/keyring inventory exists with expected hashes before any source mutation. `verify-apt-snapshot.test.mjs` owns the exact hostile/missing/duplicate/malformed index and Ubuntu-package-row matrix plus canonical-receipt tampering cases, rejects Chrome/Google package or metadata rows in the pre-Node receipt, and `build-image.test.mjs` proves the helper and receipt verification occur before the first Ubuntu-runtime unpack while Chrome unpack is impossible until after the pinned-Node Chrome provenance receipt. `download-artifact.test.mjs` uses two local TLS redirect fixture origins with a test-only CA bundle to prove an allowed same-origin, allowed relative redirect, and the exact runner two-origin redirect pass; it proves every redirect target is validated before contact and rejects allowed-to-unapproved-to-allowed chains, HTTP downgrade, URL credentials, redirect loops/overflow, delayed connect, stalled headers, slow/no-progress body, overall-deadline exhaustion, missing/invalid digest, checksum mismatch, query logging, or partial output. `verify-node-bootstrap.test.mjs` uses fake `gpgv` and real local hashes to prove the precise authorization order and rejects every checksum/signature/keyring/row/archive/receipt drift. `supply-chain-provenance.test.mjs` uses local metadata/signature-command fixtures to prove every vendor chain and the CommandSettings source contract pass and individually rejects missing/duplicate/wrong asset, source/hash/secret-input semantic contract, checksum row, signature/key, SRI, package stanza, architecture, filename, and extracted-binary identity. Its semantic-fetch fixtures additionally cover allowed relative redirects, pre-contact rejection of allowed-to-unapproved-to-allowed chains, HTTP downgrade, URL credentials, redirect loops/overflow, delayed connect/headers, slow body, body/overall timeout cleanup, wrong status/content type, and the 1 MiB cap. No production code path may disable certificate verification or admit HTTP.

- [ ] **Step 2: Run RED**

```bash
node --test infra/cwv-runner/entrypoint.test.mjs infra/cwv-runner/isolation-probe.test.mjs infra/cwv-runner/registration-egress-probe.test.mjs infra/cwv-runner/direct-listener-conformance.test.mjs infra/cwv-runner/runner-identity-gate.test.mjs infra/cwv-runner/build-image.test.mjs infra/cwv-runner/download-artifact.test.mjs infra/cwv-runner/verify-node-bootstrap.test.mjs infra/cwv-runner/verify-apt-snapshot.test.mjs infra/cwv-runner/supply-chain-provenance.test.mjs
```

Expected: FAIL because the container files do not exist.

- [ ] **Step 3: Implement the pinned Dockerfile and entrypoint**

The policy-driven wrapper and Dockerfile must:

1. Have `build-image.mjs` run only on the development Mac, parse the policy, require and verify the canonical Task 5 source manifest contract above, and pass the complete frozen Ubuntu `reference` byte-for-byte as the pre-`FROM` `UBUNTU_IMAGE` build argument; the Dockerfile uses only `ARG UBUNTU_IMAGE` then `FROM ${UBUNTU_IMAGE}` and never assembles an image repository plus digest. The wrapper always uses exact `--platform linux/amd64` and `--output type=docker,dest=<owner-selected-temporary-path>`; it never invokes a remote builder or the production VPS Docker daemon. Execution is deliberately deferred until after PR A is merged/deployed and Task 5 freezes the exact merge-tree manifest; Task 2 may use only canonical in-memory/temp fixture manifests for tests and must not emit an importable archive/receipt. The final build emits a canonical receipt binding implementation merge commit, policy digest, source-manifest digest, platform, archive SHA-256, image config/id digest, and all provenance receipts. Archive and receipt paths are outside the repository and are deleted after verified import.
2. Install only Ubuntu runtime libraries needed by Git, Chrome, runner, `jq`, `curl`, `ca-certificates`, `iproute2`, `procps`, and `util-linux`; Chrome itself is explicitly not in this APT selection. Before the first APT command, delete `/etc/apt/sources.list` and every `.list`/`.sources` entry, reject any remaining source file, decode the single canonical `UBUNTU_SOURCES_BASE64` argument, and atomically install it as the only deb822 source. That document is generated solely from the parsed policy and contains only the two exact HTTPS official Ubuntu URIs, exact suites/components/order, `Architectures: amd64`, the frozen-base archive `Signed-By` path, and exact `Snapshot: 20260720T000000Z`; no default, live, PPA, Google, vendor, mirror, `deb-src`, environment substitution, or later source mutation is permitted. Before Ubuntu package installation, require APT signature enforcement with insecure/weak/unauthenticated modes false, verify the frozen-base keyring bytes are unchanged from the pre-source receipt, resolve every configured pocket to the exact snapshot service, and invoke only `verify-apt-snapshot.sh` to verify every Ubuntu snapshot `InRelease`, referenced Packages index digest, and exact selected Ubuntu package filename/version/architecture/SHA-256 row. That frozen-base shell verifier emits and re-reads the byte-exact canonical receipt, recomputes its digest and each authorized local archive digest, and only then permits those exact Ubuntu archives to be unpacked; a Node-based pre-install gate is forbidden. After the pinned Node bootstrap, independently reparse the same receipt with `canonicalJson()`, require canonical byte/digest/row equality, and bind that package-receipt digest into the image/build receipt. Tests reject Chrome/Google rows in the pre-Node receipt, an unscoped `apt update/install`, a literal/different snapshot id, unauthorized source, source/index/Release/signature/keyring/package hash mismatch, duplicate/malformed receipt row, post-shell/pre-Node receipt or archive drift, or later package-manager/source mutation. The policy-derived base digest, canonical official Ubuntu source document, exact signed snapshot metadata, and verified Ubuntu package rows are the complete pre-Node APT resolution boundary.
3. Have the wrapper pass runner, CommandSettings, Node, pnpm, and Chrome URL/SHA/integrity/version/allowed-final-origin arguments only from the parsed policy. The Dockerfile downloads every immutable byte input through `download-artifact.sh`; that helper accepts only an HTTPS initial URL whose origin is already allowed, requires an exact SHA-256, validates scheme/credentials/origin before contacting the initial URL and every resolved redirect target, follows at most five allowlisted HTTPS hops under its per-hop/overall deadlines, verifies the digest, and deletes partial/download bytes in the same layer. The runner may terminate only at `https://github.com` or `https://release-assets.githubusercontent.com`; CommandSettings may terminate only at `https://raw.githubusercontent.com`; the other immutable artifacts terminate only at their frozen origins. Authorize Node first with `verify-node-bootstrap.sh`, extract only the authorized archive into a temporary bootstrap path, and invoke that exact Node to run `supply-chain-provenance.mjs` for the bounded exact-origin runner release and pnpm semantic JSON reads, Node receipt cross-check, exact CommandSettings raw bytes plus source semantics, Chrome signed APT package stanza, and other already raw-hash-verified provenance documents before each affected install/extract. pnpm integrity is then recomputed independently over the raw-hash-verified tarball. URL, origin, path, version, checksum, signature, keyring, metadata, bootstrap receipt, CommandSettings contract, content-type/size/timeout bound, or integrity drift refuses. Raw-hash-verified provenance bytes are removed in the same layer; the two semantic JSON responses are memory-bounded and never written or emitted.
4. Install Node under `/opt/node` and runner under `/opt/runner`. Install Chrome from the exact local Debian package path only after the pinned Node verifier has durably emitted and immediately revalidated the Chrome provenance receipt binding the hash-pinned Google key, signed `InRelease`, referenced `Packages.gz`, exact package stanza, and raw `.deb` SHA-256; use direct local unpack/configuration only and never add a Google APT source or invoke dependency resolution for Chrome. Use `gpgv` only during the build provenance stage with the hash-pinned Node keyring and Google signing-key bytes; delete all metadata, keys, signatures, and build-only verification packages before the final runtime layer. Download the exact pnpm npm tarball from policy, verify both its frozen SHA-256 and integrity bytes before extracting it to `/opt/pnpm`, expose only its `bin/pnpm.cjs` through the reviewed Node runtime, and delete the tarball in the same layer; never let Corepack resolve/download an unpinned package-manager distribution.
   The Dockerfile is explicitly multi-stage: a verifier/install stage performs every download, APT resolution, signature/provenance check, Chrome local unpack, and tool extraction; the final runtime stage copies only the closed runtime filesystem projection and canonical secret-free receipts from that stage. No APT list/cache, `.deb`/tarball/archive, signing key/keyring copy, signature, checksum/Packages/InRelease document, provenance source, temporary bootstrap Node, build-only verifier/package, or download directory is copied. Where a package manager mutates the runtime root, download, verification, installation into that root, and deletion of all temporary inputs occur in one verifier-stage `RUN` layer before projection. `build-image.mjs --verify-archive` inspects every exported layer diff plus final rootfs/config/history directly from the archive and rejects any forbidden basename/path/content signature, whiteout-dependent secret removal, build-arg leakage, extra package, or undeclared file; tests seed each forbidden artifact and prove rejection.
5. Create UID/GID `10001` user `runner`, create only the registration/work/diag/scratch mount points with the required ownership, and end with `USER runner`.
6. Set no repository URL, token, App credential, PSI key, PostHog key, or cookie in any image layer.

`registration-egress-probe.mjs` uses only a pinned-Node `dns.promises.Resolver().resolve4` instance and `tls.connect`. One shared ten-second deadline covers DNS plus TLS; expiry calls `resolver.cancel()`, destroys any active TLS socket, and leaves no pending DNS/TLS handle. It accepts no CLI destination, reads the validated embedded policy, selects exactly one IPv4 address from that dedicated resolver result, and passes that literal address—not the hostname—as `tls.connect`'s `host`, while retaining exact port `443`, `servername=github.com`, and `rejectUnauthorized=true`. A global/default `dns.lookup`, a second implicit resolution, or a connection attempt to a second address is forbidden and tested. DNS-timeout and TLS-timeout fixtures require resolver cancellation, active-socket destruction, shared-timer cleanup, and no pending handle. Success destroys the socket immediately after `secureConnect` and writes only canonical `{ "ok": true }`; it sends no application bytes. The Dockerfile installs it under `/opt/baci-cwv/` with the same immutable source manifest as the entrypoint.

In registration mode the entrypoint requires `/registration-staging` itself to be owned by UID/GID `10001` with mode `0700`, copies `/opt/runner/.` to `/registration-staging/actions-runner/`, verifies the copied binary SHA, hashes the exact embedded `/opt/baci-cwv/policy.json` file bytes, requires equality with the single-line lowercase raw-file digest in read-only `/run/baci-cwv-policy/policy.sha256`, requires byte equality with the reviewed image/source-manifest entry, and only then parses/validates policy and derives the repository URL, runner name, and custom label. It records the canonical semantic digest separately and rejects missing/extra/default-label duplication or any raw/canonical digest/value drift, changes directory to that staging copy, reads the short-lived token without echoing it, and replaces the PID-1 Node process directly with the copied Listener using the policy-derived argv:

```text
/registration-staging/actions-runner/bin/Runner.Listener configure \
  --unattended \
  --url "$repository_url" \
  --name "$runner_name" \
  --labels "$custom_labels" \
  --work "/runner-work" \
  --disableupdate
```

Registration mode never starts `Runner.Listener run`. Before reading a token it requires the image-embedded, secret-free CommandSettings source-contract receipt to match the exact policy URL/hash, runner archive identity, reviewed secret-input semantics, and the pinned Node `process.execve` contract; missing or drifted receipt refuses registration. The entrypoint reads the token once into a mutable Node-owned buffer without echo, emits the secret-free ready receipt, and waits with registration egress default-dropped. Root validates the exact Node PID/namespaces/receipt, namespace-unmounts the token, deletes host file/nonce, and proves both views absent; Node requires token-path `ENOENT`. Root then revalidates the same hash-bound Node/PID/namespaces/argv and zero counters, activates the narrow policy-derived rule, and atomically publishes the exact one-use release at read-only `/run/baci-cwv-registration-release/release.json`. Node accepts/marks consumed only that canonical bound receipt, constructs the minimal `execve` environment with `ACTIONS_RUNNER_INPUT_TOKEN`, overwrites the read buffer immediately before calling `process.execve`, and on success is atomically replaced so no parent Node memory survives. The token is never in argv or Docker `Config.Env`. The pinned `v2.335.1` `CommandSettings` implementation must match the frozen source receipt: it masks secret input, copies it to its internal argument map, and removes `ACTIONS_RUNNER_INPUT_TOKEN` from the Listener environment before configuration. Root then verifies the exact same-PID Node-to-Listener executable/argv/environment transition and deletes/unmounts the release handoff. If `execve` throws or transition verification times out/drifts, root immediately returns egress to default-drop, deletes/unmounts the handoff, and terminates/restores. Tests reject a changed source/hash/runner/Node binding or semantic contract, missing receipt, token-shaped argv, Docker environment injection, shell/helper execution, environment/log dumping, token accessibility at exec, pre-release network delivery, release path/schema/owner/mode/replay/drift, a second process, or a surviving token variable in the configured listener. After direct configuration exits, the host installer re-proves token/release absence, validates identity, moves the complete staged runner application into the non-writable sealed tree, creates only the separate writable work/diag/scratch mounts, and removes staging. Normal mode validates sealed `.runner` plus policy, requires empty read-only normal release and no registration-release mount, and enters bounded hold without Listener. The service must not pass `--hostname`; entrypoint binds the eventual release's full Docker id to the exact default 12-hex `/etc/hostname` prefix and campaign id. Root writes one canonical normal release record containing campaign id, full container id/prefix, capture SHA, policy SHA, runner IP, veth/peer/egress identities, exact nftables ruleset/classifier digest, live-sample digest, creation monotonic time, and expiry no later than the policy hold deadline. Only an exact mode-`0440 root:baci-cwv` record in the normal read-only release directory may cause `/opt/runner/bin/Runner.Listener run --once`; it never deregisters automatically. Each controller activation accepts at most one job; rejected/mismatched assignment consumes activation and is terminal.

- [ ] **Step 4: Run GREEN and prove the local builder contract without producing an accepted archive**

```bash
node --test infra/cwv-runner/entrypoint.test.mjs infra/cwv-runner/isolation-probe.test.mjs infra/cwv-runner/registration-egress-probe.test.mjs infra/cwv-runner/direct-listener-conformance.test.mjs infra/cwv-runner/runner-identity-gate.test.mjs infra/cwv-runner/build-image.test.mjs infra/cwv-runner/download-artifact.test.mjs infra/cwv-runner/verify-node-bootstrap.test.mjs infra/cwv-runner/verify-apt-snapshot.test.mjs infra/cwv-runner/supply-chain-provenance.test.mjs
docker buildx version
docker buildx ls
```

Expected: the current Task 2 contract suite passes; its count may change when required helpers are split or integrated under the cumulative Task 1-6 rule. The development Mac's local builder is present and advertises `linux/amd64`; fixture tests prove exact source-manifest/digest refusal, build argv, receipt generation, archive verification, direct configure/run harness refusal behavior, and bounded cleanup without invoking Docker. No accepted archive or receipt exists yet. Task 5, after PR A merge/deployment and exact source-manifest freeze, performs the sole real build and requires `--verify-archive` to read Docker `manifest.json` plus its referenced config directly from the archive without loading it into any daemon, verify receipt/archive/config/platform/history/source-manifest bindings, and print `linux/amd64 sha256:...`. Require no secret, mutable apt source, Corepack fetch, or unpinned URL. Do not run Chrome, a normal listener, registration, or a real external probe in this step. Task 5's Linux probe owns real UID/mount semantics and actual pinned Listener configure/run conformance. If the development Mac lacks a working local amd64/QEMU builder, stop for owner direction; never fall back to the production VPS, a remote daemon, or the host architecture.

- [ ] **Historical Step 5 seed — do not execute: commit the container unit**

> **Non-executable historical block.** The cumulative Task 1-6 integration rule supersedes this per-task CodeRabbit, `git add`, and `git commit` example. Use it only to understand the original design boundary; stage and commit only the final manifest-driven integration set.

```text
Historical boundary only: the closed image build, archive/link verification, frozen supply-chain fetch and receipts, exact rootfs/runtime projection, entrypoint, runner identity, direct-listener conformance, registration release/probe, and their contracts formed the container unit. No review, staging, or commit command from the superseded per-task procedure is retained.
```

---

### Task 3: Add reversible shared-host quiescence and Ollama retirement

**Files:**
- Create: `infra/cwv-runner/campaign-state.mjs`
- Create: `infra/cwv-runner/campaign-state.test.mjs`
- Create: `infra/cwv-runner/campaign-quiesce.sh`
- Create: `infra/cwv-runner/campaign-restore.sh`
- Create: `infra/cwv-runner/retire-ollama.sh`
- Create: `infra/cwv-runner/host-scripts.test.mjs`
- Create: `infra/cwv-runner/cron-inventory.json`
- Create: `infra/cwv-runner/ollama-active-inventory.json`: reviewed active unit/drop-in/environment-file/proxy/container/cron/process path hashes and endpoint dispositions required before retirement apply.
- Create: `infra/cwv-runner/campaign-watchdog.sh`
- Create: `infra/cwv-runner/baci-cwv-campaign-watchdog@.service`
- Create: `infra/cwv-runner/campaign-watchdog.test.mjs`

**Interfaces:**
- `campaign-quiesce.sh <mode> <transaction-id>` accepts only the closed mode enum `prepare`, `registration`, `campaign`, or `rehearsal`; creates immutable durable `/srv/baci-cwv/campaigns/<transaction-id>/capture.json` plus `capture.sha256`, each mode `0600` under a `0700 root:root` parent; acquires transient `/run/lock/baci-cwv-campaign.lock`; and prints only the immutable capture SHA. The mode is an explicit argv value and is bound into the capture before mutation; no ambient environment flag selects behavior. Mutable progress is separate: atomically replaced `phase.json` and fsynced immutable per-step `journal/<sequence>-<entry-sha>.json` files never alter the capture bytes/hash. Durable capture is required for reboot recovery; secrets/tokens are never stored there.
- `campaign-restore.sh <transaction-id> <capture-sha256>` verifies only the immutable capture bytes/hash as authority, derives the already-bound closed mode from that capture rather than caller input, reconciles every captured resource idempotently regardless of journal completeness, restores exactly once, and writes `restored.json` including any phase/journal anomaly.
- `retire-ollama.sh --scan` is read-only; `--apply` requires an empty dependency report and records `/srv/baci-cwv/retired-ollama/receipt.json` before deletion.
- `baci-cwv-campaign-watchdog@<transaction-id>.service` is a root-owned independent systemd unit bound to the canonical transaction id/state hash and one closed mode enum: `prepare`, `registration`, `campaign`, or `rehearsal`. It invokes the corresponding idempotent stop-delete/reconcile-restore path after controller death, timeout, or reboot recovery; arbitrary mode/command dispatch is impossible.
- The repository unit template contains exactly one literal `@BACI_CWV_SOURCE_SHA@` token in `ExecStart=/srv/baci-cwv/source/@BACI_CWV_SOURCE_SHA@/campaign-watchdog.sh %i`. Task 5 renders only that token to the validated lowercase 40-hex merge SHA after the source tree is sealed, installs the rendered unit root-owned, and binds its bytes to the bootstrap receipt. No `/srv/baci-cwv/bin`, `current` symlink, PATH lookup, or mutable stable alias is authorized.

- [ ] **Step 1: Write RED state-machine and shell-shape tests**

Test these behaviors with temporary directories and PATH stubs:

- a second campaign cannot acquire the lock;
- a stale/missing/mismatched-host immutable capture is rejected;
- restore rejects a changed capture hash and double restore, while a truncated/missing/changed phase or journal entry is recorded as an anomaly but cannot prevent idempotent reconciliation from the valid immutable capture;
- quiescence snapshots each runner service, timer, Docker cpuset, and systemd slice CPU set before mutation;
- acquisition performs the mark-collision inventory as part of its read-only prior-state capture, writes/fsyncs the complete immutable `capture.json` and `capture.sha256`, writes separate phase `acquiring`, then starts and verifies the independent watchdog bound only to the capture SHA before changing cron, runners, timers, cgroups, containers, or nftables; it cannot return success until every mutation has a separate fsynced hash-chained journal entry and phase `active` is atomically fsynced;
- other runner services stop, but application containers are updated only to CPUs `0-1`, never stopped;
- `cwv-measurement.slice` receives CPUs `2-3`, while `system.slice`, `user.slice`, and `machine.slice` receive `0-1` for the lease;
- restore replays exact prior values in reverse order even after a partial quiescence failure;
- Ollama apply refuses any dependency other than its own service, watchdog, model directory, or `ollama-loopback`;
- retirement accepts only pre-retirement whole-crontab SHA-256 `a57aee33c02252e61943639c292e96a695ee75a33d92f730fd1be830a67a747b`, atomically removes the two exact reviewed lines, and requires post-retirement SHA-256 `603d5005ad4f7b7d8c535be7ac8b8379b69a83b550014a56b2dfa6bbdb51ba8f`;
- every later campaign quiescence accepts only the post-retirement whole-crontab hash and rejects any active line missing from the reviewed post-retirement inventory;
- cron-owned runner roots and every active cron job have `campaignDisposition:"pause"`, and restore reinstalls the exact archived bytes only after verifying their SHA-256;
- retirement removes only the two reviewed Ollama cron entries with line hashes `4cee5cdc723001694bc0d2ea22be4db9ff91a1df5f969dc95d2483f55900519d` and `3b27b446d253183977b01ea6e94c09a0d5bb4ac7d2414ad162ddd7fb49a6fc81`;
- watchdog survives controller/SSH process-group death, has `RuntimeMaxSec=30m`, restores after SIGKILL and reboot, rejects stale/mismatched state hashes, and makes duplicate/partial cleanup converge without starting another runner;
- the watchdog template has exactly one source-SHA token, its rendered `ExecStart` resolves inside the same receipt-bound immutable source tree, and unresolved tokens, a different SHA/path, `/srv/baci-cwv/bin`, `current` symlinks, PATH lookup, or any second substitution refuse;
- prepare-mode watchdog tests kill the installer plus its supervisor before daemon start, after each daemon start, during synthetic/real import, after target verification but before cleanup, after cleanup but before disarm, and across reboot. Before an fsynced `target-accepted` phase it stops the dedicated units, deletes the entire receipt-owned still-unaccepted dedicated data roots plus import staging, and writes a durable refusal/repair receipt; after exact target id/config verification and fsynced `target-accepted`, it retains that target/root, removes archive/synthetic staging, stops the units, and writes the success recovery receipt. A pre-existing accepted target may only equal the same receipt and is never deleted or replaced;
- a controller trap is installed before invoking acquisition; tests kill the controller before acquisition, after durable-state fsync, after watchdog activation, after each individual mutation, and during rehearsal, proving that no mutable host state is left without either the live trap or already-active watchdog protection;
- campaign nftables tests use a PATH-stubbed exact transaction and hook-matched counter fixtures: classification is `forward -150` and forwarded ingress accounting is `forward 0`; the ingress forwarded-total rule requires only validated external `iifname` plus nonlocal destination, while the marked rule additionally requires runner-facing output identity and the exact campaign mark. A separate host-local-ingress rule in the policy-named base chain uses input priority `0` and exact external `iifname`; egress forwarded-total/marked rules both require the validated external `oifname` and `meta iif != 0`; a separate host-egress rule in the policy-named chain uses the same postrouting hook/priority, exact external `oifname`, and `meta iif 0`. Tests cover total externally forwarded traffic, a concurrent DNATed external-to-production-bridge ingress control that increments only forwarded total and never host-local/measurement, marked runner external traffic, true input-delivered host-local external ingress (including large response payloads), host-originated external traffic (including host-proxied DNS), explicit local-versus-forward mutual exclusion, bridge-only/container-local/Docker-embedded DNS exclusion, direct runner DNS inclusion as marked measurement, ambient ingress equal to forwarded-minus-marked plus host-local ingress, ambient egress equal to forwarded-minus-marked plus host-egress, concurrent ambient traffic, veth/egress-interface replacement, selector/conntrack-mark drift, reversed/equal classifier-counter priority, missing/reordered host-local-ingress or host-egress rules, counter reset/wrap, negative subtraction, partial install, and exact cleanup/restore;
- exact-network tests require read-only `/proc/sys/net/ipv4/ip_forward` equals `1`, forbid any sysctl/procfs write, and require the dedicated network/container has IPv6 disabled with no IPv6 address/default route, `CapEff=0`, `CapPrm=0`, `CapBnd=0`, `NoNewPrivs=1`, Docker `CapDrop=["ALL"]`, no `CapAdd`, and `SecurityOpt` containing only the reviewed no-new-privileges value. They derive exact receipt-owned input/forward chain names plus the canonical denied CIDR set from policy, inventory every host local/public/gateway address and production bridge/network subnet, and refuse overlap or an unrepresentable route. They create the two empty owned chains first; populate an input rejection keyed only to `-i baci-cwv0`; populate a first forward rejection for any `-i baci-cwv0` packet whose source is outside the exact runner subnet, interface-keyed internal-destination rejection, exact-source/external-interface egress and return acceptance, and a final `-i baci-cwv0` rejection independent of claimed source/MAC; insert exact tagged jumps at `INPUT` and `DOCKER-USER` position `1`; then insert the exact NAT rule at `POSTROUTING` position `1`. Tests prove final jump/rule order before all pre-existing rules, runner rejection of the bridge gateway, every host-local/public address, every denied/special/private CIDR, production bridge/service subnet, and non-external interface while exact public internet TLS succeeds. Live adversarial probes also prove a job cannot create an IPv4 source-spoof packet, raw IPv6/link-local frame, AF_PACKET socket, MAC-spoof transmission, or alternate-interface packet; fixtures prove the interface-keyed first/final rejects still catch crafted-source packets even if the capability contract regresses. Tests reject any capability/security-option/anchor/backend/comment/order/readback/owned-chain/host-address/route drift and remove a partially inserted set in reverse journal order;
- network-threshold tests use the one shared overflow-safe byte-delta helper for preflight and spanning samples, require interval duration exactly `networkSampleSeconds`, prove the inclusive ten-second limits for both ingress and egress, accept exactly `10 * 1,048,576` bytes, reject one byte more and `10 MiB/s`, and reject overflow, reset, wrap, negative same-hook subtraction, mismatched intervals, or division/floating-point conversion;
- registration-only state tests prove the durable watchdog/capture is active before daemon/network/rule mutation, host-local/private/cross-network isolation is active before the secret-free TLS probe, the probe succeeds before token mount, no measurement table/sampler/browser/normal listener starts, and success plus every failure/signal/controller-death/reboot path deletes token/staging first, removes exact jumps/owned chains/NAT/network, stops dedicated daemons, and restores unchanged production tuples;
- before mark installation, a read-only collision audit canonicalizes the full nftables ruleset excluding the absent owned table, `iptables-save`, `ip6tables-save`, IPv4/IPv6 `ip -json rule`, ingress/egress `tc -json filter` for every interface, and `/proc/net/nf_conntrack`; it rejects any ct/meta/packet-mark writer, masked reader, policy-route rule, traffic-control action, or live conntrack entry that can set, match, preserve, or consume the exact derived 32-bit mark. Tests cover exact and masked collisions, unrelated marks, malformed/unsupported expressions, missing tools/procfs, and inventory drift;
- the privileged scanner may read candidate endpoint values transiently, but no script prints, logs, persists, artifacts, or returns a raw environment value or Docker environment array; output is limited to key name, endpoint class, normalized-value SHA-256, source-path SHA-256, and reviewed disposition.

- [ ] **Step 2: Run RED**

```bash
node --test infra/cwv-runner/campaign-state.test.mjs infra/cwv-runner/host-scripts.test.mjs
```

Expected: FAIL because the state and shell files do not exist.

- [ ] **Step 3: Implement the state machine and scripts**

The quiescence script must snapshot and stop these known GitHub runner listeners when present:

```text
actions.runner.ogabasseyy-Baci.baci-deploy.service
actions.runner.ogabasseyy-Baci.baci-deploy-2.service
actions.runner.ogabasseyy-Baci.baci-android.service
actions.runner.*CleanContacts*.service
```

Because actual unit names may differ, enumerate candidates by `Runner.Listener` PID, resolve each cgroup/unit and runner root, and require every candidate to map to a captured unit before proceeding. An unowned listener is a hard refusal.

Systemd enumeration is insufficient on this VPS. Ollama retirement alone accepts pre-retirement `bassey` crontab SHA-256 `a57aee33c02252e61943639c292e96a695ee75a33d92f730fd1be830a67a747b`, removes only the two approved line hashes, and atomically verifies post-retirement SHA-256 `603d5005ad4f7b7d8c535be7ac8b8379b69a83b550014a56b2dfa6bbdb51ba8f`. Every campaign acquisition occurs after retirement and requires that post-retirement hash, archives its exact bytes mode `0600`, and validates every remaining active line against `cron-inventory.json`. That inventory includes cron-owned runner roots `/home/bassey/actions-runner-cleancontacts-deploy` and `/home/bassey/actions-runners/baci-deploy-2`, plus every remaining scheduled maintenance/worker command, all with `campaignDisposition:"pause"`. Stop `cron.service`, terminate only the captured process trees rooted at those exact runner/job commands, and prove no `cron`, `at`, or captured runner worker remains before starting the measurement runner. Restore the exact post-retirement crontab bytes/hash and prior cron service state only after the measurement runner is offline; never restore the retired Ollama lines. A newly added, missing, or changed cron line is a hard refusal requiring a new reviewed inventory.

Capture currently active nonessential system timers before changing them. During that same read-only capture, load every family/table/chain/hook/priority/mark input through `policy.schema.mjs get /networkAccounting/...`, derive the full 32-bit campaign mark only through `policy.schema.mjs campaign-mark <transaction-id>`, complete the collision audit above, and persist its secret-free canonical digests in immutable `capture.json`. Read `/proc/sys/net/ipv4/ip_forward` and require the single byte value `1`; the controller is forbidden to write any sysctl. Capture canonical `iptables-nft` readback of `filter/INPUT`, `filter/DOCKER-USER`, and `nat/POSTROUTING`; every host IPv4/IPv6 local/public/gateway address; every route and production Docker/bridge/network subnet; and the exact external interface name/ifindex. Require all three chain anchors, no existing `baci-cwv:` comment or owned-chain prefix, no overlap with the policy runner subnet, no unrepresentable route, and IPv6 disabled for the dedicated network/container. Bind all baseline digests and the canonical policy-denied CIDR set into the immutable receipt. Then fsync the capture/hash and verify the watchdog as described before any mutation. After watchdog activation, re-read and hash-verify the non-owned mark/routing/filter/address/network inventories and IPv4-forwarding value against the capture immediately before creating any owned chain, table, or tagged jump/rule; drift refuses and triggers the still-safe restore path. Stop the captured timers for the lease without disabling them permanently. The only timer allowed to start during the lease is the essential `baci-cwv-host-sampler.timer`. Stop and snapshot the non-application `autoheal` management container so it cannot recreate a container with an unrestricted cpuset; restore it after the lease. Never stop or reconfigure `ssh`, production Docker/containerd, general networking, certificate-serving, database, or application services. Never alter a Docker-managed firewall rule. The only shared-chain mutations permitted are three exact receipt-bound entries: one `INPUT` jump, one `DOCKER-USER` jump, and one `POSTROUTING` NAT rule; all other isolation rules live only in two receipt-owned per-campaign chains with names derived from the policy prefixes plus canonical campaign hash. Pin every running non-measurement application container to CPUs `0-1`; the capture records each prior cpuset string. Configure the measurement slices as sibling cgroups, re-prove the dedicated namespace is collision-free, start only `baci-cwv-containerd.service` then `baci-cwv-docker.service`, and start no browser. For a normal exact-run or registration-only acquisition, create/readback-verify only `baci-cwv-net`; require its container has no IPv6 address/default route and zero effective, permitted, or bounding Linux capabilities with `NoNewPrivs=1`. Every registration, held-listener, and normal runner container is created with exact Docker args `--cap-drop=ALL --security-opt no-new-privileges=true` and no `--cap-add`; inspected host config plus `/proc/self/status` are bound into the admission receipt and rechecked before listener release. Under the active rollback trap, create the exact empty owned input/forward chains first. Populate the input chain with one `-i baci-cwv0 -j REJECT` rule independent of source address/MAC so the runner cannot reach the bridge gateway, host public/local addresses, or any host service. Populate the forward chain in canonical order with an interface-keyed rejection for any runner-bridge packet whose source is outside the exact runner subnet, one `-i baci-cwv0` rejection for each policy-denied special/private destination CIDR, one `-i baci-cwv0` rejection for every captured production bridge/network subnet not already covered, one exact-source/runner-bridge-to-exact-external-interface accept, one exact external-interface-to-runner-bridge destination-subnet `ESTABLISHED,RELATED` accept, and a final `-i baci-cwv0 -j REJECT` so spoofed-source, cross-network, or alternate-interface forwarding fails closed. Insert the tagged input and forward jumps at position `1` in their shared chains, then the exact source-subnet/external-interface masquerade at `POSTROUTING` position `1`, all through fixed absolute `/usr/sbin/iptables` argv. Journal/read back every chain/rule/jump before the next; a partial failure deletes journaled entries and owned chains in reverse dependency order. Require exact positions/specifications/comments through `iptables -C` and canonical save readback, exact owned-chain byte digests, and unchanged remaining rule sequence/bytes. Live pre-authorization probes must reject bridge-gateway, host-public/local, special/private, production-bridge/service-subnet, non-external-interface, spoofed IPv4 source, raw IPv6/link-local, AF_PACKET, and MAC-spoof attempts while DNS plus the policy-bound public TLS probe succeed. Any missing capability/readback/security option/anchor, `ip_forward!=1`, IPv6 presence, non-`iptables-nft` backend, insert/readback ambiguity, host/route/network/source-set drift, pre-existing prefix, or unrelated chain drift refuses and rolls back only the receipt-owned entries/chains. Registration-only mode must complete those isolation probes before its credentials-free TLS proof and must remove the transaction before reading stdin on failure. Only a normal exact-run's clean, unchanged collision and isolation audit may create the fixed root-owned measurement-accounting table, and only if that table was absent; a pre-existing table refuses acquisition. With the frozen policy values, `classify` is `type filter hook forward priority -150; policy accept`, `external_ingress` is `type filter hook forward priority 0; policy accept`, `host_external_ingress` is a disjoint `type filter hook input priority 0; policy accept` chain, `external_egress` is `type filter hook postrouting priority 0; policy accept`, and `host_external_egress` is a second `type filter hook postrouting priority 0; policy accept` chain. The validated external interface name and ifindex are captured before mutation and reverified before every sample. The ingress forwarded-total rule requires the validated external `iifname` and nonlocal destination across every forwarded output; the marked-measurement subset additionally requires the validated runner-facing output identity and exact campaign conntrack mark. The host-local-ingress chain requires the same validated external `iifname`; only packets routed to local input can traverse it, while DNATed/container traffic traverses only the forward counter. The egress chain's forwarded-total and marked-measurement rules both require the validated external `oifname` and `meta iif != 0`, with the marked rule additionally requiring the exact campaign conntrack mark; the host-egress chain requires the same validated external `oifname` and `meta iif 0`. Ambient ingress is forwarded total minus measurement plus host-local ingress; ambient egress is forwarded total minus measurement plus host-egress. This excludes bridge/local/Docker-embedded DNS while deliberately counting production-container ingress, host-local responses, host-proxied DNS, and all other host external traffic exactly once as ambient; a fixture that can increment both input and forward for one packet is a hard refusal. The full 32-bit mark is only the exact unsigned value returned by the shared helper for that same transaction id; this controller performs no independent hash, bit selection, or input renaming, and malformed/colliding identity refuses. When the exact runner container exists through only the dedicated socket, validate its Docker id, IPv4-only network endpoint, container IP, host-veth name/ifindex/peer, zero capabilities/no-new-privileges state, external interface name/ifindex, and helper-derived conntrack mark, then atomically install the rule that marks only `iifname <runner-veth> oifname <external>` flows before the runner becomes online. Before every sample, re-require `ip_forward=1`, no IPv6, zero capabilities/no-new-privileges, and hash-verify that all non-owned mark/routing/filter/address/network inventories remain equal to the captured baseline plus the exact three shared entries and owned chains; every live exact-mark conntrack entry must parse and bind its original source tuple to the validated runner container IP. Unsupported syntax, unrelated exact-mark tuple, missing/changed host-local-ingress or host-egress chain/rule/handle/counter, or drift refuses. The owned accounting table never accepts/drops/redirects packets and modifies only the validated runner flow's conntrack mark. A rehearsal acquisition instead runs its disposable probe with `NetworkMode=none`, `--cap-drop=ALL`, and `--security-opt no-new-privileges=true` and proves the dedicated network, bridge, jumps/NAT/owned chains, runner veth/classification, and measurement table remain absent; it still tests cgroup, daemon, watchdog, sampler-local, and restore mechanics. Restore deletes only the exact digest-bound accounting table after the runner is offline, deletes the three shared entries before flushing/deleting the two receipt-owned chains, removes the exact dedicated network while its daemon is responsive, stops only the dedicated CWV daemons, and proves every captured chain/address/route/network digest, IPv4-forwarding value, and prior absent network/bridge state. If the dedicated daemon is unavailable, cleanup first proves its entire control cgroup and every dedicated container/shim are dead, removes the exact shared entries and owned chains, deletes only the receipt-bound `baci-cwv0` link, preserves the dedicated data root for forensic refusal, and blocks future acquisition until `install.sh --repair-dedicated-runtime` reconciles that receipt without touching production state. Only after local-only live sampling is armed may the sampler timer start. Tests require every rendered value to equal the parsed policy and fail when prose/template/argv bytes are stale.

Every mutable mode installs its unconditional restore trap before calling the state controller. Acquisition first obtains the exclusive lock, captures the complete prior state without mutation, writes/fsyncs immutable `capture.json` plus `capture.sha256`, writes the closed mode and separate phase `acquiring`, and enables/starts `baci-cwv-campaign-watchdog@<transaction-id>.service` as a root systemd unit independent of the SSH/controller process group. It verifies the bound transaction id/mode/capture SHA and active unit before the first mutable operation; watchdog activation failure removes the still-unmodified lease and refuses. Each subsequent mutation gets a separate immutable hash-chained journal entry and atomically advances only `phase.json`; neither can alter the capture hash, and restore never depends on journal completeness. Campaign acquisition returns only after phase `active` is fsynced. The same durable envelope is mandatory for prepare, registration, and rehearsal; `--prepare` accepts only read-only external archive/receipt paths before this envelope and cannot create or move transaction-owned bytes until protection is active. The root-only durable environment file contains only transaction id, mode, capture SHA, source digest, creation boot id, UTC deadline, and monotonic deadline—no GitHub or runner token. The unit orders `After=baci-cwv-containerd.service baci-cwv-docker.service` but does not require either daemon to stay alive for cleanup, uses `RuntimeMaxSec=30m`, and remains a persistently enabled escaped instance until cleanup. On the same boot it cleans at the earlier deadline; after any reboot/boot-id change it cleans immediately. Campaign/registration cleanup stops the applicable container, deletes token/admission state first, stops sampler when present, removes the exact accounting table/tagged rules/network when present, stops both dedicated daemons, invokes idempotent restore, and verifies `restored.json`. Prepare cleanup never creates or removes a network/rule. It first removes the exact receipt-owned synthetic/import containers while the dedicated socket is responsive; if unavailable, it terminates only the captured receipt-bound container/shim scopes, then proves all dedicated control/measurement cgroups and runtime processes empty and both dedicated sockets dead. Only after that quiescence proof may it reconcile content: before fsynced `target-accepted` it removes only the receipt-owned unaccepted data/import roots, while at/after `target-accepted` it retains the exact verified target and removes only archive/synthetic staging; then it verifies the production capture and writes the mode-specific recovered receipt. All modes disable/remove their own persistent instance link/environment file only after reconciliation and mark watchdog complete. The watchdog never stops or changes production Docker/containerd or any Docker-managed firewall rule, never kills a process not bound to its receipt, and never promotes an unverified partial target. The normal controller disarms it only after the same verified reconciliation. Bind the watchdog unit/script digests into the immutable capture and the later Task 4/5 attestation/source manifest. Task 1 `policy.json` remains byte-frozen and is not rewritten with post-Task-1 implementation digests.

The Ollama dependency scan must search active service definitions/drop-ins, EnvironmentFiles, timers, reverse-proxy config, Compose/container definitions, current crontab, and running process/container command lines for `ollama`, `11434`, or the loopback container. It may inspect candidate values transiently inside the privileged process, but emits only key name, endpoint class (`ollama-loopback`, `external-provider`, `disabled`, or `unknown`), normalized-value SHA-256, source path/hash, and disposition; raw values never cross the process boundary. Historical source, docs, and logs are evidence, not live blockers. Known active records include `/etc/systemd/system/ollama.service.d/baci-quiz-limits.conf` and `/etc/systemd/system/ollama.service.d/ekaette-bridge.conf`, but their root-only hashes and any referenced EnvironmentFiles are not yet frozen. Therefore the first privileged `--scan` must stop before apply and write a secret-free, immutable, canonically hashed root receipt. That receipt binds the exact service/timer unit names, `FragmentPath`/drop-in/EnvironmentFile real paths and byte hashes, load/enable/active identities, package version, loopback container name/id/image/config digest, exact production Docker socket real path/device/inode plus daemon identity, model-store real path/parent path/device/inode/mount id/mode/owner and sorted tree digest, both cron-line hashes, and every dependency classification. `ollama-active-inventory.json` must be completed from that receipt and receive a fresh exact-diff independent review. Only those receipt-bound service/timer/container/model records, reviewed inventory dispositions, and the two exact cron-line hashes above may then be accepted. Every other active dependency is a hard refusal. `--apply` reloads and hash-verifies the reviewed receipt/inventory, then immediately before **each** destructive operation re-enumerates and requires equality of every still-applicable captured unit/path/hash/container/socket/daemon/model identity and dependency classification; it refuses before mutation on any mismatch, symlink/type change, daemon-context change, replacement unit/container, changed model inode/tree, or newly active dependency. Mutations never target an ambient name/path alone: systemd operations use only unit names whose captured fragment/drop-in identities were just reverified; Docker uses fixed absolute CLI argv with the captured socket and full container id after proving that name still maps uniquely to that id and daemon; model deletion occurs only after services/container/processes are absent and a second lstat/findmnt/tree-digest check proves the captured root-owned, non-symlink directory and non-writable parent, then uses an exact-parent `find ./.ollama -xdev -depth -delete` traversal rather than following or recursively deleting a substituted path. After that review, the identity-bound operations are equivalent to:

```bash
systemctl stop ollama-watchdog.timer ollama.service
systemctl disable ollama-watchdog.timer ollama.service
/usr/bin/docker --host unix:///var/run/docker.sock rm -f <captured-full-container-id>
(cd /usr/share/ollama && find ./.ollama -xdev -depth -delete)
```

Before deletion, record service-unit hashes, package version, model names/sizes/blob hashes, container image id, crontab before/after hashes, cgroup memory, host available memory, and model-store byte count without model content. Tests replace or mutate each unit/drop-in/EnvironmentFile, Docker socket/daemon, container name/id/config, model path/inode/mount/tree, cron line, and dependency record both between scan/review/apply and between consecutive destructive operations; every case must refuse without touching the replacement or proceeding to a later mutation. The receipt must state that rollback requires reinstall/redownload; it must contain no prompts or model payload and must report actual pre/post deltas rather than a fixed RAM claim.

- [ ] **Step 4: Run GREEN**

```bash
node --test infra/cwv-runner/campaign-state.test.mjs infra/cwv-runner/host-scripts.test.mjs infra/cwv-runner/campaign-watchdog.test.mjs
shellcheck infra/cwv-runner/campaign-quiesce.sh infra/cwv-runner/campaign-restore.sh infra/cwv-runner/retire-ollama.sh infra/cwv-runner/campaign-watchdog.sh
git diff --check
```

Expected: all tests and ShellCheck pass.

- [ ] **Historical Step 5 seed — do not execute: commit the host-control unit**

> **Non-executable historical block.** The cumulative Task 1-6 integration rule supersedes this per-task CodeRabbit, `git add`, and `git commit` example. Use it only to understand the original design boundary; stage and commit only the final manifest-driven integration set.

```text
Historical boundary only: campaign state, quiescence, restore, Ollama retirement, watchdog, reviewed inventories, and their contracts formed the reversible host-control unit. No review, staging, or commit command from the superseded per-task procedure is retained.
```

---

### Task 4: Add canonical host attestation and idle refusal

**Files:**
- Create: `infra/cwv-runner/host-attest.sh`
- Create: `infra/cwv-runner/host-idle-check.sh`
- Create: `infra/cwv-runner/container-attest.sh`
- Create: `infra/cwv-runner/host-attestation.mjs`
- Create: `infra/cwv-runner/host-attestation.test.mjs`
- Create: `infra/cwv-runner/container-attestation.test.mjs`
- Create: `infra/cwv-runner/identity-contract.json`

**Interfaces:**
- `host-attest.sh --identity-host` emits raw secret-free VPS/host JSON fields used in the stable identity object and never invokes an image-only path.
- `host-attest.sh --live-local <campaign-id>` accepts exactly one canonical campaign id, reads only local `/proc`, `/sys`, systemd, Docker identity, cgroup, and policy-named nftables state, and emits one canonical secret-free live-host JSON object bound to that campaign/policy/capture/sample interval. Missing/extra arguments, noncanonical ids, network-capable commands, wrong campaign/interface/cgroup/counter identity, pressure/resource drift, or invalid state exits nonzero and emits no accepted object. `--identity-host` remains disjoint and unchanged.
- `container-attest.sh --identity-runtime` emits pinned Chrome/Node/pnpm/runner-binary JSON from a disposable `--network=none` container with only the reviewed image and a credentials-free sealed-binary projection.
- `host-idle-check.sh --live-local <campaign-id>` samples a validated online runner/veth/nftables classification and exits nonzero on any threshold or identity refusal. `host-idle-check.sh --rehearsal-local <campaign-id> <probe-container-id>` requires that exact live probe has Docker `NetworkMode=none`, no runner veth/classification, and zero/absent measurement counters. No third sampling mode exists.
- `buildRunnerAttestation({ policy, host, runtime, github, service, image }): { identity, sha256 }` requires every root-owned canonical source object plus its SHA-256 receipt and canonicalizes the stable receipt. H0-RUNNER does not introduce a signing key: the repository owner later approves the final digest through the exact-head PR record, matching the normative sign-or-owner-approve choice.

`identity-contract.json` freezes the following commands and normalization. Commands run with `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, `LC_ALL=C.UTF-8`, `TZ=Etc/UTC`, no shell aliases, and a 15-second timeout unless the table specifies ten-second sampling. The two external identity reads additionally execute through exact `/usr/bin/env -i` with only those three fixed variables plus `HOME=/var/empty/baci-cwv`, whose root-owned empty nonsymlink directory/mode is verified; no proxy, cookie, credential, or user configuration variable survives. Their exact `/usr/bin/curl` argv begins with `-q`, includes `--config /dev/null`, `--noproxy '*'`, `--proto '=https'`, `--tlsv1.2`, and `--cacert /etc/ssl/certs/ca-certificates.crt`, and never enables redirect following. `host-attest.sh` invokes exact argv arrays—never `eval`—and rejects stderr, timeout, extra/missing fields, parse ambiguity, proxy/config/home/CA drift, or any normalized value unequal to the expectation.

| Identity field | Exact argv/source | Normalization | Frozen expectation / refusal |
|---|---|---|---|
| Hostname | `/bin/hostname --short` | Require one lowercase RFC-1123 label; trim exactly one trailing newline | `ogabassey`; missing, dotted, uppercase-after-normalization ambiguity, extra output, or drift refuses |
| CPU summary | `lscpu --json` | Select names `Architecture`, `CPU(s)`, `On-line CPU(s) list`, `Vendor ID`, `Model name`, `Thread(s) per core`, `Core(s) per socket`, `Socket(s)`, `Virtualization type`; trim strings; decimal fields become integers; cpuset canonicalized | `x86_64`, `4`, `0-3`, `AuthenticAMD`, `AMD EPYC 9354P 32-Core Processor`, `1`, `4`, `1`, `full`; any drift refuses |
| CPU topology | `lscpu --json --extended=CPU,ONLINE,SOCKET,CORE,NODE` | Project in exact field order `CPU,ONLINE,SOCKET,CORE,NODE`; sort by numeric CPU; require Boolean online and integer CPU/socket/core/node | Four rows exactly `0,true,0,0,0`; `1,true,0,1,0`; `2,true,0,2,0`; `3,true,0,3,0`; any false/missing/extra/misordered value refuses |
| Governor/power mode | read sorted `/sys/devices/system/cpu/cpu[0-9]*/cpufreq/{scaling_governor,energy_performance_preference}` with `readlink -f` containment under `/sys/devices/system/cpu` | Emit sorted path/basename/value records; missing entire cpufreq tree becomes one explicit Boolean | Current KVM expectation is `cpufreqUnavailable:true`; partial presence or later value/path drift refuses pending new generation review |
| Memory identity | `grep ^MemTotal: /proc/meminfo` | Require one `kB` row and parse base-10 integer | `16376040 kB`; live available memory remains transient evidence, not identity |
| Kernel | `uname -srmv` | Collapse ASCII whitespace once | `Linux 6.8.0-90-generic #91-Ubuntu SMP PREEMPT_DYNAMIC Tue Nov 18 14:14:30 UTC 2025 x86_64` |
| OS image | read `/etc/os-release`; `sha256sum /etc/os-release` | Parse only `ID`, `VERSION_ID`, `IMAGE_ID`, `IMAGE_VERSION`; record raw-file SHA | `ubuntu`, `24.04`, empty, empty; SHA `01af466feb100306498c86aa6bad1815e33036019aa34d4362c20f374ea5c829` |
| Root filesystem | `findmnt --json --target / --output SOURCE,FSTYPE,OPTIONS` | Require one row; split/sort option set lexicographically | source `/dev/sda1`, type `ext4`, normalized options exactly `commit=15,discard,errors=remount-ro,noatime,rw` |
| Default route/interface | `ip --json route get 1.1.1.1` | Require one row; retain only dst/gateway/dev/prefsrc; ignore uid/cache | `1.1.1.1`, `82.29.190.254`, `eth0`, `82.29.190.219` |
| IPv4 forwarding prerequisite | read exactly `/proc/sys/net/ipv4/ip_forward` before every network transaction and spanning sample | Require one ASCII digit plus newline; read-only, with any `sysctl -w` or procfs write statically forbidden | `1`; missing, disabled, parse drift, or mid-transaction change refuses and restores without attempting to change the kernel setting |
| Public egress IP | sanitized `/usr/bin/env -i ... /usr/bin/curl -q --config /dev/null --noproxy '*' --proto '=https' --tlsv1.2 --cacert /etc/ssl/certs/ca-certificates.crt --fail --silent --show-error --max-time 10 https://www.cloudflare.com/cdn-cgi/trace` | Require one each of `ip`, `tls`, `warp`; reject duplicates/other use; validate IP | IP `82.29.190.219`, `warp=off`; TLS recorded and must be `TLSv1.3` |
| Egress provider | sanitized `/usr/bin/env -i ... /usr/bin/curl -q --config /dev/null --noproxy '*' --proto '=https' --tlsv1.2 --cacert /etc/ssl/certs/ca-certificates.crt --fail --silent --show-error --max-time 10 https://rdap.db.ripe.net/ip/82.29.190.219` | Parse JSON only; retain name/country/startAddress/endAddress | `HOSTINGER-HOSTING`, `GB`, `82.29.184.0`, `82.29.191.255` |
| DNS policy | `resolvectl dns eth0`; `resolvectl default-route eth0`; `resolvectl status` | Retain only global protocols/DNSSEC/resolv.conf mode and eth0 server IPs/default-route, with IPs sorted by numeric address bytes; ignore Docker/veth links | servers `1.1.1.1,8.8.4.4,145.14.155.10`, default route `yes`, `-LLMNR,-mDNS,-DNSOverTLS`, `DNSSEC=no/unsupported`, `resolv.conf=stub` |
| Locale | `localectl status --no-pager`; `locale charmap` | Retain system `LANG` and charmap only; invocation locale is fixed separately | `LANG=C.UTF-8`, `UTF-8` |
| Timezone | `timedatectl show --property=Timezone --value` | Trim one ASCII line | `Etc/UTC` |
| cgroup/Docker | `stat --file-system --format=%T /sys/fs/cgroup`; `docker info --format {{json .}}` | Retain cgroup fs/version/driver only | `cgroup2fs`, version `2`, driver `systemd` |
| Dedicated runtime host binaries | `/usr/bin/dockerd --version`; `sha256sum /usr/bin/dockerd`; `/usr/bin/containerd --version`; `sha256sum /usr/bin/containerd` | Require exact absolute root-owned regular executables; normalize version/build tuples and lowercase hashes | Docker `29.6.1` build `8ec5ab3`, SHA-256 `e6e911588afdbb9c3664b38986934266a32730c5808f2dd9a007b299a32d5a94`; containerd `2.2.6` build `11ce9d5f3c68c941867e82890e93e815c1304f1b`, SHA-256 `5e29ab968d742b0d2035da4bbc296fd348488473b89f48bc821fd9f6b826b898`; any drift refuses generation 1 |
| Firewall transaction tool | `/usr/sbin/iptables --version`; `sha256sum /usr/sbin/iptables`; `readlink -f /usr/sbin/iptables`; canonical `iptables-save` readback of only `filter/INPUT`, `filter/DOCKER-USER`, and `nat/POSTROUTING` is hashed transiently before/after each campaign | Require exact absolute root-owned executable, `nf_tables` backend, and canonical rule tokens/comments; persist only chain digests plus owned-rule specifications, never unrelated rule contents | `iptables v1.8.10 (nf_tables)`, SHA-256 `a1610dd70bb5ab04180671280df65b0077b680b627c0b6c51480b327732a762d`; `/usr/sbin/iptables` and `/usr/sbin/iptables-nft` are root-owned mode-`0777` symlinks resolving to root-owned mode-`0755` `/usr/sbin/xtables-nft-multi` with the same hash; missing anchor, backend/path/mode/hash drift, or non-owned chain drift refuses |
| nftables accounting tool | `/usr/sbin/nft --version`; `sha256sum /usr/sbin/nft`; during a campaign `/usr/sbin/nft --json --handle list table inet baci_cwv_measurement` | Require exact absolute root-owned executable; parse version and canonical JSON table/chain/rule/handle/counter identities only; never persist unrelated firewall rules | `nftables v1.0.9 (Old Doc Yak #3)`, SHA-256 `3f1c21553e62716ef1abfcf31f51ff94eb73ff4234a6653bac754a42f936d1c7`; missing/version/hash drift or campaign table drift refuses |
| Effective dedicated control cgroup | `systemctl show cwv-measurement-control.slice --property=AllowedCPUs,CPUQuotaPerSecUSec,MemoryMax,MemorySwapMax,TasksMax,IOWeight`; read exact `cpuset.cpus.effective`, `memory.max`, `memory.swap.max`, `pids.max`, and enumerate every descendant PID/cgroup while active | Canonical cpuset; decimal bytes/PIDs/weight/quota; every dedicated daemon, shim, unpack, and import client must be a descendant and no production process may be | CPUs `2-3`, quota `100%`, memory `2147483648`, swap `0`, PIDs `256`, I/O weight `10`; absence, worker escape, or production-process inclusion refuses |
| Effective measurement cgroup | `systemctl show cwv-measurement.slice --property=AllowedCPUs,MemoryMax,MemorySwapMax,TasksMax,CPUAccounting,MemoryAccounting,IOAccounting`; read exact `cpuset.cpus.effective`, `memory.max`, `memory.swap.max`, `pids.max` during probe/campaign | Canonical cpuset; decimal bytes/PIDs; strict Booleans; policy intent and effective files must agree | CPUs `2-3`, memory `8589934592`, swap `0`, PIDs `1024`, all accounting `yes`; absence or mismatch refuses |
| Chrome (runtime container) | `/usr/bin/google-chrome-stable --version`; `sha256sum /usr/bin/google-chrome-stable`; Debian package query inside the exact image | Normalize version tuple and lowercase SHA | exact `150.0.7871.128`; binary/package SHA fields must match the reviewed image manifest derived from Debian SHA `83ed59c85878ebb8fa53915ebe7066cafc58d1c04c1c95449486e6f9d99a1efb` |
| Node/pnpm (runtime container) | `/opt/node/bin/node --version`; `/opt/node/bin/node /opt/pnpm/bin/pnpm.cjs --version`; SHA-256 `/opt/node/bin/node`, `/opt/pnpm/bin/pnpm.cjs`, and `/opt/pnpm/package.json` inside the exact image | Strip leading `v` only for numeric comparison; all paths must be regular root-owned files under their exact prefixes; parse only package name/version/bin and require `pnpm`, `11.7.0`, `bin/pnpm.cjs`; Corepack invocation or shim resolution refuses | Node `24.18.0`, pnpm `11.7.0`, hashes/package projection equal reviewed image manifest |
| Runner binary (separate host identity and runtime binary projections) | host hashes `/srv/baci-cwv/sealed/actions-runner/bin/Runner.Listener`, `Runner.Worker`, the reviewed Node lifecycle entrypoint, and `.runner`; the no-network runtime projection invokes `/opt/runner/bin/Runner.Listener --version` and hashes only the credential-free shared files `bin/Runner.Listener`, `bin/Runner.Worker`, and the lifecycle entrypoint | Produce `hostRunnerIdentityDigest` from the four host rows, including parsed `.runner`; produce a distinct `runtimeRunnerBinaryDigest` from only the three runtime-accessible shared rows. Compare the three shared files path-by-path against the sealed manifest; never compare the two full digests. `.runner` parsing occurs only on the host and retains agent id/name/server URL/work folder; never mount `.credentials*` or `.env` into the runtime probe | runner `2.335.1`; all three shared per-file hashes equal the reviewed sealed manifest; host-only identity fields equal the GitHub row; either digest or any shared-file mismatch refuses |
| Service/scripts/image | `sha256sum` over the reviewed sorted manifest; `systemctl cat` only the exact installed CWV units; `docker --host unix:///run/baci-cwv/docker.sock image inspect` pinned id while the dedicated daemon is transactionally active | Canonical rows are `relative-path NUL sha256 LF`; unit text and image config canonical JSON are hashed | equal repository manifest, installed unit digest, and `linux/amd64` image id recorded by reviewed PR A; production Docker socket use or extra fragments/drop-ins refuse |
| Stable GitHub identity | read-only REST runner row plus repository metadata | Retain repository id, runner id/name/OS/status/labels, controller generation, authority mode; sort labels | repo `1100488586`, exact registered id captured after install, name `baci-cwv-measurement-01`, OS `linux`, labels exact, authority `personal-public-exact-run`; status/busy/capturedAt remain transient |

The currently observed host values above become immutable generation-1 expectations. If kernel, OS image, filesystem, network, DNS, locale, timezone, provider allocation, or CPU identity changes before installation, stop and revise/review this plan; do not silently capture a new baseline. Image/service/runner hashes are deterministic outputs of the reviewed implementation and must be inserted into the generated identity manifest before registration, then compared byte-for-byte on the host.
- `capturedAt`, live online/busy state, load, pressure, and traffic remain outside the stable identity hash.

- [ ] **Step 1: Write RED tests for every frozen and transient field**

Cover stable CPU topology/model, governor/power mode, memory, kernel/OS image, filesystem, KVM, network interface, egress IP/provider, DNS policy, locale, timezone, Chrome version/binary SHA, Node/pnpm, runner binary SHA, runner id/name/generation/exact labels/authority mode, service-unit digest, image digest, policy digest, repository id, cgroup layout, and shared-host exception. Do not invent or verify an organization runner-group field for this personal repository.

For every row in the command table, add one exact captured-output fixture, one benign formatting-order fixture that normalizes identically where permitted, and malformed/extra/missing/drift fixtures that refuse. Static tests prove the collector argv arrays and JSON pointers equal `identity-contract.json`, no command uses a shell/eval, external endpoints are exact HTTPS hosts, identity output cannot include unselected command output, the host collector never invokes `/usr/bin/google-chrome-stable` or `/opt/node`/`/opt/runner`, the runtime collector invokes pnpm only as `/opt/node/bin/node /opt/pnpm/bin/pnpm.cjs --version` and rejects Corepack/shims, and the runtime probe has `--network=none` with no `.credentials*`, `.env`, hook, admission record, token, or host `/proc`/`/sys` mount. Fixtures assert that `hostRunnerIdentityDigest` includes `.runner`, `runtimeRunnerBinaryDigest` excludes it, the two full digests are intentionally distinct, and only the three credential-free shared-file hashes are compared across host/runtime views.

Cover refusal on Chrome/Node/runner/image drift, wrong hostname, wrong repo, wrong CPU sets, missing slice, swap above limit, other runner worker, external browser process, load/PSI/steal/memory/disk/network threshold, missing lease, wrong campaign, and application container escaping CPUs `0-1`.

- [ ] **Step 2: Run RED**

```bash
node --test infra/cwv-runner/host-attestation.test.mjs infra/cwv-runner/container-attestation.test.mjs
```

Expected: FAIL because the attestation files do not exist.

- [ ] **Step 3: Implement secret-free collection and canonical identity**

The host collector may read `/proc`, `/sys`, `hostnamectl`, `lscpu`, `findmnt`, `ip`, `resolvectl`, `timedatectl`, `locale`, sealed host runner hashes/identity, systemd unit properties, Docker image/container metadata excluding environment/labels with values, and the public egress endpoint. It must reject `printenv`, a generic or non-`-i` environment launcher, any `/usr/bin/env -i` argument set other than the exact identity contract, `docker inspect ... Config.Env`, shell history, `/proc/*/environ`, credentials, cookies, proxy variables, user curl configuration, redirects, or an alternate CA/home. The installer invokes `container-attest.sh --identity-runtime` only through a credential-free disposable container using the exact image id, `--network=none`, read-only root, and a read-only projection containing only runner binaries/scripts plus a manifest—never `.runner`, `.credentials*`, `.env`, hook, admission record, or token. Host/runtime evidence is written by root as canonical JSON with mode `0640 root:baci-cwv`, fsynced, atomically renamed, and accompanied by a SHA-256 file; no private signing key exists. The canonical builder rejects a missing source/digest, digest mismatch, duplicate field authority, image/host runner-hash disagreement, or namespace mismatch. Tests cover valid canonical digests plus missing, malformed, substituted, stale, or mismatched source bytes and hostile `HOME`/curlrc/upper- or lowercase proxy environments; final human authority is the exact-head owner-approved receipt PR, not an undefined signature.

`host-attest.sh` exposes two disjoint modes. `--identity-host` collects the stable table above and may call only the exact Cloudflare trace and RIPE RDAP endpoints outside a live sampling interval. `--live-local <campaign-id>` contains only local `/proc`, `/sys`, systemd, Docker-identity, cgroup, and nftables-counter reads and is statically forbidden from containing `curl`, `wget`, `gh`, a hostname, or any network-capable command. The sampler service invokes only `host-idle-check.sh --live-local <campaign-id>` and `host-attest.sh --live-local <campaign-id>`; it never invokes `--identity-host`.

The idle checker samples `/proc/stat` twice for steal time and reads the exact root-owned nftables total/measurement counter pairs over the same ten-second monotonic interval. It reports starting/ending raw counters, total and marked-measurement deltas at each same hook, derived ambient RX/TX, table/chain/rule handles and digests, egress/veth/container/conntrack identities, each threshold, and refusal reason—never only a Boolean. Live sampler mode is forbidden from invoking Cloudflare trace, RIPE RDAP, GitHub, or any other external endpoint; stable external identity is collected only outside a live slot. Counter reset/wrap, rule or interface replacement, negative subtraction, measurement greater than total, direction ambiguity, or failure to prove the exact measurement flow refuses. In explicit rehearsal mode, the exact probe remains alive with Docker `NetworkMode=none`; the checker proves no veth/measurement classification exists, requires measurement deltas to be zero/absent by schema, and treats the same-hook total counters as ambient. That mode can never authorize a real runner or slot.

- [ ] **Step 4: Run GREEN**

```bash
node --test infra/cwv-runner/host-attestation.test.mjs infra/cwv-runner/container-attestation.test.mjs
shellcheck infra/cwv-runner/host-attest.sh infra/cwv-runner/host-idle-check.sh infra/cwv-runner/container-attest.sh
pnpm exec biome check infra/cwv-runner/*.mjs
```

Expected: tests, ShellCheck, and Biome pass.

- [ ] **Historical Step 5 seed — do not execute: commit the attestation unit**

> **Non-executable historical block.** The cumulative Task 1-6 integration rule supersedes this per-task CodeRabbit, `git add`, and `git commit` example. Use it only to understand the original design boundary; stage and commit only the final manifest-driven integration set.

```text
Historical boundary only: host, idle, and container attestation plus the frozen identity contract and tests formed the attestation unit. No review, staging, or commit command from the superseded per-task procedure is retained.
```

---

### Task 5: Install one persistent service with reboot-safe identity

**Files:**
- Create: `infra/cwv-runner/baci-cwv-containerd.service`
- Create: `infra/cwv-runner/baci-cwv-docker.service`
- Create: `infra/cwv-runner/containerd.toml`
- Create: `infra/cwv-runner/daemon.json`
- Create: `infra/cwv-runner/cwv-measurement-control.slice`
- Create: `infra/cwv-runner/baci-cwv-measurement.service`
- Create: `infra/cwv-runner/baci-cwv-host-sampler.service`
- Create: `infra/cwv-runner/baci-cwv-host-sampler.timer`
- Create: `infra/cwv-runner/cwv-measurement.slice`
- Modify: `infra/cwv-runner/baci-cwv-campaign-watchdog@.service`
- Create: `infra/cwv-runner/install.sh`
- Create: `infra/cwv-runner/install.test.mjs`
- Create: `infra/cwv-runner/vps-ssh.sh`
- Create: `infra/cwv-runner/vps-ssh.test.mjs`
- Create: `infra/cwv-runner/ogabassey-known-hosts`
- Create: `infra/cwv-runner/source-manifest.mjs`
- Create: `infra/cwv-runner/source-manifest.test.mjs`
- Create: `infra/cwv-runner/seal-source.sh`
- Create: `infra/cwv-runner/seal-source.test.mjs`

**Interfaces:**
- After PR A merge/deployment, `source-manifest.mjs freeze` writes the canonical schema-v1 merge-tree manifest described in Task 2 plus its raw SHA-256 and a deterministic source archive containing exactly the manifest's closed `sourceArchive.entries` projection plus a one-line archive SHA-256. The archive format is one finite normalized ustar stream with these exact schema-v1 constants shared by producer, verifier, receipt, and self-contained Task 9 parser: archive bytes `<=16777216`, members `<=1024`, each member bytes `<=1048576`, UTF-8 path bytes `<=255`, ustar `name<=100` and `prefix<=155`, canonical regular-file `typeflag=NUL`, and canonical split `prefix=""/name=path` when path bytes are `<=100`, otherwise the rightmost slash whose prefix/suffix satisfy those bounds. Members are path-sorted regular files only with zero uid/gid/mtime and empty user/group names, manifest-projected `0644`/`0755` modes, exact NUL-terminated octal fields/checksums, zero padding, exactly two terminal zero blocks, no global/PAX/GNU extension, link, sparse, device, or trailing bytes. `source-manifest.mjs verify` derives no archive membership from the broader PR-diff `entries`: it reopens the archive without executing it and requires the archive's complete normalized member set, types, modes, sizes, byte hashes, header bytes, and padding to equal only `sourceArchive.entries`; absolute/traversal/duplicate/hardlink/symlink/device members, extra/missing entries, metadata ambiguity, and nondeterministic member order refuse. A valid changed path outside `infra/cwv-runner/` remains in the complete PR-diff `entries` and does not enter or invalidate the archive projection. Then `build-image.mjs --execute --source-manifest <path> --source-manifest-sha256 <digest> --output-archive <path> --output-receipt <path>` runs only on the development Mac and emits the single-platform `linux/amd64` Docker archive plus canonical build receipt. `--verify-archive` requires the same manifest/digest and proves their binding before transfer. Neither the wrapper nor installer may address the production VPS Docker daemon as a builder.
- `seal-source.sh --destination scan|final --source-sha <sha> --source-archive <root-copied-path> --source-archive-sha256 <digest> --source-manifest <root-copied-path> --source-manifest-sha256 <digest>` is the first repository helper that root may execute. It is never executed from user staging. One frozen owner-visible fixed-tool primitive uses absolute `/bin/cp`, `/usr/bin/stat`, `/usr/bin/sha256sum`, `/bin/chown`, and `/bin/chmod` to require the staged helper is a regular nonsymlink file, copy it into a newly created mode-`0700 root:root` directory, and compare the copied bytes to the exact reviewed raw file SHA-256 literal computed over the Git object contents before setting mode `0500 root:root` and invoking that root-owned copy. This is a raw file hash on both sides, never a Git object id or `git hash-object` value. The helper similarly root-copies the regular nonsymlink archive/manifest inputs before hashing, validates every archive member against the canonical manifest with fixed tools, extracts into a root-only temporary sibling, applies manifest-derived fixed modes, fsyncs, rehashes the sealed tree, and atomically publishes either `/var/lib/baci-cwv/preflight-source/<reviewed-head>/` plus its root-only receipt for the one read-only pre-merge scan, or immutable `/srv/baci-cwv/source/<merge-sha>/` plus `/srv/baci-cwv/source-receipts/<merge-sha>/{manifest.json,manifest.sha256,archive.sha256,seal-receipt.json}` after merge. The preflight tree can run only `retire-ollama.sh --scan` and is deleted after its receipt; final mode refuses until the exact merged/deployed identity is present. A copy-time/input swap yields a digest mismatch before execution; a swap after the root copy cannot affect the sealed bytes. Existing destination, partial tree, wrong helper/archive/manifest digest, symlink, ownership/mode drift, or another SHA refuses and is repaired only from its receipt.
- `install.sh --bootstrap-control --source-sha <PR_A_MERGE_SHA> --source-manifest <sealed-root-path> --source-manifest-sha256 <sealed-digest-file>` is a separate owner-visible, idempotent root bootstrap transaction invoked only from the already sealed immutable `/srv/baci-cwv/source/<PR_A_MERGE_SHA>/install.sh`; it never copies or executes neutral staging. The digest-file argument is a root-owned regular nonsymlink file containing exactly one lowercase 64-hex line, not a caller-selected digest string. It re-verifies the sealed tree/manifest receipt, installs only the locked account, immutable empty directory skeleton, state controller/watchdog, disabled dedicated units, and their exact source/policy hashes. It renders the sole `@BACI_CWV_SOURCE_SHA@` token in the watchdog template to that merge SHA and refuses any other substitution or stable alias. It starts no daemon, creates no import bytes/network/rule/container, and writes a durable bootstrap capture/journal/receipt outside the transaction-owned import/data roots; an interrupted bootstrap must be repaired or rolled back to its captured prior state before any other mode is accepted. A pre-existing source/unit passes only when every path/blob/mode/rendered byte and manifest digest equals the same receipt; symlinks, partial trees, another SHA, or replacement bytes refuse.
- `install.sh --prepare --image-archive <external-path> --image-archive-sha256 <owner-frozen-digest> --build-receipt <external-path> --build-receipt-sha256 <owner-frozen-digest>` requires an exact complete bootstrap receipt. Before protection is active it treats the external paths as untrusted opaque names and may only lstat/capture their identity; it never parses or authorizes their bytes. After the durable `prepare` watchdog/capture is active, root copies each regular nonsymlink input into new receipt-owned random files under the root-only import transaction using no-follow semantics, fsyncs them, and recomputes each copied SHA-256. Both must equal the explicit owner-frozen local output digests; only then may it parse the root-owned receipt, require that receipt binds the root-owned archive digest plus exact source-manifest/policy/build identity, and address only the root-owned archive for verification/import. A before/during/after-copy swap of one or both external files can at most produce a post-copy digest mismatch and never reaches an archive/JSON parser or daemon. Only afterward may it start the disabled dedicated CWV containerd/Docker control plane long enough to verify/import the root-owned archive through `/run/baci-cwv/docker.sock`, verify the loaded image id/config digest, atomically fsync phase `target-accepted`, stop the dedicated services, delete archive/synthetic staging bytes, and install no additional unit. Any use or mutation of production Docker/containerd sockets/services/roots, or any `docker build`, `buildx`, pull, or package download on the VPS, is forbidden.
- `install.sh --register-token-stdin` performs one first registration inside a durable registration-only network transaction. It installs the cleanup trap and root-owned continuous identity/mount guard, arms the watchdog/capture, starts only the dedicated daemons, creates/readbacks the exact IPv4-only network plus receipt-owned host-local/private/cross-network isolation entries/chains, and proves the isolation matrix and secret-free policy-bound public TLS handshake before reading one bounded newline-delimited token from stdin into root-created tmpfs `/run/baci-cwv-registration/<nonce>/token`. It removes the temporary probe allow rule and proves the receipt-bound registration-container egress chain is default-drop with zero counters. Only then may it bind-mount the token and start Docker with the exact direct-Node registration entrypoint. Node emits ready and waits; root namespace-unmounts token, deletes host token/nonce, proves both absent, revalidates exact Node/PID/namespaces/argv plus zero counters, activates the narrow rule, and atomically publishes the one-use pre-exec receipt at the separately direct-mounted read-only `/run/baci-cwv-registration-release/release.json` trust path defined in Task 2. Node opens that exact receipt once, validates and consumes it in memory, and its next external action is same-PID `process.execve` of Listener configure; root then verifies the transition and deletes/unmounts the host handoff. Every terminal path keeps/returns default-drop, deletes/unmounts the release handoff, performs token-first unmount/delete if needed, then removes staging/container/isolation entries/chains/network, stops daemons, restores captured host state, and leaves normal service disabled/offline. A file-path, argv, environment, pre-created-token, Bash-wrapper registration, replayed release, release mount in normal mode, or unbound egress mode does not exist.
- `install.sh --probe-isolation <campaign-id>` starts one disposable `--network=none` probe with the production cgroup/resource flags and no runner identity or listener.
- `install.sh --probe-runtime-identity` starts one disposable `--network=none` probe with the exact image and a credentials-free read-only runner-binary projection, returning only canonical runtime identity JSON plus its SHA-256.
- `install.sh --verify` performs no mutation and prints the service/image/state digest.
- `source-manifest.mjs freeze --pr-number <n> --reviewed-head <sha> --base <sha> --merge <sha> --output <path> --output-digest <path> --source-archive <path> --source-archive-digest <path>` schema-validates `policy.json`; writes the exact canonical schema-v1 manifest defined in Task 2; binds its canonical digest plus the exact `/authority` contract path/hash/base/deployment-run/attempt/marker, PR number/reviewed head/base/merge, every changed path's exact status/mode/Git blob bytes in `entries`, and the complete merge-tree `infra/cwv-runner/` regular-blob projection in `sourceArchive`; represents PR deletions explicitly only in `entries`; creates the exact normalized bounded ustar archive defined above directly from the exact `sourceArchive.entries` Git object bytes rather than filesystem bytes; and writes one lowercase raw SHA-256 line for each output. Before projection it recursively enumerates every tree entry under the prefix and permits tree nodes only for traversal; each leaf must be a blob with exact mode `100644` or `100755`, and any symlink, gitlink, unknown/non-blob, device-like, or ambiguous mode rejects the entire freeze. `source-manifest.mjs verify` repeats that complete-tree type/mode proof, accepts the same identity arguments and `--input <path> --input-digest <path> --source-archive <path> --source-archive-digest <path>`, rejects rename/path/archive ambiguity, and verifies the merge tree plus the exact byte-level archive projection without requiring the reviewed head to be an ancestor. A separate `freeze-preflight`/`verify-preflight` pair accepts only the exact reviewed head/base/PR identity and emits schema `preflight-v1` with the identical closed `sourceArchive` object computed from the reviewed-head tree plus the same exact archive for exactly two pre-merge purposes: the narrowly enumerated Task 7 development-Mac owner-tool provisioning authorization and the one root-sealed read-only scan. Preflight bytes cannot satisfy final mode, bootstrap, build, prepare, registration, normal owner dispatch, workflow dispatch, or any VPS mutation. All four files must be direct nonsymlink children of one owner-created temporary directory, and object bytes come only from `git cat-file`.

- [ ] **Step 1: Write RED installation-contract tests**

Assert the service:

- uses `Requires=baci-cwv-docker.service`, `After=baci-cwv-docker.service network-online.target`, addresses only `unix:///run/baci-cwv/docker.sock`, and has `PartOf` no deploy/application or production Docker/containerd unit;
- has `Restart=no`, `NoNewPrivileges=true`, and no Docker socket mount; only a fresh root-controller admission may start another `--once` listener, so a rejected, failed, or consumed activation can never reconnect automatically;
- uses `--network=baci-cwv-net`, `--cap-drop=ALL`, `--security-opt no-new-privileges=true`, no `--cap-add`, `--cgroup-parent=cwv-measurement.slice`, and policy-rendered `--cpuset-cpus=2-3`, `--memory=8g`, `--memory-swap=8g`, `--pids-limit=1024`, and `--shm-size=1073741824`; a read-only root filesystem, tmpfs `/tmp`, tmpfs `/home/runner`, sealed read-only `/opt/runner`, separate writable `/opt/runner/_diag`, `/runner-work`, and approved scratch mounts, read-only `/host-evidence`, and the pinned local image id file; inspected Docker state, cgroup values, `/dev/shm` byte capacity, and `/proc/self/status` must prove the exact policy values, zero effective/permitted/bounding capabilities, and `NoNewPrivs=1` before listener release;
- bind-mounts persistent host `/srv/baci-cwv/sealed/policy.sha256` read-only to container `/run/baci-cwv-policy/policy.sha256` in registration and normal modes, never creates that authority under volatile host `/run`, and refuses missing/mode/owner/digest/embedded-policy drift after reboot;
- bind-mounts the job-start hook, exact allow record, and root-owned listener-release directory read-only outside the runner application directory, sets only `ACTIONS_RUNNER_HOOK_JOB_STARTED` to that absolute hook path, starts the container in mandatory hold mode, and permits `--once` only after the entrypoint validates the release record;
- is installed disabled until registration succeeds;
- refuses a second container, second runner record, changed image digest, nonempty registration-token residue, writable runner program/config/credential/hook/allow-record bytes, or world-readable state.
- builds host and runtime identity separately: host paths come only from `host-attest.sh --identity-host`; Chrome/Node/pnpm/image paths come only from `install.sh --probe-runtime-identity`; the latter must contain `--network=none` and no credentials, `.runner`, hook, allow record, token, or host namespace mounts.

Assert the sampler service invokes only `host-idle-check.sh --live-local` and `host-attest.sh --live-local`, and static/behavioral tests prove neither local mode can reach a network-capable command or external endpoint. It writes a temporary mode-`0640` `root:baci-cwv` JSON file under `/srv/baci-cwv/evidence`, fsyncs it, then atomically renames it to `live-sample.json`. Assert the timer uses `OnUnitInactiveSec=2s` after each ten-second sample, has `Persistent=false`, and is never enabled outside a campaign lease.

Assert the watchdog template is root-owned, independent of the SSH/controller cgroup, binds one escaped campaign id plus validated state hash, has `RuntimeMaxSec=30m`, restarts/reconciles after reboot when an unrestored lease exists, and can invoke only the fixed watchdog script—never an arbitrary path or shell fragment.

Assert `vps-ssh.sh` is Git mode `100755`, directly executable, the sole repository SSH call site, and accepts only optional literal `--tty`, then `--`, then one remote command string or stdin-driven remote command; source-manifest freeze/verify rejects that path at mode `100644` or any mode other than `100755`, and every command block proves `test -x` before invoking it. The wrapper freezes `/usr/bin/ssh` argv to `-F /dev/null`, `-T` or `-tt`, `BatchMode=yes`, `IdentitiesOnly=yes`, `HostKeyAlgorithms=ssh-ed25519`, `StrictHostKeyChecking=yes`, `CheckHostIP=yes`, `GlobalKnownHostsFile=/dev/null`, exact dedicated `UserKnownHostsFile`, `ProxyCommand=none`, `ProxyJump=none`, `PermitLocalCommand=no`, `ClearAllForwardings=yes`, `ForwardAgent=no`, `ForwardX11=no`, `ControlMaster=no`, `ControlPath=none`, `ControlPersist=no`, `IdentityAgent=none`, `Tunnel=no`, port `22`, and `bassey@82.29.190.219`. Before exec it no-follow validates the one-row known-hosts file's owner/type/mode, raw SHA-256, key algorithm, and exact `ssh-keygen -E sha256` fingerprint. RED-test a missing/extra/reordered row, wrong IP/key/fingerprint/digest, symlink, writable authority, alternate host/user/port/config/proxy/jump/known-hosts option, environment substitution, hostile user or system SSH config, multiplexing, forwarding, local command, agent/X11/tunnel use, and direct `/usr/bin/ssh` or bare `ssh` anywhere outside the wrapper/test fixture. The static scan includes every documented command block.

Assert registration refuses unless the token is a regular tmpfs file with exact `0440 root:baci-cwv`, its random nonce parent is `0700 root:root`, the fresh random staging child is `0700 baci-cwv:baci-cwv`, global inventory is either the pre-start zero-identity state or exactly the receipt-bound registration container/cgroup/user/mount namespace with its one-PID maximum, the Docker entrypoint/argv are exactly direct Node registration mode, and a live synthetic probe confirms cross-UID `/proc/<pid>/environ` reads are denied. In a user-namespace fixture, UID `10001` must read only the direct-mounted token and write staging before exec, but another UID reads neither and host UID `10001` cannot traverse the nonce parent; configuration exposes no token-shaped argv, the token mount becomes inaccessible before transition, and Listener environment omits `ACTIONS_RUNNER_INPUT_TOKEN` after CommandSettings consumes it. Positive tests require exactly one PID changing from hash-bound Node to hash-bound `Runner.Listener configure`, unchanged cgroup/user/mount namespace identity, exact argv/environment/cardinality, zero counters before one atomic `/run/baci-cwv-registration-release/release.json` pre-exec receipt, one no-follow read/consume, and exact post-exec transition verification followed by release deletion/unmount. Required races invoke normal Bash wrapper, start a second identity/container, add child/sibling/reparented/wrong-hash process, drift PID/namespace, retain/read token after ready, omit/replay ready or release, use a wrong release path/owner/mode/type/schema/generation, attempt pre-release network delivery, release without exact Node/zero-counter proof, fail exec after release, reread/retry the release, and add an undeclared mount at every token/mount/ready/unmount/release/exec/verify/seal boundary; the guard must return/keep default-drop and stop/unmount/delete/restore synchronously. After every terminal path token/nonce/staging/release handoff are absent, registration egress rules removed, and normal service contains neither registration mount nor secret environment input.

On the VPS Linux kernel, use the credential-free disposable probe plus root-created fixture tree to prove UID/GID `10001` cannot modify, unlink, rename, hard-link, symlink-shadow, or replace sealed application/config/credential/hook/allow-record/policy-digest bytes while it can read only the `0440 root:baci-cwv` admission and policy-digest files and write the approved work/diag/scratch paths. Prove the actual normal-service mount table contains no registration token or staging mount; Task 2's macOS-compatible tests are not accepted as this Linux authorization evidence.

`install.test.mjs` must execute the root cleanup contract for registration success, TLS-probe failure, configuration failure, Docker failure, capability/security-option drift, partial chain/rule/jump insertion, signal, controller death, watchdog timeout, and restore retry. Every case asserts that the host tmpfs token is deleted first when present, the random staging child is removed, no registration container/process survives, the exact three tagged shared entries plus two receipt-owned chains/network/bridge/dedicated sockets are absent, both dedicated daemons are stopped, captured production application/firewall identities are unchanged, and no normal service invocation contains either secret input. Registration tests also prove the token mount is impossible before green zero-capability/no-new-privileges and host-local/private/cross-network isolation receipts plus a green secret-free TLS probe receipt, and that the probe container has no token/staging/runner identity. Prepare tests independently and coherently swap the external archive and receipt before, during, and after root copy, including a mutually consistent malicious pair; they prove no parser/daemon sees external bytes, only post-copy root-owned bytes are parsed, explicit owner-frozen digests cannot be inferred from the staged pair, and every mismatch restores without retaining partial import bytes.

Parse `policy.json` through `policy.schema.mjs` in the installation tests and require the rendered slice plus Docker argv and inspected `/dev/shm` capacity to equal `/resources/measurementCpuSet`, `/resources/otherCpuSet`, `/resources/memoryBytes`, `/resources/memorySwapBytes`, `/resources/shmBytes`, and `/resources/pidsLimit`. Fixtures that change any parsed resource while leaving a unit/template/argv/attestation stale must fail.

Assert preparation never invokes `docker build`, `buildx`, an image pull, curl, apt, or any network-capable package fetch on the VPS. Tests must model that `docker load` work runs in the dedicated CWV `dockerd` and `containerd`, not merely the CLI. Require both dedicated unit files to render only policy paths/sockets/network/subnet/gateway, reside in `cwv-measurement-control.slice`, and apply every `/installationImport` bound (`AllowedCPUs=2-3`, `CPUQuota=100%`, `MemoryMax=2147483648`, `MemorySwapMax=0`, `TasksMax=256`, `IOWeight=10`) to their daemon/content-store workers; the import client runs in the same slice. The dedicated Docker daemon must use only the dedicated containerd socket, data/exec roots, pid file, and Unix socket, expose no TCP socket, start with its default bridge disabled, and keep `iptables`, `ip-forward`, and `ip-masq` false. Preparation proves the policy network/subnet/bridge/comment namespace is collision-free but leaves it absent. Campaign-controller tests separately require that only after the same independent collision checks may `baci-cwv-net` be created with the exact subnet/gateway/Linux bridge name and receipt-bound inspected options/IPAM/bridge id. Preparation uses `--network=none` and must not install a campaign firewall rule; a live synthetic import rehearsal therefore proves content-store isolation without external egress. The daemon never uses `/var/run/docker.sock`, `/var/lib/docker`, `/run/containerd/containerd.sock`, or `/var/lib/containerd`. Before import, require all dedicated sockets/services/processes/networks to be absent or stopped, all dedicated roots to have exact ownership/modes, no route/bridge/network-name/address collision, and every production application container/shim to remain attached only to the production control plane. A root supervisor samples the control slice every two seconds and attributes every new CWV daemon, shim, unpack, and import worker to it; unknown helpers or a worker outside the slice refuse. During and after import, any dedicated daemon restart/property/cgroup/worker-attribution drift, production container stop/restart/health drift, production daemon/socket/root/network mutation, available memory below `6 GiB`, root free disk below `30 GiB`, CPU PSI `full.avg10>0` (the exact policy `cpuPsiFullAvg10Max`), memory PSI `full.avg10>0`, or I/O PSI `full.avg10>0.10` cancels the load, stops only the dedicated daemons, removes only dedicated target-image/content/staging bytes, and fails without restarting an application. No separate import-only CPU threshold exists. A real disposable synthetic-image rehearsal on the live kernel must prove these bounds, cancellation, content cleanup, service stop, reserved-network absence, and unchanged production/application/firewall tuples before the real archive is accepted; fixtures alone are insufficient. Tests cover success plus each pressure/health failure, signal, receipt mismatch, archive mismatch, image-id mismatch, supervisor death, socket/root/network collision, production mutation, and cleanup idempotency. Static tests reject any production socket/service/root/network, campaign firewall mutation during prepare, `docker restart`, `docker stop`, Compose mutation, or application-unit restart in the prepare/import path.

The Docker unit must have exact `Requires=baci-cwv-containerd.service` and `After=baci-cwv-containerd.service`; neither unit may have `Wants`, `Requires`, `After`, `Before`, or `PartOf` against production Docker/containerd/application/deploy units. Starting Docker without the exact healthy dedicated containerd socket refuses, and stopping Docker never stops production containerd.

Source-seal/bootstrap tests require the exact helper raw file SHA-256 computed over the reviewed Git object contents, source SHA, archive/manifest arguments, and root-owned copy/destination modes. They swap the user-owned helper/archive/manifest between transfer, fixed-tool copy, post-copy raw-file hash verification, seal, and execution; every mismatch refuses before repository code executes, while a post-copy user-staging change cannot alter the root-owned bytes. They reject an archive/member/tree/path/blob/mode/digest mismatch, absolute/traversal/duplicate/link/device member, symlink, stale partial destination, unresolved/wrong watchdog source token, `/srv/baci-cwv/bin`, and stable alias; prove the temporary scan tree permits only the read-only scan and is removed; and prove the atomically published `/srv/baci-cwv/source/<sha>/` tree, rendered unit, and durable receipts equal the canonical final manifest projection before any installed command executes. Kill `seal-source.sh` and `install.sh --bootstrap-control` after each journaled root-copy/source/tree/unit mutation and across reboot, then prove receipt-driven repair converges idempotently to either the captured absent state or the exact installed hashes without starting a daemon; a partial or stale source tree is never executable. Preparation cleanup tests distinguish success from failure byte-for-byte: success deletes only archive/import staging and synthetic-image content, retains the exact receipt-bound target image, restarts the two dedicated daemons once, re-inspects the same image id/config digest through only the dedicated socket, atomically fsyncs `target-accepted`, then stops them; failure removes partial target content owned by that transaction. Kill the installer and its root supervisor together before the first transaction-owned byte, before daemon start, after each daemon start, during synthetic/real import/container execution, after target verification but before `target-accepted`, after `target-accepted` but before cleanup, after cleanup but before disarm, on SSH loss, and across reboot. Every case must prove the independent prepare-mode watchdog first stops/removes the exact receipt-owned synthetic/import containers while the dedicated socket is responsive; if the socket or daemon is dead, it identifies and terminates only receipt-bound container/shim scopes, proves every dedicated control/measurement cgroup and runtime process empty plus both sockets dead, and only then reconciles content. It writes a durable refusal/repair receipt and converges idempotently: before `target-accepted` it deletes only receipt-owned unaccepted roots/import staging; at or after `target-accepted` it retains only the exact accepted target/root and removes archive/synthetic staging. Test daemon-dead, surviving-shim, partial-scope, and reboot fixtures. A stale or unmatched receipt refuses, and an already accepted target may only be retained when it equals the same receipt. A fixture that deletes the retained target on success, promotes an unverified target, deletes a live process's backing root, leaves a receipt-owned process/cgroup/socket, or leaves partial target bytes on failure must fail.

Assert source-manifest verification passes for content-equivalent squash and rebase fixtures and refuses a missing/drifted policy digest or authority contract path/hash/base/deployment-run/attempt/marker, wrong PR/head/base identity, extra/missing path, file-to-symlink/type drift, changed bytes/mode, ambiguous rename/copy, or a deletion that reappears. Independently assert `sourceArchive.prefix` is exactly `infra/cwv-runner/`, its rows equal every and only regular merge-tree blob under that prefix, archive members equal only those rows, and a valid changed path outside the prefix remains in PR-diff `entries` without entering or invalidating the archive. Inputs and output are NUL-safe and cannot follow worktree symlinks; object bytes come from `git cat-file`, not the filesystem.

- [ ] **Step 2: Run RED**

```bash
node --test infra/cwv-runner/install.test.mjs infra/cwv-runner/source-manifest.test.mjs infra/cwv-runner/seal-source.test.mjs
```

Expected: FAIL because installation files do not exist.

- [ ] **Step 3: Implement the service, slice, and installer**

The installer creates:

```text
/srv/baci-cwv/image-id                 0644 root:root
/srv/baci-cwv/source/<merge-sha>/      0555 root:root, immutable manifest-verified PR A `infra/cwv-runner/` tree; scripts 0555, data 0444
/srv/baci-cwv/source-receipts/<merge-sha>/ 0700 root:root, immutable manifest/digests/seal receipt used by bootstrap and every later execution
/srv/baci-cwv/sealed/                  0750 root:baci-cwv
/srv/baci-cwv/sealed/policy.sha256     0640 root:baci-cwv, one lowercase raw reviewed-file SHA-256 plus newline
/srv/baci-cwv/sealed/actions-runner/   0750 root:baci-cwv
/srv/baci-cwv/writable/                0750 root:baci-cwv
/srv/baci-cwv/writable/_work/          0700 baci-cwv:baci-cwv
/srv/baci-cwv/writable/_diag/          0700 baci-cwv:baci-cwv
/srv/baci-cwv/writable/scratch/        0700 baci-cwv:baci-cwv
/srv/baci-cwv/registration-staging/    0700 root:root parent, empty outside registration
/srv/baci-cwv/registration-staging/<nonce>/ 0700 baci-cwv:baci-cwv, random child present only during registration
/srv/baci-cwv/campaigns/               0700 root:root
/srv/baci-cwv/allow/                   0700 root:root
/srv/baci-cwv/listener-release/        0750 root:baci-cwv, empty outside one held activation
/srv/baci-cwv/hooks/                   0755 root:root
/srv/baci-cwv/evidence/                0750 root:baci-cwv
/srv/baci-cwv/retired-ollama/          0700 root:root
/srv/baci-cwv/import/                  0700 root:root, empty outside one prepare transaction
/srv/baci-cwv/docker/                  0700 root:root, dedicated image/content root
/srv/baci-cwv/containerd/root/         0700 root:root, dedicated containerd root
/etc/baci-cwv/containerd.toml          0644 root:root, policy-rendered dedicated config
/etc/baci-cwv/daemon.json              0644 root:root, policy-rendered dedicated Docker config
/run/baci-cwv/                         0750 root:baci-cwv, dedicated runtime parent
/run/baci-cwv-registration/<nonce>/    0700 root:root, tmpfs random non-traversable token parent present only during registration
/run/baci-cwv-registration/<nonce>/token 0440 root:baci-cwv, tmpfs direct-bind source present only during registration
/run/baci-cwv-registration-release/<nonce>/ 0700 root:root, ephemeral non-traversable release parent present only during registration
/run/baci-cwv-registration-release/<nonce>/handoff/ 0750 root:baci-cwv, empty host child direct-mounted read-only at the container release path and absent outside registration
```

`baci-cwv-containerd.service` invokes the installed pinned host `containerd` binary with only `/etc/baci-cwv/containerd.toml`; that config sets root `/srv/baci-cwv/containerd/root`, state `/run/baci-cwv/containerd`, and gRPC address `/run/baci-cwv/containerd/containerd.sock`. `baci-cwv-docker.service` has exact `Requires=`/`After=` only on that dedicated containerd unit and invokes the installed pinned host `dockerd` binary with `/etc/baci-cwv/daemon.json`; that config sets only Unix host `/run/baci-cwv/docker.sock`, data-root `/srv/baci-cwv/docker`, exec-root `/run/baci-cwv/docker-exec`, pidfile `/run/baci-cwv/docker.pid`, containerd socket `/run/baci-cwv/containerd/containerd.sock`, default bridge `none`, `iptables=false`, `ip-forward=false`, `ip-masq=false`, IPv6 false, live-restore false, userland-proxy false, and no default address-pool fallback. Prepare/import never creates a network or firewall rule and runs every synthetic container with `--network=none`. A normal campaign or one-time registration-only transaction, after both daemons are healthy and its durable watchdog is armed, uses only the dedicated socket to create IPv4-only `baci-cwv-net` with explicit `--driver bridge --subnet 172.31.255.0/28 --gateway 172.31.255.1 --opt com.docker.network.bridge.name=baci-cwv0`; it refuses unless readback equals policy and removes the exact network before stopping the dedicated daemons on every terminal path. Only those two reviewed transaction modes may add the exact three tagged shared-chain entries plus two receipt-owned isolation chains after a full baseline/collision/address/route audit. Both units are `disabled`, `Restart=no`, `NoNewPrivileges=true`, and members of `cwv-measurement-control.slice`; production `/run/docker.sock`, `/run/containerd/containerd.sock`, `/var/lib/docker`, `/var/lib/containerd`, `docker.service`, and `containerd.service` are statically forbidden. Install refuses unless exact host binary paths/hashes/features are recorded, dedicated paths are empty or receipt-owned, the route/address/bridge/network/socket/service/firewall namespace is collision-free, and `systemd-analyze verify` passes all units. Task 6 starts/stops the dedicated daemons, creates/removes only the exact dedicated network, and adds/removes only those receipt-bound isolation entries/chains inside the existing pre-listener campaign transaction; the watchdog owns the failure fallback described above.

The development Mac builds the archive only after PR A is merged/deployed and from a disposable exact-merge checkout. In one owner-created temporary directory, run `source-manifest.mjs freeze` with the exact PR number, reviewed head, base, and merge SHA; immediately run `source-manifest.mjs verify` with the same identities; then pass that exact manifest plus its digest to `build-image.mjs --execute` and `--verify-archive`. The build refuses if the manifest does not equal the reviewed PR/merge bytes, and cleanup deletes the manifest/digest/archive/receipt only after verified import. It transfers the secret-free archive and receipt to one owner-selected random host staging path outside the dedicated mutable roots and records their hashes. `--prepare` first verifies the complete bootstrap receipt and validates those external inputs read-only; it then snapshots every running production application container id/state/health tuple plus the production Docker/containerd service/socket/root/bridge/network/firewall identities and pressure/disk/memory baselines, proves the exact dedicated paths plus reserved network namespace are collision-free, writes/fsyncs the immutable prepare capture with the external path/hash identities and phase, and arms/verifies the independent prepare-mode watchdog. Only after that protection is active may it create the receipt-owned import directory or move/copy input bytes into `/srv/baci-cwv/import`. It then starts only `baci-cwv-containerd.service` followed by `baci-cwv-docker.service`, both already hard-bound inside `cwv-measurement-control.slice`, and addresses only `/run/baci-cwv/docker.sock`; the client joins the same slice. No network or firewall rule is created. A root supervisor samples that slice and all frozen production state every two seconds, attributes every CWV daemon/shim/import worker, cancels on any safety breach, and never calls a production daemon, application stop/restart, or external health endpoint. Before the real archive, the same dedicated mechanism imports, runs with `--network=none`, cancels, and removes a locally generated disposable synthetic image, proving live-kernel containment, target-content cleanup, dedicated-service stop, and unchanged production/application/firewall tuples. Success requires the real loaded image id/config digest to equal the build receipt, every production/application tuple to remain unchanged, and no unattributed worker/content delta. On success, the unconditional trap removes only archive/staging bytes and the disposable synthetic image, stops both dedicated daemons, restarts them once under the same bounds, proves the receipt-bound target image still inspects to the exact id/config digest, atomically fsyncs `target-accepted`, stops/removes the exact receipt-owned containers while the socket is responsive, stops the daemons, proves every dedicated control/measurement cgroup and runtime process empty plus both sockets dead, retains only that target image/content plus its receipt for registration, completes the same verified reconciliation as the watchdog, and only then disarms it. On every terminal path the controller/watchdog cleanup first removes exact receipt-owned containers through the live socket or, if unavailable, terminates only their captured container/shim scopes and proves all dedicated cgroups/processes empty and sockets dead before touching content roots. Before `target-accepted`, any failure, cancellation, signal, timeout, SSH/controller/supervisor death, reboot, daemon drift, or watchdog expiry then removes only partial/synthetic/target content and staging owned by that unaccepted transaction. At or after `target-accepted`, recovery retains the exact receipt-bound target/root, removes only archive/synthetic staging, and writes the success recovery receipt. Tests distinguish these cleanup sets, exercise every phase, surviving shim, dead daemon, and reboot, and prove a post-success daemon restart can inspect the retained exact image. The VPS never runs BuildKit, downloads packages, performs an image pull, changes the production control plane, or leaves a dedicated daemon/socket/network/bridge/watchdog/container/shim/cgroup active after prepare.

For avoidance of doubt, the preceding phrase “validates those external inputs read-only” authorizes only `lstat`/identity capture before the watchdog; it never authorizes parsing or deriving an expected digest from those paths. The exact owner-local archive and receipt SHA-256 values are separate bootstrap-command inputs. After protection, root copies the opaque bytes to random no-follow transaction files, fsyncs and hashes the copies, and only those matching root-owned copies may reach receipt/archive parsing or a daemon. All later references to archive/receipt bytes in this task mean those root-owned copies.

The locked host account and container account both use UID/GID `10001`. `install.sh --prepare` reads the exact reviewed repository `policy.json` as a regular nonsymlink file, verifies its source-manifest `blobSha256`, computes SHA-256 over those raw bytes, writes that lowercase digest plus newline to a root temporary file, fsyncs, sets `0640 root:baci-cwv`, and atomically renames it to persistent `/srv/baci-cwv/sealed/policy.sha256`; it then requires the image-embedded policy bytes and raw digest to be identical. The separately named canonical semantic digest is recorded but never used as byte authority. Registration and normal Docker argv bind the persistent raw-file digest read-only to `/run/baci-cwv-policy/policy.sha256`; every start and post-reboot verification checks owner/mode/one-line syntax, exact embedded/reviewed byte equality, raw digest equality, and separately named canonical digest equality before the listener runs. A whitespace-only or key-order-only policy replacement therefore refuses. Before granting temporary group-read access or starting registration, root proves no process whose real/effective/saved UID, GID, or supplementary groups include `10001`, no runner listener/worker, and no container, cgroup, user namespace, or mount using that identity exists. A root-owned guard then accepts only the one receipt-bound registration envelope and its exact sealed process/mount tree described above, continuously from before token-parent creation until after token deletion; anything outside or in excess of that envelope is a synchronous terminal event, not a sampled warning. A synthetic cross-UID probe must prove the live VPS procfs/Yama policy prevents the ordinary `bassey` account and every non-root service identity from reading UID-10001 process environments; command-line readability is harmless because the token is forbidden from argv.

First registration is a distinct durable `registration` state-machine mode, not an implicit Docker call and not a measurement campaign. Before reading or mounting the token, `install.sh --register-token-stdin` installs its unconditional cleanup trap and continuous identity/mount guard, acquires the global campaign lock, verifies the retained image, creates/fsyncs the immutable capture, arms the same independent watchdog, proves `ip_forward=1`, starts only the dedicated daemons in the control slice, creates/readback-verifies the exact IPv4-only network and receipt-owned isolation entries/chains, proves host-local/private/cross-network denial plus public DNS/TLS success in the separate credentials-free probe container, removes that probe's temporary allow rule, and proves the future registration container's receipt-bound egress chain is default-drop with zero counters. Registration mode does not stop application containers, pin their CPUs, start another runner, start the sampler/browser, or create the measurement accounting table; it does continuously verify production container/service/firewall/address/route tuples, the exclusive UID/GID-10001 identity/mount inventory, the egress-gate state/counters, and all resource/pressure bounds.

Only a green isolation/probe/identity/default-drop receipt bound to the capture/network/image/policy digest permits reading exactly one token line from stdin; enforce a reviewed length/character grammar and reject extra bytes, EOF, or timeout. Root creates a cryptographically random `/run/baci-cwv-registration/<nonce>/` parent as `0700 root:root`, atomically creates its `token` as `0440 root:baci-cwv`, and never accepts a path/argv/environment token. Any pre-token failure restores without consuming stdin or creating the parent. After that proof, first registration creates one separate cryptographically random staging child under its non-traversable root parent, makes only that child `0700 baci-cwv:baci-cwv`, bind-mounts it to `/registration-staging`, bind-mounts the persistent sealed policy digest read-only to `/run/baci-cwv-policy/policy.sha256`, direct-bind-mounts the host token read-only to `/run/secrets/runner-registration-token`, direct-bind-mounts only the empty root-owned handoff child read-only at `/run/baci-cwv-registration-release`, and starts only the exact direct-Node registration entrypoint; this is the only container mode with token/staging/registration-release mounts. Immediately before token creation, before each mount, at ready, after token unmount/delete, before release publication, after the one release read, before and after exec, while Listener configure runs, and before sealing, the guard requires either zero-identity pre-start or exactly the receipt-bound registration container/cgroup/namespaces, exact one-PID executable phase, exact phase-appropriate policy/staging/token/release mounts, and expected egress-gate/counter state. An outside identity, second container/cgroup/namespace, second/wrong-hash process, PID/namespace drift, readable token at exec, packet before release, early/multiple/replayed release, wrong release metadata, release reread, or undeclared mount synchronously keeps/returns egress default-drop, stops the container, unmounts token/staging/release, deletes token/nonce/staging/release, and restores before sealing/copy.

A root-installed unconditional cleanup trap keeps/returns registration egress default-drop, unmounts the container token and deletes host token/nonce first if the pre-`execve` barrier has not already done so, deletes/unmounts the registration-release handoff on every terminal path, then removes the staging child on success, failure, signal, timeout, guard trip, or Docker error. Immediately after a successful container exit, the installer re-proves token/release/mount absence, validates the generated identity, proves neither the container config nor any surviving process environment contains the input, and copies only the runner binaries, reviewed configuration, `.runner`, and `.credentials*` into `/srv/baci-cwv/sealed/actions-runner`, with root ownership and only the group read/execute permissions required by the listener, then removes staging. Any generated `.env` or other undeclared dotfile is classified as untrusted registration output, is never copied into the sealed tree, is deleted with staging, and its presence is a test-covered refusal unless the listener contract proves it unnecessary; normal runtime environment is constructed only from reviewed policy/controller inputs. It then removes the three shared entries and two owned chains plus network, stops both dedicated daemons, restores/verifies every captured tuple, disarms the watchdog, and returns the secret-free registration receipt; the service never comes online. Cleanup failure rejects the registration even if GitHub created the row and requires owner-visible row deletion before retry. The hook is `0550 root:baci-cwv`; the per-run allow document is `0440 root:baci-cwv` inside a `0700 root:root` host directory and is bind-mounted directly as a read-only file. UID `10001` cannot write the sealed/token parents and therefore cannot traverse, unlink, rename, replace, or shadow sealed/token children. Only `_work`, `_diag`, and the proven scratch directory are writable. The normal listener refuses unsealed ownership/modes or any registration token/staging/registration-release mount. The registration token exists only in the read-only tmpfs file, then the single pre-exec Node buffer, then the short-lived registration Listener environment; it is never placed in argv, a unit, Docker `Config.Env`, image layer, file outside tmpfs, log, artifact, or shell history. Its mount/file are removed and proven absent before the same-PID exec transition, the Node buffer is overwritten at exec, and CommandSettings removes the environment key during configuration.

The registration fixture must prove the sealed Node lifecycle can launch exact `Runner.Listener run --once` from the declared sealed file set with no `.env`, without executing or modifying any runner shell/helper. Once that proof is green, a generated staging `.env` may exist only as an ignored registration byproduct and is deleted unread with the child; the refusal applies to any attempt to classify, copy, mount, or consume it, not to its transient staging presence.

The held/normal listener container may read only `/host-evidence/live-sample.json`, `/run/baci-cwv-policy/policy.sha256`, read-only `/run/baci-cwv-listener-release`, and its sealed runner/admission inputs. It never mounts `/var/run/docker.sock`, host `/proc`, host `/sys`, systemd D-Bus, journal files, SSH keys, `/run/secrets`, or registration staging. Every authority check requires the sample's `capturedAt` to be at most 15 seconds old, its campaign/lease id to match, and both collection commands to have succeeded. The root controller creates the release record by temporary-file write, fsync, `0440 root:baci-cwv`, and atomic rename only after container/veth/classifier/live-sample verification; on timeout, signal, controller death, or any terminal path it stops the held container, deletes the release/allow records, removes the owned classifier/table, and restores.

The Docker flags `--memory=8g --memory-swap=8g` intentionally yield zero container swap because Docker interprets equal values as no additional swap. Installation verifies the resulting cgroup has `memory.max=8589934592` and `memory.swap.max=0`; it does not describe the ceiling as a reservation.

The normal `bassey` SSH account lacks passwordless sudo. Root bootstrap is therefore an owner-visible interactive checkpoint, not an automated password prompt. The reviewed runbook provides one fixed root bootstrap script and, if repeatable control is required, one narrowly scoped root-owned controller or sudoers command alias for the exact install/quiesce/restore/status subcommands. It must never grant `NOPASSWD:ALL`, a general shell, arbitrary script paths, arbitrary systemctl, or arbitrary Docker commands. No password is requested or transmitted in chat, CI, a file, or an environment variable.

- [ ] **Step 4: Run GREEN and a disposable local service-shape check**

```bash
node --test infra/cwv-runner/install.test.mjs infra/cwv-runner/vps-ssh.test.mjs infra/cwv-runner/source-manifest.test.mjs infra/cwv-runner/seal-source.test.mjs
test -x infra/cwv-runner/vps-ssh.sh
tar -C infra/cwv-runner -cf - cwv-measurement-control.slice cwv-measurement.slice baci-cwv-containerd.service baci-cwv-docker.service baci-cwv-host-sampler.service baci-cwv-host-sampler.timer baci-cwv-measurement.service baci-cwv-campaign-watchdog@.service | infra/cwv-runner/vps-ssh.sh -- 'tmp=$(mktemp -d); trap '\''rm -rf -- "$tmp"'\'' EXIT; tar -C "$tmp" -xf -; systemd-analyze verify "$tmp"/cwv-measurement-control.slice "$tmp"/cwv-measurement.slice "$tmp"/baci-cwv-containerd.service "$tmp"/baci-cwv-docker.service "$tmp"/baci-cwv-host-sampler.service "$tmp"/baci-cwv-host-sampler.timer "$tmp"/baci-cwv-measurement.service "$tmp"/baci-cwv-campaign-watchdog@.service'
shellcheck infra/cwv-runner/install.sh infra/cwv-runner/seal-source.sh infra/cwv-runner/vps-ssh.sh
```

Expected: all checks pass using the VPS's existing Linux/amd64 systemd parser even when the development machine is macOS/arm64. The temporary payload is deleted by the remote trap. It must not use sudo, write `/etc/systemd`, reload systemd, or start units.

- [ ] **Historical Step 5 seed — do not execute: commit the service unit**

> **Non-executable historical block.** The cumulative Task 1-6 integration rule supersedes this per-task CodeRabbit, `git add`, and `git commit` example. Use it only to understand the original design boundary; stage and commit only the final manifest-driven integration set.

```text
Historical boundary only: isolated service units, runtime configuration, installer, sealed-source flow, fixed VPS transport authority, and their tests formed the service unit. No review, staging, or commit command from the superseded per-task procedure is retained.
```

---

### Task 6: Add finite GitHub authority verification and infrastructure workflow

**Files:**
- Create: `.github/scripts/cwv-runner-authority.mjs`
- Create: `.github/scripts/cwv-runner-authority.test.mjs`
- Create: `.github/scripts/cwv-runner-contract.test.mjs`
- Create: `.github/workflows/cwv-runner-attestation.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/actionlint.yaml`
- Modify: `.github/workflows/actionlint.yml`
- Create: `infra/cwv-runner/exact-run-controller.sh`
- Create: `infra/cwv-runner/job-start-hook.sh`
- Create: `infra/cwv-runner/owner-dispatch.sh`
- Create: `infra/cwv-runner/verify-owner-cli.sh`
- Create: `infra/cwv-runner/verify-owner-cli.test.mjs`
- Create: `infra/cwv-runner/task9-bootstrap.mjs`
- Create: `infra/cwv-runner/task9-bootstrap.test.mjs`
- Create: `infra/cwv-runner/owner-api-transport.mjs`
- Create: `infra/cwv-runner/owner-api-transport.test.mjs`
- Create: `infra/cwv-runner/exact-run-guard.test.mjs`
- Modify: `infra/cwv-runner/Dockerfile`
- Modify: `infra/cwv-runner/entrypoint.sh`
- Modify: `infra/cwv-runner/entrypoint.test.mjs`
- Modify: `infra/cwv-runner/baci-cwv-measurement.service`
- Modify: `infra/cwv-runner/install.sh`
- Modify: `infra/cwv-runner/install.test.mjs`

**Interfaces:**
- `verifyRunnerAuthority(input): Finding[]` receives already-fetched runner, repository retention, the canonical effective-installation-token receipt, ruleset, policy, and local attestation JSON. It does not infer an App-wide installation or permission map from an installation token.
- The workflow emits no measurement row and performs no request to OgaBassey or any storefront.
- The workflow uploads exactly one secret-free artifact named `h0-runner-attestation-<run-id>-<attempt>` retained for 90 days.

The public Actions artifact is a projection, never a raw bundle. Its archive contains exactly one regular nonsymlink member at root, `h0-runner-attestation.json`, with normalized mode and no directory, PAX, link, device, alternate path, or extra member. That file is canonical JSON with exactly these top-level keys: `schemaVersion`, `repository`, `workflow`, `runner`, `resources`, `retention`, `digests`, `failureMatrix`, and `noMeasurement`. Nested keys are closed as follows:

- `schemaVersion`: exact integer `1`;
- `repository`: exactly `id`, `name`;
- `workflow`: exactly `runId`, `attempt`, `publicRunUrl`, `headSha`, `ref`, `job`;
- `runner`: exactly `id`, `name`, `generation`;
- `resources`: exactly the eight public aggregate fields named in Global Constraints;
- `retention`: exactly `repositoryDays`, `maximumAllowedDays`, `workflowDays`, `artifactLifetimeSeconds`; raw creation/expiry timestamps remain private authority inputs;
- `digests`: exactly `policyFileSha256`, `policyCanonicalSha256`, `sourceManifestSha256`, `imageSha256`, `processMapSha256`, `serviceSha256`, `scriptsSha256`, `appPermissionsSha256`, `rulesetSha256`, `runnerInventorySha256`, `hostAttestationSha256`, `liveSampleSha256`, `admissionSha256`, `holdSha256`, `restoreSha256`, and `ollamaRetirementSha256`;
- `failureMatrix`: exactly boolean keys `offlineRunner`, `labelUniqueness`, `hostedRunner`, `concurrentJob`, `lease`, `serviceRestart`, `reboot`, `softwareIdentity`, `egressDnsLocaleTimezone`, `cpuSet`, `thresholds`, `appPermissions`, `ruleset`, `retention`, `artifactReadback`, `rollback`, `doubleRestore`, `networkIsolation`, `supplyChain`, and `retirementIdentity`;
- `noMeasurement`: exact boolean `true`.

One repository-owned projector constructs a fresh object by explicit field selection from private inputs, schema-validates it, canonicalizes it, and writes the sole member into a new empty archive directory; it never copies an input file or recursively archives a directory. The uploader accepts only that one projected file. The readback verifier rejects every extra/missing JSON key, archive member, noncanonical byte, disallowed field type/value, secret-shaped key/value, raw timestamp, raw live sample, admission, inventory, host/controller receipt, environment, address, route, command line, or unapproved path. Tests seed every forbidden private file/key and prove none can enter the artifact. Private raw authority files remain in the mode-`0700` job scratch tree only until verified projection/readback. The already-approved `actionNode` process itself performs bounded overwrite, fsync, unlink, and empty-directory removal through `node:fs`; no `shred`, `rm`, `rmdir`, or other cleanup executable is spawned.

**Selected repository authority model:** GitHub cannot restrict a personal-account repository's self-hosted runner with an organization runner group. On 2026-07-20 the owner explicitly selected the offline exact-run controller instead of transferring the repository. This compensating control is finite and fail-closed:

Freshness constants and execution timers are independent policy inputs: every admission challenge/receipt uses exactly `repositoryAuthority.admissionChallengeTtlSeconds=30`, every pre-release inventory receipt uses exactly `repositoryAuthority.inventoryReceiptTtlSeconds=5`, and the owner queue deadline uses exactly `repositoryAuthority.queueDeadlineSeconds=120`. Attempt 1 starts that queue timer at the successful dispatch response that identifies the exact run; the sole eligible rerun atomically clears attempt 1's timer and starts attempt `prior+1` at the accepted `201` rerun response receipt before waiting for the incremented attempt readback. The container hold timer uses exactly `repositoryAuthority.listenerHoldTimeoutSeconds=120` starting only when the held container begins waiting for release. In the bullets below, “the policy deadline” means only the admission-challenge field. No TTL or timer may be inferred from, aliased to, or started by `hookTimeoutSeconds`, another TTL, another timer, `controllerTimeoutSeconds`, or `watchdogTimeoutSeconds`; schema and exact-run tests reject a missing, changed, swapped, conflated, indirectly selected, wrongly started, or cross-attempt-reused value even when two numeric values happen to be equal.

The workflow job ceiling is not a freshness timer. Its sole authority is the exact integer conversion `timeout-minutes = repositoryAuthority.controllerTimeoutSeconds / 60`: schema validation requires the seconds value be positive, divisible by `60`, and exactly `1200`, so the only accepted YAML literal is `20`. The workflow contract test parses both policy and YAML and rejects rounding, another literal, an expression, a second timeout source, or controller/workflow drift; the root controller still owns earlier terminal cleanup and the independent `watchdogTimeoutSeconds=1800` remains a separate outer recovery ceiling.

- `owner-dispatch.sh` runs only on the development Mac with the owner's already authenticated local GitHub session; no Actions-write/admin credential is copied to the VPS. Its non-dispatching `--prepare-cli --transaction-dir <owner-0700-private-tmp> --policy <exact-reviewed-policy>` mode invokes the generic downloader for only the exact policy-pinned `gh v2.93.0` macOS arm64 archive/checksum file and the exact policy-pinned Node `v24.18.0` Darwin arm64 archive plus the already hash-pinned and signature-authorized Node checksum documents. A narrower post-merge `--prepare-task9-bootstrap-node` mode downloads/verifies only that same Node archive/checksum/signature chain and supplies the authorized Node executable and canonical provenance payload used by Task 8 Step 3a; it accepts no CLI/API operation and statically cannot read GitHub authentication. Only checked-in `task9-bootstrap-bundle-cli.mjs` may invoke `task9-bootstrap-bundle.mjs` to compose the reviewed bootstrap bundle and detached envelope from those outputs plus the once-frozen source-manifest outputs; its closed scalar flags accept no JSON document or network authority. Both preparation modes write only their declared archives, metadata, extracted tools, and canonical secret-free receipts under the owner-only transaction directory; neither reads GitHub authentication, stdin, or a private key during preparation. The dedicated `verify-owner-cli.sh` uses only fixed absolute macOS system tools, accepts no caller-selected executable or PATH lookup, and requires the exact policy checksum rows, archive SHA-256 values, extracted regular nonsymlink binary SHA-256/mode, and exact `gh`/Node version bytes before publishing canonical secret-free receipts. Verification makes no network request. A wrong/missing/duplicate checksum row, archive/binary/version drift, symlink/path/tool/environment substitution, post-receipt replacement, a version string alone, or fallback to an existing CLI/runtime refuses.
- `task9-bootstrap.mjs` has no dependency on repository modules, PATH tools, environment configuration, or network. Production authorization reaches it only through `owner-dispatch.sh --bootstrap-task9`: the exact merged-source-manifest-bound dispatcher copies and revalidates the envelope-bound `task9-bootstrap-runtime.mjs`, and that held launcher invokes the direct-execution-refusing bootstrap module with already-held, revalidated bytes. The bootstrap accepts only the fixed relocated bundle layout, independently preserved raw detached-envelope digest, and a new owner-only output directory. It implements the same canonical-JSON rules locally, requires exactly the seven envelope-declared payload entries and no extra bundle file beyond the detached envelope/digest, rehashes itself and the exact pinned Darwin Node executable, verifies every schema-accepted envelope identity/mode/digest, and parses the normalized source tar from one held file descriptor. Node checksum/signature/key identity is not duplicated as envelope fields: it remains in canonical `node-provenance.json` and is validated against the envelope's runtime hashes and the source-authorized policy. Likewise, the ustar schema/version/limits and canonical member rules are enforced by the hash-bound parser/code, while the exact ten-operation set/digest is enforced by the hash-bound bootstrap/transport code and emitted in `source-authorization.json`; neither contract is represented by undeclared envelope keys. The bounded parser accepts only the exact archive encoding emitted by `source-manifest.mjs`: regular ustar members, repository-relative UTF-8 paths below `infra/cwv-runner/`, exact `100644`/`100755` projected modes, zeroed padding, one occurrence per sorted manifest row, no PAX/GNU extension, link, device, sparse member, duplicate, trailing member, oversized field/archive, or path ambiguity. It compares the complete member set, modes, sizes, and raw contents to `sourceArchive.entries`, requires the exact policy/dispatcher/transport/verifier/bootstrap/source-manifest rows, and only after the entire archive passes writes members from that same descriptor into a new no-follow temporary tree, reapplies fixed manifest modes, rehashes the complete tree, atomically publishes the authorized source child, and emits canonical `source-authorization.json` plus digest for purpose `task9-exact-run` and the exact ten-operation set. It never executes an archive member. Tests prove self-reference/extra payload, logical-bundle-id, envelope/digest, malformed JSON/tar, symlink/type/mode/path/order/duplicate/size/hash/identity/operation-set drift and post-hash replacement refuse before authorization or publication; they also prove a correctly verified relocation passes and the pinned Node/bootstrap pair is sufficient from an empty sanitized environment.
- Task 7 uses only `verify-owner-cli.sh --exec-gh-operation <closed-operation>`. That mode immediately revalidates the `task7-provisioning` source-authorization receipt/digest/purpose, owner-sealed verifier/receipt/parent/binary path/inode/type/mode/owner/hash/version, constructs the exact operation internally, and `exec`s only the exact pinned `gh` except for the registration read described below; no caller-supplied argv or path may select an executable, endpoint, method, repository, workflow, ref, secret, variable, or ruleset. Task 7 admits only `set-auditor-private-key`, the three named numeric variable sets, `read-auditor-app-registration` (a separately checked ephemeral RS256 App JWT over the sealed owner inputs, delivered only through an anonymous pipe to the independently revalidated pinned Node runtime, whose fixed HTTPS request sends `Authorization: Bearer` to authenticated `GET /app` without placing the JWT in argv, environment, or disk or falling back to the stored owner credential), exact retention read, the named ruleset read/create-or-update, and owned probe-ref create/read/delete. It does not admit `read-auditor-app-installation` or `read-auditor-app-permissions`: installation ID is owner-supplied from the GitHub UI and is bound later by the pinned Task 6 action output. Workflow dispatch/rerun/cancel and every other API path/method refuse. After Task 7 the transaction writes completion and removes the receipt directory, so the receipt cannot be reused.
- Task 9 requires a distinct final-manifest source-authorization receipt with purpose `task9-exact-run` covering the exact policy, dispatcher, verifier, and `owner-api-transport.mjs` bytes. Its finite operation set is exactly `list-attestation-runs`, `dispatch-exact-run`, `read-exact-run`, `cancel-exact-run`, `read-failed-job-evidence`, `rerun-failed-exact-run`, `list-runner-inventory`, `read-exact-job`, `list-exact-artifacts`, and `download-exact-artifact`; Task 7 operations and every other endpoint/method refuse. A canonical owner transaction state begins with repository id/name, workflow id/path/ref, `expected_sha`, 256-bit `admission_id`, policy/final-manifest/transport/runtime receipt digests, monotonic creation/deadline, and operation-set digest. The transport itself derives every method, URL, API version, body, and Accept header from that state and operation enum. Response-derived run id, attempt, job id, artifact id, next-page URL, and failed-job/step evidence are schema-validated, atomically appended to the state, and must be consumed by later operations from that state; none is accepted as a caller-selected endpoint or unbound argv value. Exactly one rerun transition is permitted and it requires the read-back incremented attempt.
- For each Task 9 API request, `verify-owner-cli.sh` may emit the existing GitHub token only through a one-request anonymous pipe after all source/tool/state receipts pass. The token never enters argv, environment, disk, receipt, log, or artifact. The exact sealed Darwin Node then executes only `owner-api-transport.mjs`, validates the full target before reading that pipe, and attaches Authorization only to exact origin `https://api.github.com`. Every API 3xx is terminal except the state-bound `download-exact-artifact` endpoint: that operation requires exactly one `302` whose Location is HTTPS with no credentials/fragment, hostname matches only `repositoryAuthority.artifactDownload.hostPattern`, path begins only with its exact `pathPrefix`, and unique query keys are a nonempty subset of its exact ordered `allowedQueryKeys`; unknown/duplicate/empty fields reject. It rejects localhost and every private/special/reserved literal or resolved address, performs exactly one bounded DNS resolution, canonicalizes and validates the complete answer set, selects one deterministic validated address, and binds that hostname/address/answer-set digest into transaction state before connecting. The credential-free GET creates the TLS socket directly to that exact IP without a second hostname lookup while preserving the original validated hostname for HTTP `Host`, TLS `servername`/SNI, and certificate/hostname verification; after connect it requires `socket.remoteAddress` equal the selected canonical address. A lookup callback, resolver fallback, proxy, agent pool, connection reuse, address switch, or socket mismatch rejects. Any second redirect rejects, and the signed Location/query/address is never printed, logged, persisted outside owner-only state, or included in an error/public receipt. The download uses the four exact policy deadlines and `maxBytes`, computes the archive SHA-256 while streaming to an owner-only temporary file, requires it equal the exact artifact metadata digest already bound into state, and requires exactly one canonical `h0-runner-attestation.json` member whose bytes pass the closed public schema before accepting readback. Runner pagination begins at the one exact page-1 API URL. Only a validated same-origin Link with exact repository path and canonical bounded `per_page=100&page=<n>` query may atomically advance the stored page cursor; each page is requested individually, page loops/overflow reject, and no `gh --paginate` path exists. Unit tests use local TLS fixtures and a fake token producer to prove pre-token target validation, ordinary 3xx refusal, the sole policy-grammar credential-free artifact 302, zero Authorization/cookie bytes at the second origin, second-redirect/host/path/query/private-target/size/time/metadata-digest/member refusal, safe body/header bounds, complete pagination, and cleanup without reading the owner's real authentication. A dedicated DNS-rebinding fixture returns one allowed address during validation and a different/private address on any second lookup; the request must perform only the first resolution, connect to the state-bound allowed IP with original-host SNI/certificate validation, and fail if any code attempts or accepts the second address.
- In normal Task 9 mode the state machine first proves zero active workflow instances, where the closed nonterminal active-status set is exactly `queued | in_progress | requested | waiting | pending`; records the exact independently reviewed and successfully deployed current-main control commit as `expected_sha`; and sends one exact `2026-03-10` REST dispatch payload containing only `ref:"main"` and `inputs.admission_id`. GitHub's current official `2026-03-10` contract returns run details with HTTP `200` for that payload and exposes no `return_run_details` body field; tests pin the request/response schema and reject that extra field;
- the dispatcher requires HTTP `200` and nonempty `workflow_run_id`, `run_url`, and `html_url`; HTTP `204`, missing/extra fields, a caller-supplied `return_run_details`, or an unpinned CLI/API version fail closed. The workflow requires `admission_id` and includes it in `run-name`. Before the runner starts, the dispatcher reads the returned run and requires exact workflow id/path, `event=workflow_dispatch`, owner actor, `head_branch=main`, `head_sha=expected_sha`, attempt `1`, status in exactly `queued | in_progress | requested | waiting | pending`, creation window, and admission id in `display_title`. It then performs the mandatory post-dispatch `list-attestation-runs` reconciliation from `QUEUED`/`RUNNING`: one complete paginated read must contain exactly that already bound run as the sole row in the same closed active-status set, with unchanged admission/repository/workflow/ref/SHA/actor/attempt fields; the dispatcher binds its digest and state generation before emitting any admission document or asking root to release. An absent, duplicate, additional active run, or binding mismatch cancels where possible, keeps the listener unreleased, restores the host, and durably enters `MANUAL_RECONCILIATION`. Any main advancement/mismatch is cancelled from the owner workstation and produces no admission document. The canonical document also binds expected job id `attest`, full workflow ref, workflow SHA, and the post-dispatch reconciliation digest;
- after root establishes hold, it generates the one-use inventory nonce and a root-local monotonic challenge timestamp/deadline and returns them as opaque bound fields in the secret-free canonical hold receipt over the authenticated SSH controller channel. The owner dispatcher binds that exact challenge plus admission/run/attempt/expected SHA, repository id, policy digest, held container id/IP/veth/classifier/live-sample digest into a fresh runner-inventory request. Using only the immediately rebound verified local CLI/session, it begins at exactly `https://api.github.com/repos/ogabasseyy/Baci/actions/runners?per_page=100&page=1` and follows only bounded Administration-read pagination whose resolved next URL has scheme `https`, no credentials, no fragment, exact origin `https://api.github.com`, exact path `/repos/ogabasseyy/Baci/actions/runners`, and query containing exactly canonical `per_page=100&page=<positive bounded integer>` fields. Relative links are resolved before validation. Any redirect or Link target with another origin/path/query, duplicate/unknown query field, malformed page, loop, or page-count overflow is rejected before contact; authorization is never forwarded to another origin. It requires response `total_count` equals the unique union of all page rows with no missing/duplicate id, and canonicalizes every registered runner's id/name/status/busy/OS/architecture/complete label multiset. It requires exactly one row across online/offline states carries `baci-cwv-measurement`, that row equals the sealed runner identity, records owner UTC timestamps only as cross-host audit data, echoes the opaque challenge, then immediately transfers the receipt through the same SSH stdin/controller channel. The root controller stores it `0440 root:baci-cwv`, verifies canonical bytes, pagination proof, hold/admission/challenge bindings, nonce, policy/inventory digest, uniqueness, channel identity, and replay absence, records receipt arrival with its own monotonic clock, and sets the only authoritative inventory expiry to that root-local arrival plus five seconds. It rechecks that local deadline immediately before release, then deletes the receipt with the release/allow records. No monotonic value from the owner is compared with a VPS monotonic value. The VPS receives no GitHub credential and performs no GitHub request. Timeout, incomplete pagination, extra/missing/duplicate row, label drift, replay, expired root-local challenge/receipt deadline, channel break, or hold drift cancels/restores; the owner polls only for root acknowledgement and cancels if acknowledgement is absent inside the protocol timeout;
- the root controller generates a separate one-use admission nonce and root-local monotonic challenge/deadline, transfers that opaque challenge to the owner dispatcher, and starts no container before a response. The owner uses the immediately rebound verified CLI/session to read live run metadata and creates the canonical admission document only after every run/workflow/actor/ref/SHA/attempt/status/time/input binding passes; its UTC timestamps are audit fields only. It echoes the root challenge over the authenticated SSH controller channel. Root makes no GitHub request: on receipt it validates canonical bytes, schema, policy digest, repository/workflow/ref/SHA/run/attempt/job/admission bindings, exact challenge/nonce, channel identity, and replay absence, then records root-local monotonic arrival and computes the only authoritative admission expiry from that arrival plus the policy deadline before installing the allow record as `0440 root:baci-cwv` and starting the container into mandatory pre-listener hold. No cross-host monotonic comparison or owner-issued expiry authorizes freshness. Owner-side authentication/rate-limit failure, replay, expired root-local challenge/receipt deadline, or any channel/binding mismatch is a hard refusal; no GitHub credential is stored on the VPS;
- `ACTIONS_RUNNER_HOOK_JOB_STARTED` points to a mode-`0550 root:baci-cwv` hook outside the runner application directory. It reads only the named default variables `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_ID`, `GITHUB_WORKFLOW_REF`, `GITHUB_WORKFLOW_SHA`, `GITHUB_REF`, `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, and `GITHUB_JOB`, plus only the `admission_id` field parsed from `GITHUB_EVENT_PATH`; compares every allow-record field; and exits nonzero before steps on any mismatch. It never dumps the environment or serializes the full event payload;
- because GitHub provides no hook timeout, the wrapper enforces a five-second monotonic deadline and fails closed on timeout, missing variables, parse errors, unreadable policy, or clock/expiry drift;
- runner configuration, credentials, hook, allow record, image-id, and entrypoint are root-owned/read-only; only `_work`, `_diag`, and narrowly required temporary state are writable by UID/GID `10001`;
- the runner is offline before dispatch. After the exact run is queued, root starts the container in hold, proves no `Runner.Listener` exists, validates its Docker id/IP/veth, installs and hash-verifies the classifier, arms local sampling, requires one fresh clean sample, obtains and validates the owner-dispatcher's complete all-state five-second inventory receipt bound to that exact hold, then atomically publishes the bound release record and immediately acknowledges release. Only then may the sealed Node lifecycle spawn exact `Runner.Listener run --once`. A 120-second hold timeout, alternate mode, early listener, missing classifier/sample, incomplete/stale inventory receipt, label-inventory drift, or record mismatch stops the container and restores; success, failure, cancellation, mismatch, controller error, any nonzero/retry/update Listener exit, or 30-minute watchdog expiry also stops it and deletes release/allow/inventory records;
- after listener release, the controller/sampler continuously requires exactly one attested `Runner.Listener`, zero or one `Runner.Worker`, and only policy-approved executable-hash/cgroup descendants. `busy:true` must coincide with exactly one worker for the admitted job; before job assignment and after job exit it must coincide with zero workers. Any second listener/worker, worker for another run, unknown descendant, cgroup escape, or surviving process after `--once` terminates cancels and restores;
- a repository static contract test parses every workflow and rejects `baci-cwv-measurement` in any actual `jobs.*.runs-on` selector except the exact attestation job; comments, human guidance, and actionlint label declarations are not runner selectors. It also rejects pull-request/fork triggers, reusable invocation, alternate refs, matrices, fallback labels, or Actions write permissions;
- the repository static contract test also loads the parsed policy and proves the installed slice, container argv, `/dev/shm` attestation, host idle sampler, workflow verifier, and workflow job timeout consume or exactly derive from its CPU, memory, swap, shared-memory, PID, ambient-network, and controller-deadline values; a stale duplicated resource or timeout value is a failure;
- cancel and same-run rerun are performed only by the owner-side authenticated dispatcher using its existing session. It must read back cancellation or the incremented run attempt and revalidate the unchanged `expected_sha` before transferring an updated admission document; the read-only App and VPS never dispatch, cancel, or rerun Actions;
- this exception protects exposure operationally; it is not represented as equivalent to an organization runner group and must be reapproved if GitHub's repository ownership or runner controls change.

- [ ] **Step 1: Write RED authority and workflow-contract tests**

RED-test token cleanup as a two-layer contract: the workflow must omit `skip-token-revoke` so the pinned action registers its default post-job revoker for runner-processed cancellation or interruption after minting, while the authority phase must still perform its earlier `DELETE /installation/token` `204` plus same-buffer `401` proof and wipe before reading host evidence. Reject any workflow that sets `skip-token-revoke`, and prove the already-revoked normal path remains compatible with the pinned post hook's warning-only error handling.

Test exactly one registered runner across the complete API inventory with the dedicated label, required labels, and `busy:true` when the verifier is executing on it. Reject zero/two label-bearing rows even when the duplicate is offline or otherwise ineligible; also reject the selected row when offline, idle, wrong id/name/OS/architecture/generation, missing/extra label, hosted, or accompanied by a second job worker. Repeat the complete all-state label uniqueness read immediately before listener release and refuse/restore on any intervening registration or label drift. Reject repository retention `days != 90`, repository `maximum_allowed_days < 90`, workflow `retention-days != 90`, uploaded-artifact expiry outside the frozen 90-day ±5-minute window, App permission other than `administration:read` and `metadata:read`, missing/disabled ruleset, bypass actor, missing/extra/reordered update-deletion rule, include/exclude drift, changed attestation, unpinned action, hosted fallback, matrix, `actions:write`, `artifact-metadata:write`, `issues:write`, storefront URL, Lighthouse, PSI, DebugBear, or browser command. Also RED-test: obsolete `return_run_details`, dispatch HTTP `204`, missing/wrong `workflow_run_id`/`run_url`/`html_url`, wrong API/CLI version, missing/duplicate/drifted owner-CLI checksum row, wrong owner-CLI archive or extracted-binary digest, missing/noncanonical/wrong-digest source manifest or source-authorization receipt, a missing/wrong/caller-computed `PREFLIGHT_POLICY_FILE_SHA256` or one not equal to the independently verified manifest row, wrong/missing purpose or operation set, missing/wrong-mode/wrong-hash sourceArchive rows for policy/dispatcher/verifier, direct checkout dispatcher execution, dispatcher/helper import from the checkout, symlink/path/fixed-tool/environment substitution, PATH/Homebrew/host-Node fallback, post-receipt script or binary replacement, stale source/verifier/receipt/parent ownership or mode, stdin delivery to any executable other than the exact rebound CLI, caller-supplied argv, arbitrary API endpoint/method, workflow dispatch/rerun/cancel under Task 7 purpose, any creation rule that would block new rollout tags, reuse after Task 7 completion, main/head-SHA advancement, wrong actor/status/creation window, missing/malformed/mismatched `admission_id`, hook-time extraction of the input from a realistic `workflow_dispatch` event fixture, wrong repo/workflow/ref/SHA/run id/attempt, expired/missing allow record, writable guard inputs, fork/PR/reusable triggers, duplicate labels, held-container identity/veth/classifier/sample/release mismatch, Listener-before-release, hold timeout, release cleanup, controller death, cancellation, and every terminal-path cleanup. The workflow contract test must also parse `.github/workflows/deploy.yml`, require `infra/cwv-runner/**` in the `web` path filter, and reject its removal or placement in a non-deploying filter. `verify-owner-cli.test.mjs` owns the exact positive source/dispatcher/verifier/archive/checksum/binary/version receipts, immediate `--verify-source`, `--verify-only`, and `--exec-gh-operation` revalidation, fixed `/private/tmp` key-transaction constraints, and all owner-CLI negative cases with fake fixed tools; no test reads the host GitHub authentication or performs network I/O.

The exact-run guard suite additionally fixtures multi-page runner inventories and proves complete pagination, `total_count` equality, unique ids, canonical label multisets, offline duplicates, root-generated one-use inventory/admission challenges, admission/run/attempt/repository/expected-SHA/policy/hold binding, root-local monotonic arrival plus expiry, audit-only owner UTC fields, authenticated-channel receipt installation, release acknowledgement, and inventory-record deletion. It rejects missing/repeated/reordered pages that change canonical rows, duplicate ids, count mismatch, pagination loops/overflow, absolute or relative Link targets with an external origin, wrong repository path, unknown/reordered/noncanonical query fields, every API redirect except the one exact artifact-download 302, any attempt to forward authorization/cookies to the artifact origin or any other origin, replayed/wrong challenge, expiry before receipt/release under the root clock, any attempt to compare owner and VPS monotonic values, holder drift, a second label between initial admission and held release, any root-side GitHub credential/request, or listener execution before the fresh receipt is durable and verified. `owner-api-transport.test.mjs` separately proves the exact ten-operation Task 9 enum, final-manifest/runtime/transport/state binding, response-derived state transitions, deterministic failed-job evidence classification, one rerun only, individual bounded pages, absence of `gh --paginate`, target validation before token read, ordinary redirect-disabled local-TLS behavior, the single credential-free artifact 302 contract, exact metadata-digest/one-member verification, and no token or signed Location in argv/environment/files/output/errors.

- [ ] **Step 2: Run RED**

```bash
node --test .github/scripts/cwv-runner-authority.test.mjs .github/scripts/cwv-runner-contract.test.mjs infra/cwv-runner/exact-run-guard.test.mjs
```

Expected: FAIL because verifier/workflow files do not exist and the label is unknown.

- [ ] **Step 3: Implement the verifier and workflow**

The manual workflow must have:

```yaml
name: CWV Runner Attestation
run-name: CWV Runner Attestation ${{ inputs.admission_id }}
on:
  workflow_dispatch:
    inputs:
      admission_id:
        description: Exact-run admission nonce
        required: true
        type: string
permissions:
  actions: read
  contents: read
concurrency:
  group: cwv-runner-attestation
  cancel-in-progress: false
jobs:
  attest:
    runs-on: [self-hosted, baci-cwv-measurement]
    timeout-minutes: 20
```

Do not add `artifact-metadata: write`: the pinned `actions/upload-artifact` implementation uploads with `ACTIONS_RUNTIME_TOKEN`, while GitHub's `artifact-metadata` permission governs the separate organization linked-artifact metadata API. This workflow creates no linked-artifact record. Contract tests require exactly `actions: read` and `contents: read`; an `artifact-metadata` write scope or any other write scope is over-privileged and fails.

The reviewed workflow YAML is the sole permitted literal rendering of action pins: it contains exactly four third-party `uses:` scalars, one each for checkout, upload, download, and App-token creation. The contract test parses `policy.workflowActions` and the YAML, maps those four step roles one-to-one, and requires each literal byte-for-byte equal to its corresponding policy field; no generator, alternate constant, expression, reusable workflow, local indirection, or fifth `uses:` source is permitted. It rejects a missing/extra action field or workflow action, duplicate role, wrong repository, non-40-hex ref, workflow/policy mismatch, or any action not declared by this closed map. Consequently every pin change alters the reviewed workflow bytes and both the raw policy-file digest and its separately named canonical semantic digest, invalidating the source manifest and sealed policy/receipt chain until deliberately refrozen.

The first workflow step is the admission validation named below: its sole expression is the exact step-level environment mapping `BACI_CWV_ADMISSION_ID: ${{ inputs.admission_id }}`, and its fixed expression-free `run:` immediately `exec`s sealed `/opt/baci-cwv/runner-identity-gate.mjs` with the sealed action Node before creating scratch, checkout, App-token creation, repository code, or any secret-bearing action. The gate validates the named value's 64-hex grammar and equality to the root record, exact runner name/OS/architecture, the root record's owner/API-verified runner id/name/generation, and complete admission/run bindings, then emits only its secret-free receipt. The contract test requires this is step 1, a fixed `run:` with no `${{ ... }}`, `uses`, secret, network, checkout dependency, or expression-selected executable, and every later step is ordered after its success. Thus the following phrase “validate `admission_id`” includes this complete sealed identity gate; it is not shell interpolation or a regex-only step.

Its steps are: validate `admission_id` as exactly 64 lowercase hexadecimal characters; create one runner-owned mode-`0700` directory under the job's writable scratch area; use pinned checkout with persisted credentials disabled; then invoke the pinned App-token action once with exactly `id: auditor-token` and inputs `client-id:${{ vars.BACI_CWV_RUNNER_AUDITOR_CLIENT_ID }}`, `private-key:${{ secrets.BACI_CWV_RUNNER_AUDITOR_PRIVATE_KEY }}`, `owner:ogabasseyy`, `repositories:Baci`, `permission-administration:read`, `permission-metadata:read`, and `github-api-url:https://api.github.com`, with no proxy environment, `skip-token-revoke`, or other extra input. Omitting `skip-token-revoke` retains the pinned action's default-false behavior: after minting it saves the token for its registered post-job revoker, which supplies a later revocation attempt if runner-processed cancellation or interruption prevents the authority phase from completing. Require its numeric `installation-id` output equals `${{ vars.BACI_CWV_RUNNER_AUDITOR_INSTALLATION_ID }}` and its app-slug output equals `baci-cwv-runner-auditor`; pass only its masked installation-token output in one named environment variable to the fixed policy-bound action Node authority phase. That phase writes its private effective-token evidence mode `0600` UID/GID `10001`, requires a complete paginated `GET /installation/repositories` result with exactly `ogabasseyy/Baci`, requires successful runner-inventory, repository-retention, and named-ruleset reads, then calls `DELETE /installation/token`, accepts only `204`, and makes one bounded metadata request with the same held buffer that must return `401`. It does not call a JWT-only App-installation endpoint or claim an App-wide permission, installation, or webhook proof. A `finally` block overwrites the buffer and removes the environment key before any host-attestation read; no request may use it afterward. This early verified revocation remains mandatory on the normal path. The pinned post hook catches a later already-revoked-token response and reports a warning instead of failing the job, so the fallback is compatible with successful early revocation. Then read `/host-evidence/live-sample.json` privately and require matching lease plus freshness `<=15` seconds; run policy/idle/authority verification; construct the exact one-file public projection with the closed schema above into a separate empty projection directory; upload only `h0-runner-attestation.json` with the pinned upload action configured with explicit `retention-days: 90`; retain its artifact id/digest outputs only in the private in-job receipt. Before any download, use the built-in job token's `actions:read` permission to read the one exact run-scoped artifact metadata row, require its id/name/digest equal the upload outputs, and require `expires_at-created_at` is within the closed window `[90 days - 5 minutes, 90 days + 5 minutes]`; retain raw timestamps only in the private authority file while projecting only `artifactLifetimeSeconds`. Only then invoke the pinned download action with exactly that response-validated artifact id/name and a fresh empty directory; reject archive/member/schema/canonical-byte drift and hash-verify the projected file in the same job. Write the secret-free receipt summary; then have the same repository-owned `actionNode` verifier overwrite/fsync/unlink its private files and remove its empty directories through `node:fs` without spawning a cleanup utility. Every workflow `run:` step is a fixed Bash `exec` of this policy-bound Node verifier; checkout alone may spawn the sealed `git` and `gitRemoteHttps` roles. The narrow window accommodates GitHub's observed few-second creation/expiry skew without accepting a lower retention class. Tests prove the exact App action inputs and outputs, the complete effective-token repository result, positive read-only API reads, early verified revocation, the sole allowed post-revocation `401` check, no token use after the `finally` wipe, mandatory native post-revoker registration, and compatibility with its warning-only already-revoked path; exact 90 days and observed 4-second/other in-window skew pass, while anything below the lower bound or above the upper bound refuses. They also prove the unprivileged job can create/read/remove temporary files, other UIDs cannot, no file includes authorization headers or token values, no external cleanup process is spawned, raw authority files cannot be selected by the upload action, and nothing writes a root-only mount. The workflow's only permissions are `actions:read` and `contents:read`; tests reject all Actions mutations and every other write scope.

**Task 6 endpoint limitation (normative):** `actions/create-github-app-token` yields an installation access token, not a JWT. GitHub documents `GET /repos/{owner}/{repo}/installation` as JWT-only and unavailable to installation access tokens ([GitHub Docs](https://docs.github.com/en/rest/apps/apps#get-a-repository-installation-for-the-authenticated-app)). The preceding effective-token receipt is therefore the complete runtime proof; it must not infer an App-wide installation or permission map, or claim a live webhook proof. The exact registration permission shape and webhook-disabled state remain Task 7 owner-visible/manual sealed-provisioning evidence.

The pinned upload action's `artifact-id` and `artifact-digest` outputs are both required. Keep both only in the private in-job receipt and require the in-job exact artifact metadata read to return the same id/name/digest before the in-job download; a missing/unsupported/malformed digest rejects. Those private action outputs are deliberately not exported to the owner. For external readback, the authenticated owner state instead binds the one exact run/attempt-scoped artifact API row's response-derived id/name/digest/expiry before the credential-free 302 request, hashes the downloaded archive against that API metadata digest, then requires the archive contains exactly one canonical `h0-runner-attestation.json` member whose bytes pass the closed public schema. Run/attempt/name uniqueness plus digest equality are the cross-boundary authority; no inaccessible private receipt is required and no second manifest member is added to the public artifact. Tests reject a missing/malformed API digest, duplicate name, wrong run/attempt, metadata replay, response drift, or archive/member digest mismatch.

Add `baci-cwv-measurement` to `.github/actionlint.yaml`. Update actionlint paths to include `.github/actionlint.yaml`, and update only the human guidance text to list the new label. Add `infra/cwv-runner/**` to the `web` filter in `.github/workflows/deploy.yml`; do not alter the deploy job, runner, permissions, environment, prebuilt build/deploy commands, concurrency, or migration dependency. The contract test proves an infrastructure-only PR A merge selects `deploy-production` through this exact filter and that the existing pipeline still ends with `vercel deploy --prebuilt --prod`.

Implement `owner-dispatch.sh`, `owner-api-transport.mjs`, the root-owned controller, hook, and Task 2/5 mount/environment wiring exactly as specified above. The owner dispatcher refuses any GitHub CLI/owner-Node checksum-manifest/archive/binary/version, final source/runtime/transport/state receipt, operation, target, or REST payload/response outside the frozen contract; removes its complete temporary verified tool/state tree on every terminal path; never uses `gh --paginate`; and never logs a token, Authorization header, signed redirect query, or response URL query. The controller must install an unconditional `trap`/`finally` before starting the runner; the root watchdog independently stops it and restores the campaign if the controller dies. Tests exercise local TLS/fake GitHub/run context and fake service commands only; they never read the owner's real GitHub authentication or expose a registration/Actions/API token.

- [ ] **Step 4: Run GREEN**

```bash
node --test .github/scripts/cwv-runner-authority.test.mjs .github/scripts/cwv-runner-contract.test.mjs infra/cwv-runner/exact-run-guard.test.mjs
node --test infra/cwv-runner/verify-owner-cli.test.mjs infra/cwv-runner/task9-bootstrap.test.mjs infra/cwv-runner/owner-api-transport.test.mjs
actionlint -config-file .github/actionlint.yaml .github/workflows/cwv-runner-attestation.yml .github/workflows/actionlint.yml .github/workflows/deploy.yml
pnpm exec biome check .github/scripts/cwv-runner-*.mjs
shellcheck infra/cwv-runner/owner-dispatch.sh infra/cwv-runner/verify-owner-cli.sh
/bin/sh -n infra/cwv-runner/verify-owner-cli.sh
git diff --check
```

Expected: all tests and static checks pass.

- [ ] **Historical Step 5 seed — do not execute: commit GitHub authority files**

> **Non-executable historical block.** The cumulative Task 1-6 integration rule supersedes this per-task CodeRabbit, `git add`, and `git commit` example. Use it only to understand the original design boundary; stage and commit only the final manifest-driven integration set.

```text
Historical boundary only: repository authority, offline workflow, owner transport, exact-run control, image entrypoint, service wiring, and their contracts formed the GitHub-authority unit. No review, staging, or commit command from the superseded per-task procedure is retained.
```

---

### Task 7: Provision the minimum GitHub App and immutable tag ruleset

Before any provisioning mutation, set `PR_A_REVIEWED_HEAD_SHA` to the exact independently reviewed implementation head and create one owner-only local `freeze-preflight`/`verify-preflight` transaction from exact Git object bytes. Preserve its canonical `preflight-v1` manifest, manifest digest, source archive, and archive digest as the immutable Task 7 review receipt; an independent read-only check must confirm the exact reviewed-head/base/PR identity and the three authority members below. This adds one narrow pre-merge authorization purpose to `preflight-v1`: on the development Mac only, it may authorize the exact copied owner tools and policy for Task 7 App/ruleset provisioning, with `owner-dispatch.sh` restricted to `--prepare-cli` and the sealed CLI restricted to the enumerated provisioning commands. It cannot authorize normal owner dispatch, workflow execution, a VPS command, or any Task 8/post-merge mode. Task 7 consumes only that reviewed preflight manifest. Task 8 Step 3a must reuse these exact four preserved bytes for the root-sealed scan and may not refreeze or substitute them. The preflight receipt still cannot authorize final bootstrap, build, prepare, registration, exact-run dispatch, or any other post-merge operation.

**External state:** GitHub App, repository variables/secrets, repository ruleset, permanent probe refs.

**Interfaces:**
- Variables: `BACI_CWV_RUNNER_AUDITOR_APP_ID`, `BACI_CWV_RUNNER_AUDITOR_CLIENT_ID`, `BACI_CWV_RUNNER_AUDITOR_INSTALLATION_ID`, `H0_RUNNER_RULESET_ID`, `H0_RUNNER_RULESET_SHA256`.
- Secret: `BACI_CWV_RUNNER_AUDITOR_PRIVATE_KEY` only.
- App slug: `baci-cwv-runner-auditor`; install only on `ogabasseyy/Baci`.

- [ ] **Step 1: Create the GitHub App with the exact minimum permission set**

In GitHub App settings create `BACI CWV Runner Auditor` with webhook disabled, repository `Administration: Read-only`, implicit `Metadata: Read-only`, and every other repository/organization/account permission—including `Actions`—set to `No access`. Install it only on `ogabasseyy/Baci`. This exact shape follows the normative H0-RUNNER contract: Administration-read authorizes repository runner inventory and the artifact/log retention setting; the App never retrieves an artifact. Artifact upload/readback uses the job-scoped built-in token with `actions:read`, and owner-side run coordination uses the owner's existing local session.

Generate one private key and immediately store it with the following explicitly Bash-owned procedure. Before entry, set `PREFLIGHT_POLICY_FILE_SHA256` only to the `infra/cwv-runner/policy.json` raw `blobSha256` from the already independently verified immutable Task 7 `preflight-v1` source manifest/receipt; never derive it from checkout bytes or reserialize the policy. That raw-file authority deliberately preserves the exact reviewed formatting and final newline, while `policyCanonicalSha256` remains the separately named semantic digest. The implementation contract test extracts this here-document body, runs `/bin/bash -n`, and runs ShellCheck with the repository's pinned configuration; invoking the body through zsh/sh or leaving any Bash-specific indirect expansion unparsed is a failure:

```bash
/bin/bash <<'BACI_CWV_TASK7'
set -euo pipefail
umask 077
test -d /private/tmp && test ! -L /private/tmp
test "$(/usr/bin/stat -f '%Su:%Sg:%Lp' /private/tmp)" = "root:wheel:1777"
key_dir=$(/usr/bin/mktemp -d /private/tmp/baci-cwv-app-key.XXXXXX)
cleanup_key() {
  /bin/rm -rf -- "$key_dir"
}
trap cleanup_key EXIT HUP INT TERM
/bin/chmod 0700 "$key_dir"
test "$(/usr/bin/stat -f '%Lp' "$key_dir")" = 700
test "$(/usr/bin/stat -f '%Su' "$key_dir")" = "$(/usr/bin/id -un)"
for digest_name in OWNER_SOURCE_MANIFEST_SHA256 OWNER_DISPATCH_FILE_SHA256 OWNER_CLI_VERIFIER_FILE_SHA256 PREFLIGHT_POLICY_FILE_SHA256; do
  digest_value=${!digest_name-}
  case "$digest_value" in (*[!0-9a-f]*|'') exit 1;; esac
  test "${#digest_value}" = 64
done
/bin/cp -p -- "$EXACT_REVIEWED_SOURCE_MANIFEST" "$key_dir/source-manifest.json"
test -f "$key_dir/source-manifest.json" && test ! -L "$key_dir/source-manifest.json"
test "$(/usr/bin/shasum -a 256 "$key_dir/source-manifest.json" | /usr/bin/awk '{print $1}')" = "$OWNER_SOURCE_MANIFEST_SHA256"
/bin/chmod 0400 "$key_dir/source-manifest.json"
OWNER_SEALED_SOURCE_MANIFEST="$key_dir/source-manifest.json"
/bin/cp -p -- "$EXACT_REVIEWED_CHECKOUT/infra/cwv-runner/verify-owner-cli.sh" "$key_dir/verify-owner-cli.sh"
test -f "$key_dir/verify-owner-cli.sh" && test ! -L "$key_dir/verify-owner-cli.sh"
test "$(/usr/bin/shasum -a 256 "$key_dir/verify-owner-cli.sh" | /usr/bin/awk '{print $1}')" = "$OWNER_CLI_VERIFIER_FILE_SHA256"
/bin/chmod 0500 "$key_dir/verify-owner-cli.sh"
OWNER_SEALED_CLI_VERIFIER="$key_dir/verify-owner-cli.sh"
/bin/cp -p -- "$EXACT_REVIEWED_CHECKOUT/infra/cwv-runner/owner-dispatch.sh" "$key_dir/owner-dispatch.sh"
test -f "$key_dir/owner-dispatch.sh" && test ! -L "$key_dir/owner-dispatch.sh"
test "$(/usr/bin/shasum -a 256 "$key_dir/owner-dispatch.sh" | /usr/bin/awk '{print $1}')" = "$OWNER_DISPATCH_FILE_SHA256"
/bin/chmod 0500 "$key_dir/owner-dispatch.sh"
OWNER_SEALED_DISPATCHER="$key_dir/owner-dispatch.sh"
/bin/cp -p -- "$EXACT_REVIEWED_CHECKOUT/infra/cwv-runner/policy.json" "$key_dir/policy.json"
test -f "$key_dir/policy.json" && test ! -L "$key_dir/policy.json"
test "$(/usr/bin/shasum -a 256 "$key_dir/policy.json" | /usr/bin/awk '{print $1}')" = "$PREFLIGHT_POLICY_FILE_SHA256"
EXACT_REVIEWED_POLICY="$key_dir/policy.json"
OWNER_SOURCE_AUTH_RECEIPT="$key_dir/source-authorization.json"
OWNER_SOURCE_AUTH_DIGEST="$key_dir/source-authorization.sha256"
"$OWNER_SEALED_CLI_VERIFIER" --verify-source \
  --manifest "$OWNER_SEALED_SOURCE_MANIFEST" \
  --manifest-sha256 "$OWNER_SOURCE_MANIFEST_SHA256" \
  --policy "$EXACT_REVIEWED_POLICY" \
  --dispatcher "$OWNER_SEALED_DISPATCHER" \
  --verifier "$OWNER_SEALED_CLI_VERIFIER" \
  --purpose task7-provisioning \
  --output-receipt "$OWNER_SOURCE_AUTH_RECEIPT" \
  --output-digest "$OWNER_SOURCE_AUTH_DIGEST"
# The reviewed generic downloader now writes the policy-selected checksum file
# and archive into this same directory; verification extracts the one CLI and
# atomically writes its canonical receipt before any private key exists.
OWNER_SEALED_GH_CHECKSUMS="$key_dir/gh-checksums.txt"
OWNER_SEALED_GH_ARCHIVE="$key_dir/gh.tar.gz"
OWNER_SEALED_GH_RECEIPT="$key_dir/gh-receipt.json"
"$OWNER_SEALED_DISPATCHER" --prepare-cli \
  --transaction-dir "$key_dir" --policy "$EXACT_REVIEWED_POLICY" \
  --source-authorization "$OWNER_SOURCE_AUTH_RECEIPT" \
  --source-authorization-sha256 "$OWNER_SOURCE_AUTH_DIGEST"
"$OWNER_SEALED_CLI_VERIFIER" --policy "$EXACT_REVIEWED_POLICY" \
  --checksum-file "$OWNER_SEALED_GH_CHECKSUMS" --archive "$OWNER_SEALED_GH_ARCHIVE" \
  --receipt "$OWNER_SEALED_GH_RECEIPT" \
  --source-authorization "$OWNER_SOURCE_AUTH_RECEIPT" \
  --source-authorization-sha256 "$OWNER_SOURCE_AUTH_DIGEST" \
  --purpose task7-provisioning --verify-only
key_path="$key_dir/private-key.pem"
/usr/bin/printf 'Save the newly generated GitHub App key directly to %s, then press Return.\n' "$key_path" >/dev/tty
IFS= read -r _ </dev/tty
test -f "$key_path" && test ! -L "$key_path"
/bin/chmod 0600 "$key_path"
test "$(/usr/bin/stat -f '%Lp' "$key_path")" = 600
test "$(/usr/bin/stat -f '%Su' "$key_path")" = "$(/usr/bin/id -un)"
/usr/bin/printf 'Enter the GitHub App ID: ' >/dev/tty
IFS= read -r auditor_app_id </dev/tty
/usr/bin/printf 'Enter the GitHub App client ID: ' >/dev/tty
IFS= read -r auditor_client_id </dev/tty
/usr/bin/printf 'Enter the GitHub App installation ID: ' >/dev/tty
IFS= read -r auditor_installation_id </dev/tty
/usr/bin/printf '%s\n' "$auditor_app_id" >"$key_dir/auditor-app-id"
/usr/bin/printf '%s\n' "$auditor_client_id" >"$key_dir/auditor-client-id"
/usr/bin/printf '%s\n' "$auditor_installation_id" >"$key_dir/auditor-installation-id"
for input_name in auditor-app-id auditor-client-id auditor-installation-id; do
  /bin/chmod 0400 "$key_dir/$input_name"
done
registration_path="$key_dir/auditor-app-registration.json"
"$OWNER_SEALED_CLI_VERIFIER" \
  --policy "$EXACT_REVIEWED_POLICY" \
  --checksum-file "$OWNER_SEALED_GH_CHECKSUMS" \
  --archive "$OWNER_SEALED_GH_ARCHIVE" \
  --receipt "$OWNER_SEALED_GH_RECEIPT" \
  --source-authorization "$OWNER_SOURCE_AUTH_RECEIPT" \
  --source-authorization-sha256 "$OWNER_SOURCE_AUTH_DIGEST" \
  --purpose task7-provisioning \
  --exec-gh-operation read-auditor-app-registration >"$registration_path"
/bin/chmod 0400 "$registration_path"
test "$(/usr/bin/stat -f '%Su:%Lp' "$registration_path")" = "$(/usr/bin/id -un):400"
test "$(/usr/bin/plutil -extract id raw -o - "$registration_path")" = "$auditor_app_id"
test "$(/usr/bin/plutil -extract client_id raw -o - "$registration_path")" = "$auditor_client_id"
test "$(/usr/bin/plutil -extract name raw -o - "$registration_path")" = 'BACI CWV Runner Auditor'
test "$(/usr/bin/plutil -extract slug raw -o - "$registration_path")" = baci-cwv-runner-auditor
test "$(/usr/bin/plutil -extract events json -o - "$registration_path")" = '[]'
test "$(/usr/bin/plutil -extract permissions xml1 -o - "$registration_path" | /usr/bin/xmllint --xpath 'count(/plist/dict/key)' -)" = 2
test "$(/usr/bin/plutil -extract permissions.administration raw -o - "$registration_path")" = read
test "$(/usr/bin/plutil -extract permissions.metadata raw -o - "$registration_path")" = read
registration_receipt_dir=$(/usr/bin/mktemp -d /private/tmp/baci-cwv-app-registration.XXXXXX)
/bin/chmod 0700 "$registration_receipt_dir"
test "$(/usr/bin/stat -f '%Su:%Lp' "$registration_receipt_dir")" = "$(/usr/bin/id -un):700"
for receipt_name in auditor-app-id auditor-client-id auditor-installation-id auditor-app-registration.json; do
  /bin/cp -p -- "$key_dir/$receipt_name" "$registration_receipt_dir/$receipt_name"
  /bin/chmod 0400 "$registration_receipt_dir/$receipt_name"
done
/usr/bin/shasum -a 256 "$registration_receipt_dir/auditor-app-registration.json" | /usr/bin/awk '{print $1}' >"$registration_receipt_dir/auditor-app-registration.sha256"
/bin/chmod 0400 "$registration_receipt_dir/auditor-app-registration.sha256"
test "$(/usr/bin/stat -f '%Su:%Lp' "$registration_receipt_dir/auditor-app-registration.json")" = "$(/usr/bin/id -un):400"
"$OWNER_SEALED_CLI_VERIFIER" \
  --policy "$EXACT_REVIEWED_POLICY" \
  --checksum-file "$OWNER_SEALED_GH_CHECKSUMS" \
  --archive "$OWNER_SEALED_GH_ARCHIVE" \
  --receipt "$OWNER_SEALED_GH_RECEIPT" \
  --source-authorization "$OWNER_SOURCE_AUTH_RECEIPT" \
  --source-authorization-sha256 "$OWNER_SOURCE_AUTH_DIGEST" \
  --purpose task7-provisioning \
  --exec-gh-operation set-auditor-private-key <"$key_path"
for operation in set-auditor-app-id set-auditor-client-id set-auditor-installation-id; do
  "$OWNER_SEALED_CLI_VERIFIER" \
    --policy "$EXACT_REVIEWED_POLICY" \
    --checksum-file "$OWNER_SEALED_GH_CHECKSUMS" \
    --archive "$OWNER_SEALED_GH_ARCHIVE" \
    --receipt "$OWNER_SEALED_GH_RECEIPT" \
    --source-authorization "$OWNER_SOURCE_AUTH_RECEIPT" \
    --source-authorization-sha256 "$OWNER_SOURCE_AUTH_DIGEST" \
    --purpose task7-provisioning \
    --exec-gh-operation "$operation"
done
/usr/bin/printf 'Preserved validated App registration receipt at %s\n' "$registration_receipt_dir" >/dev/tty
BACI_CWV_TASK7
```

`EXACT_REVIEWED_CHECKOUT` is the clean exact-head checkout from the fresh independent review. `EXACT_REVIEWED_SOURCE_MANIFEST` is exactly the preserved canonical `preflight-v1` manifest above, and it plus the three expected digests are copied literally from that review's immutable receipt, never derived from the checkout, `HEAD`, merge-base, environment defaults, or the files being authorized. The sealed verifier's `--verify-source` mode parses canonical manifest bytes, requires the supplied manifest raw digest, exact schema `preflight-v1`, and exact reviewed-head/base/PR identity, and requires `sourceArchive.entries` contain exact `100755` raw blob hashes for `owner-dispatch.sh` and `verify-owner-cli.sh` plus exact `100644` raw policy bytes; it also requires the manifest's `policyFileSha256`. It rejects a final-manifest schema, merge identity, alternate preflight, or path/member/hash substitution, then atomically emits a canonical source-authorization receipt plus raw digest containing exactly `schemaVersion`, `purpose:"task7-provisioning"`, preflight manifest digest/identity, policy/dispatcher/verifier hashes, creation transaction id, and the closed Task 7 operation set. No later verifier or dispatcher mode runs without immediately revalidating those receipt bytes, digest, purpose, parent ownership/mode, and exact source files. The copied scripts are separately rehashed with the same raw SHA-256 operation, not a Git object id; only `OWNER_SEALED_DISPATCHER` may run `--prepare-cli`, and it is a self-contained fixed-tool script whose static contract rejects imports or helper execution from the checkout. The reviewed generic downloader runs at the marked point and can write only the policy-selected checksum/archive children shown; it receives no private key, and the sealed verifier refuses before key generation unless the exact source, policy, and CLI receipts pass. `--exec-gh-operation` then revalidates immediately before `exec`: source-authorization receipt/digest/purpose, preflight-manifest and both script digests, verifier file/receipt digest, parent ownership/mode, exact regular nonsymlink CLI path/inode/mode/owner, archive and binary SHA-256, and exact version bytes. It constructs argv internally from the closed Task 7 operation enum and replaces itself with only that binary and fixed argv, so key stdin cannot reach a caller-selected executable or endpoint. Environment/path substitution, post-receipt replacement, a stale receipt, or a second executable refuses. The fixed `/private/tmp` root must be the validated local unsynchronized root shown above; `${TMPDIR}`, Downloads, Desktop, iCloud Drive, and other synchronized roots are forbidden. The explicit `/dev/tty` pauses collect the private key confirmation and the three public App identifiers while the same owner-only transaction is still alive. The parent remains owner-only mode `0700`; the key must be an owner-owned regular nonsymlink mode `0600` file. Before any GitHub mutation, the block authenticates with that local key, compares the returned App ID and client ID, exact name/slug, exact two-permission map, and empty event set, then copies the public readback, its digest, and the three entered identifiers into a separate owner-only receipt directory whose path is shown to the owner. Only after those checks pass does it upload the private-key secret and publish the variables. The unconditional trap then removes the complete key directory on success, failure, signal, or interruption without deleting the preserved public receipt. Never print key bytes or contents; the ephemeral key path is shown only on the owner's local terminal and is never persisted in a receipt or log. Tests and receipts record only the secret name and these permission/lifecycle predicates. List variable names only afterward; never print values or key bytes.

- [ ] **Step 2: Seal the owner-visible App registration and defer effective-token proof to Task 6**

The Step 1 transaction records the installation ID supplied by the owner from the GitHub UI but authenticates and validates the `/app` registration before publishing any secret or variable. `read-auditor-app-registration` mints and separately validates a short-lived RS256 JWT from the sealed inputs, passes it through an anonymous pipe to the revalidated pinned Node runtime under an empty environment, sends it with the required `Bearer` scheme, and fetches authenticated `GET /app` under independent inactivity and total wall-clock deadlines without placing the JWT in argv, environment, or disk or permitting a mint failure to fall through to the stored owner credential. The preserved receipt proves the returned App ID, client ID, name, slug, exact minimum permission map, and empty events before publication; installation selection and webhook-disabled state remain owner-visible/manual evidence because `/app` does not return them. This binds the private registration identity without widening installability; do not claim that the current `gh` user session can read an App installation or permissions. The owner-visible/manual sealed-provisioning evidence must show the exact minimum registration (`Administration: Read-only` plus implicit `Metadata: Read-only`, every other permission `No access`), installation only on `ogabasseyy/Baci`, and webhook disabled. This is registration evidence, not a live installation-token authority claim. Task 6 independently binds the owner-supplied installation ID to the pinned action's `installation-id` output and proves the effective token only through its complete `GET /installation/repositories` result, positive read-only runner/retention/ruleset reads, and revoke-then-`401` sequence. Do not call `GET /repos/{owner}/{repo}/installation` with the owner session or an installation token, do not use public data as negative authority evidence, and do not send a mutating permission probe.

Before creating the ruleset, use the finite owner operation to create and read back one annotated probe tag in each of the three exact namespaces listed in Step 4, all pointing to base `f706fc9f309516aa776515e094120039e2431d34`. Bind their object ids and target SHA into the Task 7 private transaction receipt. This is the only owner-controller probe-creation window; failure or ambiguity deletes only these exact receipt-owned probes before the ruleset exists and stops. After the ruleset becomes active the probes remain permanently as update/delete/duplicate-create controls. The absent creation rule means fresh unique rollout tags remain creatable before and after ruleset activation; this window limits only controller-owned probe creation, not ordinary unique-tag creation.

- [ ] **Step 3: Create the exact immutable tag ruleset**

POST this semantic shape to `repos/ogabasseyy/Baci/rulesets`:

```json
{
  "name": "ogabassey-rollout-progress-immutable",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": [
        "refs/tags/ogabassey-rollout-claim/*",
        "refs/tags/ogabassey-rollout-progress/**/*",
        "refs/tags/ogabassey-semantic-admission/*"
      ],
      "exclude": []
    }
  },
  "rules": [{"type": "update"}, {"type": "deletion"}]
}
```

Construct the request only from parsed `policy.ruleset`: `target`, `enforcement`, `tagIncludes`, `tagExcludes`, `rules`, and `bypassActors`; the JSON above is the exact expected rendering, not a second hardcoded source. Read it back, normalize exactly those semantic fields, require byte-equivalent semantics to the parsed policy, and store its id and canonical SHA-256 in repository variables. The rule array is exactly `update`, then `deletion`; no creation rule or bypass is allowed. Fresh unique tag creation remains allowed, while an existing retained probe refuses duplicate creation, update, force-update, and deletion. Task 1 schema/fixtures reject missing, extra, reordered, or changed target/enforcement/include/exclude/rule/bypass values, and Task 6/7 contract tests prove both request and API readback use policy values.

- [ ] **Step 4: Create and attack the permanent probes**

Create one annotated tag/ref in each namespace, pointing to exact base `f706fc9f309516aa776515e094120039e2431d34`:

```text
refs/tags/ogabassey-rollout-claim/h0-runner-ruleset-probe-v1
refs/tags/ogabassey-rollout-progress/h0-runner-ruleset-probe-v1/start
refs/tags/ogabassey-semantic-admission/h0-runner-ruleset-probe-v1
```

Prove duplicate create, update, force-update, and delete fail for every permanent probe. A fresh unique tag creation remains allowed because the creation rule is intentionally absent; do not create a second post-ruleset probe merely to demonstrate it, because that probe would become permanently retained. Semantic readback and contract fixtures prove the absent creation rule. Leave only the three pre-ruleset probes permanently. Prove the namespace helper rejects a ref outside its owned prefix before making an API call.

- [ ] **Step 5: Verify artifact retention**

Read repository artifact/log retention and require `days == 90` and `maximum_allowed_days >= 90`; the repository ceiling may be higher but must never shorten the requested retention. Require the workflow upload configuration also says `retention-days: 90`; after the sole artifact is uploaded, require its raw `created_at`/`expires_at` metadata falls within `[90 days - 5 minutes, 90 days + 5 minutes]`. Record the endpoint response and raw timestamps only in the private owner/controller receipt, without authorization headers; the public artifact projects only repository/workflow retention days, maximum allowed days, derived `artifactLifetimeSeconds`, and approved digests. A few seconds of GitHub timestamp skew is accepted only inside that frozen window; a lower retention class or any other mismatch is a hard refusal, not a fallback to the normative 30-day minimum.

---

### Task 8: Apply Ollama retirement and install/register the runner on the VPS

**External state:** `ogabassey` VPS services, Docker image/container, one GitHub runner registration.

**Interfaces:**
- One runner name `baci-cwv-measurement-01` with defaults plus `baci-cwv-measurement`.
- One service `baci-cwv-measurement.service`, disabled/offline by default and startable only by the selected repository-authority controller while an acquired campaign lease and exact allow record exist.

- [ ] **Step 0: Freeze the owner-visible root bootstrap checkpoint**

Freeze two exact owner-visible commands: (1) the fixed-tool root seal primitive that copies `seal-source.sh` into a new root-owned directory, verifies its exact reviewed raw file SHA-256 after the copy, and only then invokes that root-owned copy; and (2) the later sealed-tree `install.sh --bootstrap-control` command, expected prior-state capture, rollback/repair command, and secret-free receipt schema. Neither command executes a repository script from `/home/bassey`, stdin, PATH, or another user-writable path. Do not execute final bootstrap yet: the owner-visible interactive SSH checkpoint occurs only after Step 3a has produced, copied, and hash-verified the final `PR_A_MERGE_SHA` payload. The agent may provide and hash the command/script, but never asks for or handles the sudo password. The bootstrap may install only the locked account, immutable empty skeleton, reviewed state controller/watchdog and disabled units, rendered exact-SHA units, root-owned source, directory ownership, and the narrowly scoped controller; it starts no daemon and creates no import bytes, network, rule, or container. Seal/bootstrap kill/reboot fixtures must already prove an interrupted operation converges before prepare is eligible.

- [ ] **Step 1: Reconfirm no deployment or browser lane is active**

Query GitHub Actions and the VPS. Require no running deploy, SEO, PSI, Lighthouse, DebugBear, or other browser job; no `Runner.Worker`; and no local browser process. Stop if any appears. Record that deployment `29733124902` attempt `2` is successful for exact `f706fc9f309516aa776515e094120039e2431d34` and marker `29733124902_2_f706fc9f309516aa7765`.

- [ ] **Step 2: Copy and verify the exact reviewed installer payload**

Set `PR_A_REVIEWED_HEAD_SHA=$(git rev-parse HEAD)`, require it to equal the independently reviewed implementation head, and reread the exact four Task 7 `preflight-v1` manifest/digest/archive bytes; run `verify-preflight` again but never refreeze or substitute them. Copy only `seal-source.sh`, that preserved preflight manifest/digest, and its exact source archive/digest to neutral owner-only staging `/home/bassey/.cache/baci-cwv-bootstrap/$PR_A_REVIEWED_HEAD_SHA/` under a `0700 bassey:bassey` parent. Compare every file digest locally/remotely. In the owner-visible session run the frozen fixed-tool root seal primitive with the exact literal reviewed raw file SHA-256 of the `seal-source.sh` Git object contents; it root-copies and verifies the helper before execution, then the helper root-copies/verifies/extracts the preflight archive into `/var/lib/baci-cwv/preflight-source/$PR_A_REVIEWED_HEAD_SHA/`. Every repository command in this pre-merge payload executes only from that sealed root-owned tree and is read-only/limited to inventory scan; `--bootstrap-control`, retirement apply, prepare, registration, and every daemon start are forbidden. Do not create `/srv/baci-cwv`, and do not copy `.git`, `.env`, repository credentials, Supabase markers, or workspace state.

- [ ] **Step 3a: Run the privileged Ollama inventory scan and stop**

```bash
PR_A_REVIEWED_HEAD_SHA=$(git rev-parse HEAD)
test -n "$PR_A_REVIEWED_HEAD_SHA"
test -x infra/cwv-runner/vps-ssh.sh
infra/cwv-runner/vps-ssh.sh --tty -- "sudo /var/lib/baci-cwv/preflight-source/$PR_A_REVIEWED_HEAD_SHA/retire-ollama.sh --scan"
```

Expected: no mutation. The scan includes root-only hashes/dispositions for `baci-quiz-limits.conf`, `ekaette-bridge.conf`, referenced EnvironmentFiles, proxy/Compose/container/process records, the service/timer/model store, and both exact cron entries. Copy only its secret-free canonical receipt back to the worktree; prove it contains no raw values, then root deletes the sealed preflight tree and its neutral staging and proves both absent. Update `ollama-active-inventory.json` on the still-open infrastructure branch, run its tests, commit/push normally to the same PR A, and obtain a fresh exact-head independent review. Before merge, freeze `PR_A_NUMBER`, exact reviewed `PR_A_HEAD_SHA`, exact base-repository/main SHA, and a sorted NUL-safe manifest for every PR changed path containing status plus blob SHA-256 (or an explicit absent/deleted marker). Require the live PR is current with base, conflict-free, and still at `PR_A_HEAD_SHA`. When PR A is CLEAN with required checks green, merge it using the repository's enabled normal method and read `PR_A_MERGE_SHA` from GitHub's `mergeCommit.oid`; require merged state, the expected base repository/branch, a 40-lowercase-hex merge SHA, and that GitHub still reports the frozen reviewed head. Fetch `PR_A_MERGE_SHA`, require it is reachable from fresh `origin/main`, and compare the complete changed-path manifest at the merge tree against the frozen reviewed-head manifest byte-for-byte, including deletions. This proof is deliberately ancestry-independent because Baci permits squash/rebase but not merge commits. Any missing, extra, or changed path/blob stops. Wait for the automatic deployment/coherence run to succeed on exactly `PR_A_MERGE_SHA`; never deploy manually.

In one disposable exact-`PR_A_MERGE_SHA` checkout and one owner-created mode-`0700` temporary directory, run `source-manifest.mjs freeze` and immediately `source-manifest.mjs verify` with the frozen PR number, reviewed head, base, merge SHA, policy, deployment receipt, final manifest/digest, and source archive/digest. Preserve those exact four output files for the later sole image build; never refreeze a second manifest/archive for this merge. Copy only `seal-source.sh` plus those four files to neutral owner-only staging `/home/bassey/.cache/baci-cwv-bootstrap/$PR_A_MERGE_SHA/` and compare every digest locally/remotely while keeping `/srv/baci-cwv` absent. In the owner-visible session invoke the same frozen fixed-tool root seal primitive with the exact merged raw file SHA-256 of the `seal-source.sh` Git object contents; it verifies the root copy with the same raw hash before execution, and that helper atomically publishes the immutable root-owned `/srv/baci-cwv/source/$PR_A_MERGE_SHA/` tree and `/srv/baci-cwv/source-receipts/$PR_A_MERGE_SHA/`. Only then invoke `/srv/baci-cwv/source/$PR_A_MERGE_SHA/install.sh --bootstrap-control --source-sha "$PR_A_MERGE_SHA" --source-manifest "/srv/baci-cwv/source-receipts/$PR_A_MERGE_SHA/manifest.json" --source-manifest-sha256 "/srv/baci-cwv/source-receipts/$PR_A_MERGE_SHA/manifest.sha256"`. Require its durable capture/journal/receipt to bind the seal-helper receipt, `PR_A_MERGE_SHA`, exact source archive/manifest digests, final policy digest, rendered exact-SHA units, and every installed source/bootstrap-controlled blob, mode, unit, config, and controller hash; retain the PR number, reviewed head, merge SHA, base SHA, deployment receipt, and staging-manifest digest in that root-only receipt. In the same maintenance checkpoint perform the reviewed no-daemon repair drill and prove exact disabled units/hashes and empty skeleton, no incomplete seal/bootstrap receipt, no active daemon/socket/import/network/rule/container, and no `NOPASSWD:ALL`, general shell, arbitrary path, arbitrary systemctl, or arbitrary Docker capability. Delete final neutral staging only after the immutable source tree and complete bootstrap receipt are durable and independently reread/hash-verified. Do not apply retirement or prepare before this final-source bootstrap receipt, the exact merged/deployed source, the preserved manifest/archive, and the live scan all match.

After the sole image build has verified those same four final outputs, use the immutable merged/deployed source and its already authorized fixed-tool `owner-dispatch.sh --prepare-task9-bootstrap-node` path in a sanitized no-auth environment to download and verify only the policy-pinned Darwin arm64 Node archive plus its hash-pinned, signature-verified checksum chain; this preparation cannot read GitHub authentication, dispatch, or contact an unapproved origin. Then use only checked-in production `task9-bootstrap-bundle.mjs` from that exact source as the composer for one fixed-layout owner-only post-merge Task 9 bootstrap bundle in a fresh unsynchronized `/private/tmp/baci-cwv-task9-bootstrap-<transaction-id>/`; no fixture helper, ad hoc script, or hand-authored JSON may compose production bytes. Its `payload/` contains exactly these seven named regular nonsymlink files: `manifest.json`, `manifest.sha256`, `source.tar`, `source.tar.sha256`, `task9-bootstrap.mjs`, `node`, and `node-provenance.json`. `manifest.json` and `source.tar` remain byte-identical to the once-frozen final outputs and retain their exact recorded raw SHA-256 values. `source-manifest.mjs` remains the sole producer of the preserved bare receipt bytes `<digest>\n`; the bundle composer validates those bare lines and derives the payload-only detached filename records `<manifest-digest>  manifest.json\n` and `<archive-digest>  source.tar\n` without changing either source byte stream or hash value. The last three payload files are the exact merge-tree verifier, just-authorized Darwin Node executable, and canonical signed-checksum-chain provenance receipt. Outside `payload/`, the composer creates detached canonical schema-v1 `bootstrap-review-envelope.json`, whose path-sorted member manifest hashes only those seven payload files, plus `bootstrap-review-envelope.sha256` containing exactly the envelope's one lowercase raw hash line. The envelope and digest never appear in their own payload manifest. The envelope binds only its closed schema-accepted fields: the random logical `bundleId` rather than an absolute path; frozen PR/reviewed-head/base/merge/deployment and exact-run identity; every payload member's logical name/type/mode/raw SHA-256; runtime hashes/version; policy and transport bindings; and the source manifest/archive digests. The complete Node checksum/signature/key identity stays in canonical `node-provenance.json` and is validated against policy; exact ustar schema/version/limit/member rules stay enforced by the hash-bound bootstrap parser/code; and the exact ten-operation set/digest stays enforced by the hash-bound bootstrap/transport code and is emitted in `source-authorization.json`. None is added as an undeclared envelope field. The envelope contains no token, key, URL query, environment value, or checkout path. A fresh independent read-only post-generation review must run the hostile bootstrap fixtures against these actual bytes, recompute every hash and identity from the merged/deployed tree and preserved outputs, require exactly the seven payload entries plus detached envelope/digest and no symlink, require the digest file equals the envelope hash, and publish owner-visible literal raw SHA-256/mode values for the envelope, `task9-bootstrap.mjs`, and Node executable plus the logical bundle id and sealed source path. This ceremony happens after the outputs exist; a pre-merge or exact-head code-review receipt cannot substitute. Seal the bundle read-only under its owner-only parent and preserve it unchanged through Task 9 bootstrap. The fixed first-stage Mac tools are exactly `/bin/mkdir`, `/bin/cp`, `/usr/bin/stat`, `/usr/bin/shasum`, `/bin/chmod`, and `/bin/rm`; tests bind their absolute paths and prove cleanup is confined to owner-created transaction directories. No JSON or archive parsing is assigned to those tools. Neither VPS copies, checkout bytes, nor a refreeze may substitute for the independently reviewed bundle.

 The sole production composer invocation above is the checked-in `task9-bootstrap-bundle-cli.mjs`, not the library-only `task9-bootstrap-bundle.mjs`. Invoke it only through `owner-dispatch.sh --compose-task9-bundle`, with reviewed policy, `task9-compose-bundle.sh` helper, launcher, and composer SHA-256 values supplied through `--reviewed-policy-sha256`, `--reviewed-helper-sha256`, `--reviewed-launcher-sha256`, and `--reviewed-composer-sha256`, followed by `--` and the complete closed flag set `--admission-id`, `--authority-receipt`, `--authority-receipt-sha256`, `--bundle-id`, `--cwd`, `--deployment-sha`, `--generation`, `--head-ref`, `--node`, `--node-archive`, `--node-provenance`, `--output-root`, `--pr-metadata`, `--pr-metadata-sha256`, `--reviewed-pr-metadata-sha256`, `--source-archive`, `--source-archive-sha256`, `--source-manifest`, `--source-manifest-sha256`, `--transaction-id`, and `--workflow-id`; direct invocation is invalid. The dispatcher prepares the policy-pinned GitHub CLI, hash-copies the independently reviewed composition helper and launcher, and the launcher holds and revalidates that executable while the metadata readers require an exactly merged `ogabasseyy/Baci:main` PR, exact merge commit, exact workflow, and successful exact-SHA deployment job.

Never directly execute `task9-bootstrap-bundle-launcher.mjs`. The reviewed owner dispatcher is the launcher trust anchor: it verifies and copies the reviewed launcher before Node loads it, then passes the reviewed CLI SHA-256, held policy-pinned GitHub executable, canonical checkout, and complete closed CLI vector. The launcher verifies the complete fixed composer-module closure and evaluates only immutable byte snapshots before invoking the CLI; any dependency, launcher, external executable, or invocation drift refuses.

The automatic deployment/coherence requirement above specifically means the existing Vercel pipeline must show a local or CI prebuilt build followed by the exact production handoff `vercel deploy --prebuilt --prod`. The successful deployment marker and coherence result must bind `PR_A_MERGE_SHA`; a Vercel cloud build or a successful run for any other SHA is not acceptable.

- [ ] **Step 3b: Apply the reviewed Ollama retirement**

```bash
test -n "$PR_A_MERGE_SHA"
test -x infra/cwv-runner/vps-ssh.sh
infra/cwv-runner/vps-ssh.sh --tty -- "sudo /srv/baci-cwv/source/$PR_A_MERGE_SHA/retire-ollama.sh --apply"
```

Expected: the live scan matches the newly frozen inventory exactly, and immediately before every stop/disable/container removal/model deletion the script revalidates the immutable receipt's unit/drop-in/EnvironmentFile hashes, container full id/config/image, production Docker socket/daemon identity, model-store real path/device/inode/mount/tree digest, cron hashes, and dependency set. Retirement accepts only pre-crontab hash `a57aee33c02252e61943639c292e96a695ee75a33d92f730fd1be830a67a747b`, service/timer/captured-loopback identity stop, the exact two cron entries are removed, post-crontab hash is exactly `603d5005ad4f7b7d8c535be7ac8b8379b69a83b550014a56b2dfa6bbdb51ba8f`, and the receipt records actual cgroup/host-memory and disk deltas. If any active dependency, crontab hash, endpoint classification/hash, unit/drop-in, EnvironmentFile, proxy, daemon/socket, container, model identity, or process differs, stop without touching the replacement or performing the next mutation.

- [ ] **Step 4: Build off-host, then prepare the host and import the image**

In the disposable exact-`PR_A_MERGE_SHA` development-Mac checkout, reread and verify the preserved manifest/digest created in Step 3a; do not freeze or substitute another manifest. Pass those exact bytes to the policy wrapper for the sole `linux/amd64` Docker archive and canonical receipt, verify the receipt locally against the same manifest/digest, then transfer only those two secret-free output files to one random host staging path outside the dedicated mutable roots. Run `/srv/baci-cwv/source/$PR_A_MERGE_SHA/install.sh --prepare --image-archive <staged-archive> --build-receipt <staged-receipt>`. Before executing it, reread the immutable source/bootstrap receipt and require the installed command blob/mode plus exact `PR_A_MERGE_SHA`, preserved source-manifest digest, final policy digest, and all installed bootstrap-controlled hashes. Before any transaction-owned create/move or daemon start, require the immutable prepare capture/receipt and independent prepare-mode watchdog to be fsynced, bound, active, and tested for installer-plus-supervisor death, SSH loss, and reboot at every import phase. Require no BuildKit/build/pull process on the VPS; successful no-egress live synthetic import/cancellation cleanup through only `/run/baci-cwv/docker.sock`; exact bounded `baci-cwv-docker.service`, `baci-cwv-containerd.service`, and client control slice with two-second attribution/supervision; exact receipt-owned containers removed through the live socket or captured container/shim scopes terminated on dead-daemon recovery; every dedicated cgroup/process empty; both dedicated daemons/sockets plus the exact network/bridge and prepare watchdog absent after reconciliation; unchanged production service/socket/root/bridge/network/firewall identities and application container id/state/health tuples; no tagged campaign rule during prepare; no unattributed or production content-store delta; exact receipt-bound image id/config digest retained only after fsynced `target-accepted`; failure-path partial target/import bytes purged only after process quiescence; Chrome/Node/pnpm/runner versions and hashes; locked account; disabled service; absent sealed runner identity before registration; empty import and registration staging; no token file; root free disk `>=30 GiB`; and available memory `>=6 GiB`.

Before `target-accepted`, run `direct-listener-conformance.mjs` through the dedicated daemon against the accepted image's exact hash-verified Linux `/opt/node/bin/node` `v24.18.0`, exact hash-verified `v2.335.1` Listener, and the two isolated local TLS protocol fixtures described in Task 2. The registration fixture receives one generated throwaway token through the exact read-only mount while its egress chain is default-drop and exercises ready receipt -> root namespace-unmount/delete -> Node `ENOENT` proof -> root revalidation/zero counters -> one-use pre-exec egress release -> real same-PID `process.execve` -> root transition verification -> direct `configure`; it proves the trusted Node makes no connection before release, its parent memory/process disappears at exec, buffer/error cleanup is complete, and immediate Listener traffic after exec succeeds without racing the gate. The normal fixture has no token mount, exercises argv exactly `run --once`, and proves `run --once --disableupdate` is not the accepted normal path. Neither fixture can resolve or reach GitHub or any external endpoint. Require the canonical pinned-version conformance receipt, independently rehash actual Node, Listener, and upstream launcher source bindings, verify every configure/run/normal/signal/real-exec-failure case, token inaccessibility before exec, zero pre-release counters, and zero surviving process, and bind its digest into the prepare/build acceptance receipt and later process map. A missing, synthetic-only, different-version, different-binary, incomplete matrix, retained token mount, pre-release packet, release replay/drift, exec failure without immediate default-drop/token/staging/process cleanup, helper/orphaned process, external-network attempt, or receipt mismatch removes the unaccepted target and restores; neither direct lifecycle is authorized by static source claims alone.

The shorter two-path `--prepare` example in Step 4 is descriptive shorthand and must never be executed. The sole exact prepare invocation includes both separately frozen local output digests: `/srv/baci-cwv/source/$PR_A_MERGE_SHA/install.sh --prepare --image-archive <staged-archive> --image-archive-sha256 "$LOCAL_IMAGE_ARCHIVE_SHA256" --build-receipt <staged-receipt> --build-receipt-sha256 "$LOCAL_BUILD_RECEIPT_SHA256"`. The owner workstation computes the two variables independently over the exact locally verified output files before transfer, validates them as lowercase 64-hex, records them in the owner-visible frozen command, and never recomputes them from host staging. Any staged-file swap, including a coherent pair, therefore refuses before parsing.

- [ ] **Step 5: Register with a short-lived token through tmpfs stdin**

Generate a short-lived repository runner registration token with the authenticated repository administrator. Pipe exactly one token line over SSH stdin to the exact `PR_A_MERGE_SHA` `install.sh --register-token-stdin` path; never interpolate it into the SSH or shell command and never pre-create a remote token file. Prove no other UID-10001 process/container exists and require the installer's durable registration-mode watchdog/capture, exact dedicated daemons/IPv4-only network/isolation entries/chains, pre-read host-local/private/cross-network denial and public TLS proof, delayed tmpfs token creation, token hygiene, sealing, and full restore receipt described in Task 5. Unset the local token, invalidate it where the API permits, and prove the remote token, random staging child, registration/probe process, dedicated sockets/network/bridge/shared entries/owned chains, and shell-history occurrence are absent; both dedicated daemons and the normal service are disabled/offline, the retained image still matches its receipt, and production application/firewall/address/route tuples equal the pre-registration capture. Any cleanup ambiguity requires deleting the newly created GitHub runner row before retry; never leave it eligible.

- [ ] **Step 6: Prove singular online identity and reboot persistence**

Require exactly one API row named `baci-cwv-measurement-01` with `self-hosted`, `Linux`, `X64`, and `baci-cwv-measurement`; no other runner may carry the label. Under the personal-repository option it must be offline before and after its exact run. Reboot the VPS in an owner-visible maintenance checkpoint, then prove production Docker/containerd, application containers, existing application services, old non-measurement runners, cron service/crontab, and production firewall/address/route/bridge/network identities return unchanged; both dedicated daemon services and the measurement service remain disabled/inactive, their sockets/network/bridge/shared entries/owned chains are absent, and no unrestored prepare, registration, rehearsal, or campaign transaction/watchdog exists. Ollama and its watchdog must remain disabled/absent. The measurement runner id/name/generation/image/binary hashes must remain unchanged.

---

### Task 9: Prove the infrastructure refusal matrix and freeze the receipt

**Files:**
- Create: `docs/ops/cwv-measurement-runner.md`
- Create: `docs/ops/evidence/h0-runner-attestation.json`
- Create: `docs/ops/evidence/h0-runner-receipt.md`

**Interfaces:**
- Produces `H0_RUNNER_ATTESTATION_SHA256` for the later H0 plan.
- Produces operational commands for `acquire`, `verify-idle`, and `restore`; it produces no metric campaign command.

- [ ] **Step 1: Exercise every failure without making a storefront request**

In disposable fixture/API views or controlled service state, prove: offline runner, wrong/reused label, two-runner ambiguity, hosted runner rejection, concurrent job, missing lease, service restart, reboot persistence, Chrome/Node/runner/image checksum drift, egress/DNS/locale/timezone drift, CPU-set escape, load/PSI/steal/memory/disk/network refusal, missing/over-scoped App, disabled/drifted/bypassed ruleset, repository/workflow retention not exactly 90 days, uploaded-artifact expiry outside the 90-day ±5-minute window, blocked artifact egress, stale lease, partial quiescence rollback, and double restore. The network matrix must separately prove zero capabilities/no-new-privileges, rejection of bridge-gateway access, every host-local/public address, policy-denied special/private CIDRs, every captured production bridge/service subnet, alternate-interface or cross-network forwarding, spoofed IPv4 source, raw IPv6/link-local, AF_PACKET, MAC spoofing, and any IPv6 address/default route; it must also prove the interface-keyed first/final rejects are independent of claimed source, host-local external ingress is included in ambient ingress, host-originated external egress is included in ambient egress, neither can be subtracted as measurement, and exact cleanup occurs after failure at each owned-chain creation, population, shared-jump, NAT, accounting-chain, and counter insertion boundary. The immutable supply-chain matrix must reject a surviving default/live/PPA/vendor/deb-src APT source, noncanonical URI/suite/component/architecture/`Signed-By`, unsigned or wrong-key `InRelease`, mismatched referenced `Packages` hash, and package filename/version/architecture/SHA drift. The retirement matrix must mutate each reviewed service/drop-in/EnvironmentFile, Docker socket/daemon, container id/config/image, model path/device/inode/mount/tree, cron line, and dependency record before apply and between destructive steps, proving fail-closed identity revalidation and no name/path-based mutation of a replacement. Real destructive ruleset/App/host drift is not required when an exact fixture plus read-only current-state proof covers it.

For the retention fixture above, “repository/workflow retention not exactly 90 days” is the explicit predicate from Tasks 6 and 7: reject repository `days != 90`, repository `maximum_allowed_days < 90`, workflow `retention-days != 90`, or artifact expiry outside the 90-day ±5-minute window. A repository `maximum_allowed_days > 90` is valid and must have a positive fixture.

- [ ] **Step 2: Run one clean lease rehearsal without GitHub dispatch**

Before invoking acquisition, install the same unconditional controller restore trap used by a real campaign. Acquire a rehearsal lease with no external request from any CWV control, sampler, or probe process; production application containers remain network-active and are not subjected to a CWV destination allowlist, while their traffic remains part of ambient evidence. Do not run `--identity-host`, Cloudflare trace, RIPE RDAP, or GitHub metadata collection in this step; bind the separately pre-collected stable identity digest and run only `--live-local`. Verify all other runners and cron-owned jobs stop and application containers remain healthy on CPUs `0-1`, then invoke `install.sh --probe-isolation <campaign-id>` and keep that exact disposable probe alive throughout local sampling. The probe uses production cgroup/resource flags, Docker `NetworkMode=none`, the dedicated probe entrypoint, and no runner identity, credentials, hook, allow record, browser, or `Runner.Listener`; the rehearsal counter schema requires no runner veth/classification, measurement deltas zero/absent, and treats same-hook total external counters as ambient. Verify CPU/memory/swap/PID/read-only-root assertions, run local-only host idle and attestation collection, terminate the probe, then restore. Require exact post-retirement crontab bytes, runner states, timers, nftables prior state, cpusets, autoheal, and every captured prior state to return. This rehearsal receipt cannot authorize the real workflow and its lease id is never reused. A failed threshold yields no attestation and is diagnosed; do not relax policy.

- [ ] **Step 3: Confirm merged PR A and open the receipt branch**

Confirm Task 8 already merged PR A normally after its final inventory-aware exact-head review and that the automatic deployment/coherence run completed for exact `PR_A_MERGE_SHA`. Never manually deploy. Immediately before dispatch, fetch `origin/main` and set `H0_RUNNER_CONTROL_SHA` to that exact remote tip. The workflow uses `ref:"main"`, so dispatch is forbidden unless `origin/main`, the reviewed control SHA, and the successfully deployed/coherent release SHA are exactly equal. If `main` advanced for any reason, stop: prove whether the H0-RUNNER paths and frozen workflow bytes changed, obtain proportional exact-head review for the new tip, wait for its automatic exact-SHA deployment/coherence run, and only then replace `H0_RUNNER_CONTROL_SHA`. Infrastructure changes require the full relevant verifier/review gate; unrelated changes still require a lightweight exact-tip control receipt proving H0 bytes unchanged and deployment coherent. Create the receipt branch only from that exact control SHA. Never retain an older `expected_sha` while dispatching `ref:"main"`.

- [ ] **Step 4: Acquire a new lease and dispatch exactly one H0-RUNNER attestation workflow**

Before acquiring the lease, create a new random owner-only mode-`0700` Task 9 transaction directory under fixed unsynchronized `/private/tmp`; install an unconditional cleanup trap before copying anything. Bootstrap uses no checkout executable. From Task 8 Step 3a's independent post-generation bundle review, take the exact sealed source path, logical bundle id, and literal raw SHA-256/mode triples for `bootstrap-review-envelope.json`, `payload/task9-bootstrap.mjs`, and `payload/node`. With only fixed absolute macOS `/bin/mkdir`, `/bin/cp`, `/usr/bin/stat`, `/usr/bin/shasum`, `/bin/chmod`, `/bin/rm`, and shell built-ins, require the sealed source parent and each exact named source are owner-owned regular nonsymlink paths with the reviewed modes, create the fixed transaction layout, copy exactly the seven payload files plus detached envelope/digest to it, and compare the three trust-anchor raw hashes plus the envelope digest-file line to the independently published literals immediately before execution. Relocation is authorized only when the copied envelope's logical bundle id and complete payload manifest remain exact; no absolute source or destination path participates in envelope equality. No first-stage command parses JSON/tar, traverses a caller-selected path, reads a checkout/environment default, performs network, or accepts another executable. Invoke only the exact merged-source-manifest-bound `owner-dispatch.sh --bootstrap-task9` mode with the fixed transaction paths, reviewed envelope digest, and logical bundle id. The dispatcher copies `task9-bootstrap-runtime.mjs` into the transaction, makes it read-only, and revalidates its envelope-bound hash before executing it with the just-rehashed payload Node. That held runtime launcher revalidates the envelope, digest, payload files, Node identity, and its own inode/bytes, then invokes the self-contained `task9-bootstrap.mjs` from held bytes; direct execution of `task9-bootstrap.mjs` refuses. The verifier validates the canonical detached envelope and complete final manifest/archive projection, safely publishes the authorized source child, and atomically emits canonical `source-authorization.json` plus digest with purpose `task9-exact-run`, exact ten-operation set/digest, and transaction id. No repository `source-manifest.mjs`, transport, `gh`, GitHub credential, or dispatcher API-operation mode executes before this receipt exists; `owner-dispatch.sh` at this boundary is authorized only for the closed non-networking `--bootstrap-task9` path.

Use only the authorized source child atomically published by `task9-bootstrap.mjs`; require its complete path/type/mode/hash set and final tree digest from `source-authorization.json` before any member executes. Run the authorized dispatcher preparation mode to verify a fresh copy of the policy-pinned `gh` archive/checksum; reuse the already authorized pinned Darwin Node runtime and signed-chain receipt from the bootstrap bundle rather than downloading or trusting a second runtime. Emit and immediately revalidate the CLI/runtime receipts; then use only that same pinned Node to run the now-authorized `source-manifest.mjs verify` over the same final files as defense-in-depth before any GitHub token read. Rehash all sealed source/runtime bytes before each operation. Tests swap the bootstrap receipt, Node, bootstrap verifier, source manifest, and dispatcher before copy, between copy/hash, between hash/exec, and after receipt creation; every case refuses before the replaced file executes. They also prove an undeclared first-stage executable, dynamic `HEAD`/checkout source, missing post-generation review literal, second Node download, or incomplete archive projection fails closed.

Initialize `task9-state.json` atomically from exact repository id/name, workflow id/path/ref, `H0_RUNNER_CONTROL_SHA`, fresh admission id, final-manifest/source/runtime/transport/policy/operation-set digests, and state generation `0`; `queueStartedMonotonic` is absent. Write the raw state digest separately. Thereafter the only invocation shape is `owner-dispatch.sh --task9-operation <exact-enum> --state task9-state.json --state-sha256 task9-state.sha256 --source-authorization source-authorization.json --source-authorization-sha256 source-authorization.sha256`. The dispatcher accepts no run/page/job/artifact id or URL flag, immediately revalidates every receipt, starts the one-request token pipe, invokes only the sealed Darwin Node plus sealed transport, and atomically advances state from response-derived values according to this complete transition table:

| Operation | Required state | Exact request and accepted response | Atomic state delta / next state |
|---|---|---|---|
| `list-attestation-runs` | `READY`, generation 0, `DISPATCH_INTENT`, `DISPATCH_INDETERMINATE`, `QUEUED`, or `RUNNING` | `GET /repos/ogabasseyy/Baci/actions/workflows/cwv-runner-attestation.yml/runs?event=workflow_dispatch&per_page=100&page=1`; manual same-path canonical pagination; only `200` and closed workflow-run-list schema | Define active as exactly `queued | in_progress | requested | waiting | pending`. From `READY`, require no active run, bind full-page digest, generation +1 -> `QUIESCENT`. From either durable dispatch state, treat the POST as potentially accepted, perform only bounded internal polls of this same route, and reconcile the already durable admission id against exact repo/workflow/event/ref/head SHA/actor, `display_title == "CWV Runner Attestation <admission_id>"`, and creation at/after the intent receipt within its fixed window. Exactly one match binds run id/URLs/attempt `1` and starts the queue timer -> `QUEUED`; more than one -> terminal `MANUAL_RECONCILIATION`; no match by the bounded deadline -> terminal `MANUAL_RECONCILIATION`. Neither terminal outcome permits another dispatch. A process restart may normalize `DISPATCH_INTENT` to `DISPATCH_INDETERMINATE` only by atomically preserving the same intent/admission/request digest and adding a crash-recovery receipt; it can never infer that zero bytes were sent or return to `QUIESCENT`. From `QUEUED` or `RUNNING`, this is the mandatory post-dispatch pre-release reconciliation: complete exactly one paginated read, require exactly one active workflow row overall, require that row is the already state-bound run with unchanged admission/repository/workflow/ref/head-SHA/actor/attempt bindings, bind the complete reconciliation digest and current state generation, and leave the state unchanged. Any absent, duplicate, additional active, or binding-drift row invokes owner cancellation where possible, root no-start/restore, and terminal `MANUAL_RECONCILIATION`; release is forbidden. |
| `dispatch-exact-run` | `QUIESCENT` | Before any request byte, atomically fsync exact request/admission/state digest plus monotonic start as generation +1 -> `DISPATCH_INTENT`; then `POST /repos/ogabasseyy/Baci/actions/workflows/cwv-runner-attestation.yml/dispatches` with body exactly `{ref:"main",inputs:{admission_id}}`; only `200` closed run-details schema | A complete valid response binds run id/URLs/attempt `1`/created time and sets `queueStartedMonotonic` from that response receipt -> `QUEUED`. A definite pre-connect failure with proof zero request bytes left the process may terminally fail without dispatch. Any write/response timeout, EOF, connection reset, malformed/unknown response, or other ambiguous outcome atomically advances to `DISPATCH_INDETERMINATE`; it can invoke only `list-attestation-runs` reconciliation and can never return to `QUIESCENT` or send another POST. |
| `read-exact-run` | `QUEUED`, `RUNNING`, `RERUN_REQUESTED`, or `FAILED` | `GET /repos/ogabasseyy/Baci/actions/runs/{state.runId}` with no query; only `200` closed run schema and exact repo/workflow/ref/SHA/actor/admission binding | `requested`, `waiting`, `pending`, or `queued` advances to `QUEUED`; `in_progress` advances to `RUNNING`; completed success advances to `COMPLETED`; completed failure advances to `FAILED`; from `RERUN_REQUESTED`, require attempt exactly prior+1 before returning to `QUEUED` or `RUNNING`; canceled conclusion -> terminal `CANCELED` |
| `cancel-exact-run` | `QUEUED` or `RUNNING` | `POST /repos/ogabasseyy/Baci/actions/runs/{state.runId}/cancel`; empty body; only `202`, followed internally by bounded exact-run reads until canceled | Bind cancel receipt; generation +1 -> terminal `CANCELED`; no job/artifact operation is permitted afterward |
| `read-failed-job-evidence` | `FAILED`, `rerunUsed=false`, no existing failure receipt, and a previously authenticated root terminal-runtime/restore receipt bound to the same run/attempt/state generation | `GET /repos/ogabasseyy/Baci/actions/runs/{state.runId}/jobs?filter=latest&per_page=100&page=1`; bounded canonical pages; only `200` closed jobs-and-steps schema | `owner-api-transport.mjs` is the sole receipt producer. It requires exactly one `attest` job for the bound attempt and runner identity; exact frozen step names/numbers; no attestation/action step with nonnull `started_at`, `completed_at`, or conclusion; root evidence `listenerExitKind="transport-lost"`, `jobStartHookObserved=false`, `actionNodeObserved=false`, runner/daemons offline, and complete state-bound restore green; and no authority/label/ruleset/retention/supply-chain/source/runtime/host/sampler/isolation/credential/cleanup/artifact finding. Only that complete conjunction emits canonical `{schemaVersion:1,code:"RUNNER_TRANSPORT_LOST_BEFORE_ATTESTATION",runId,attempt,stateGeneration,runDigest,jobsDigest,rootRuntimeDigest,restoreDigest,createdAt}` and advances generation +1 -> `FAILED_EVIDENCE`. Missing/extra jobs or steps, any started attestation step, a conflicting root/GitHub fact, unknown/extra code/field, or missing evidence is terminal and emits no eligible receipt. No operator/caller field selects the code. |
| `rerun-failed-exact-run` | `FAILED_EVIDENCE`, `rerunUsed=false`, and the exact canonical `RUNNER_TRANSPORT_LOST_BEFORE_ATTESTATION` receipt above | `POST /repos/ogabasseyy/Baci/actions/runs/{state.runId}/rerun-failed-jobs`; empty body; only `201` | Revalidate every receipt predicate, then atomically set `rerunUsed=true`, expected attempt prior+1, clear the prior attempt's queue timer, set a new `queueStartedMonotonic` from the accepted `201` response receipt, bind that timer to expected attempt prior+1, and advance generation +1 -> `RERUN_REQUESTED`. An absent/unknown/multiple code, stale evidence, any failed prerequisite, or a second call rejects terminally without rerun. |
| `list-runner-inventory` | `QUEUED` or `RUNNING` | `GET /repos/ogabasseyy/Baci/actions/runners?per_page=100&page=1`; individual canonical pages only; only `200` closed runner-list schema | Bind challenge/hold plus complete unique inventory digest and expiry; generation +1, state unchanged; stale inventory cannot authorize release |
| `read-exact-job` | `COMPLETED` | `GET /repos/ogabasseyy/Baci/actions/runs/{state.runId}/jobs?filter=latest&per_page=100&page=1`; bounded canonical pages; only `200` closed jobs schema | Discover—not accept from argv—the sole `attest` job id; require success, expected runner id/name/labels; generation +1 -> `JOB_BOUND` |
| `list-exact-artifacts` | `JOB_BOUND` | `GET /repos/ogabasseyy/Baci/actions/runs/{state.runId}/artifacts?per_page=100&page=1`; bounded canonical pages; only `200` closed artifact-list schema | Require one exact run-scoped artifact name/id, nonexpired status, size cap, and `sha256:<64hex>` metadata digest; bind those response-derived fields into state without caller input; generation +1 -> `ARTIFACT_BOUND` |
| `download-exact-artifact` | `ARTIFACT_BOUND` | `GET /repos/ogabasseyy/Baci/actions/artifacts/{state.artifactId}/zip`; require the sole policy-bounded credential-free `302` flow above and exact archive/member verification | Bind archive/member digests; generation +1 -> `EVIDENCE_VERIFIED` |

The `QUEUED`/`RUNNING` form of `list-attestation-runs` is mandatory after every initial or rerun dispatch and immediately before any admission transfer, runner hold release, or listener start. It is not satisfied by the earlier `READY` preflight or by `read-exact-run`. Contract tests require the exact bound run as the sole row whose status is in `queued | in_progress | requested | waiting | pending`; independently exercise each of those five statuses; and reject zero matches, a second matching row, any unrelated row in any of the five active states, pagination omission/duplication, binding drift, a stale state generation/digest, release before reconciliation, and replay of an earlier reconciliation receipt.

Every method/path/query/body/status/schema not shown rejects. Pagination is internal to its operation and cannot change the state-bound route family. On successful external readback and proven host restore, atomically publish only the verified canonical JSON member plus one raw SHA-256 line and a secret-free terminal binding receipt into fixed owner-only `/private/tmp/baci-cwv-h0-evidence-<transaction-id>/`; fsync and re-read all three. Then close token pipes, zero buffers, remove response/archive/state/tool/source-authorization files and the Task 9 transaction directory, but retain this evidence handoff and the sealed Task 8 bootstrap bundle until Step 5 succeeds. Cleanup has three explicit branches: (1) failure before `source-authorization.json` is durably re-read removes only the new Task 9 transaction directory, preserves the sealed Task 8 bundle unchanged for forensic review, dispatches nothing, and requires owner direction before another attempt; (2) failure after source authorization but before `DISPATCH_INTENT` is durably fsynced removes the Task 9 transaction but preserves the sealed bundle and permits only a fresh locally reviewed transaction, never an external run duplicate; (3) any state at or after `DISPATCH_INTENT` is treated as potentially dispatched. Cancellation, exhausted same-run rerun, reconciled failure, or post-dispatch failure publishes no public evidence and may remove the sealed bundle only after the exact run is terminal or `MANUAL_RECONCILIATION` is durably recorded for owner handling, host restore/no-start is proven, and a durable secret-free failure receipt binds the source authorization, intent, reconciliation evidence, and cleanup. `MANUAL_RECONCILIATION` freezes the bundle/state and requires owner direction before deletion; it never authorizes another POST. The success branch removes the sealed bundle only after Step 5 has independently reread the repository evidence copy and digest. An allowed same-run rerun is not terminal. Tests reproduce every bootstrap/transition/cleanup branch, crashes immediately after intent fsync/before write/during write/after response-before-state, accepted-POST/lost-response followed by delayed run visibility, zero/one/two reconciliation matches, and reject missing/stale final outputs, preflight reuse, checkout-derived execution, wrong tool/runtime hash, any request before durable intent, retry from intent/indeterminate/manual state, premature queue timer, state rollback/skipped transition, post-cancel access, unbound job discovery, extra operation/flag/status/schema, missing handoff, premature preserved-bundle deletion, preserved-bundle leak after an eligible terminal branch, or incomplete cleanup.

After the exact `H0_RUNNER_CONTROL_SHA` automatic deployment is complete, acquire a new attestation lease and keep it held for the entire queued/running/readback interval. Re-fetch `origin/main` at the dispatch boundary and require it still equals `H0_RUNNER_CONTROL_SHA`. The owner-workstation dispatcher passes that SHA as `expected_sha`, uses the pinned `2026-03-10` REST dispatch and its mandatory returned run details, validates the exact run as specified in Task 6, and then invokes `list-attestation-runs` from `QUEUED`/`RUNNING` for the mandatory post-dispatch pre-release reconciliation. One complete paginated workflow read must contain the already bound run as the sole row in the exact active-status set `queued | in_progress | requested | waiting | pending`, with unchanged admission/repository/workflow/ref/SHA/actor/attempt fields; bind its digest and state generation before transferring the canonical admission document over SSH. Any absent/duplicate/additional active row or binding drift cancels where possible, keeps the listener unreleased, restores root state, and enters terminal `MANUAL_RECONCILIATION`. The root controller independently validates the admission plus reconciliation receipt, installs the allow record, arms the watchdog, then starts the one-job runner.

Start the owner-side monotonic queue timer at the successful dispatch response that returns the exact run identity and require elapsed queue time `<=repositoryAuthority.queueDeadlineSeconds`; independently start the root/container monotonic listener-hold timer only when the held container begins waiting for its release record and require it `<=repositoryAuthority.listenerHoldTimeoutSeconds`. These are separate timers and failure domains even though both frozen values are 120 seconds. Require total controller time `<=20 minutes`; otherwise the owner-side coordinator cancels while root stops/restores without producing evidence. Do not create another run.

The only eligible same-run recovery is the exact `RUNNER_TRANSPORT_LOST_BEFORE_ATTESTATION` receipt produced by `owner-api-transport.mjs` through `read-failed-job-evidence`; there is no generic GitHub-service or operator-selected recovery class. The producer must deterministically join the closed GitHub job/step evidence with the already authenticated root terminal-runtime and full cleanup/restore receipts as specified in the table, and state must be `FAILED_EVIDENCE` with `rerunUsed=false`. If and only if every predicate remains true, invoke `rerun-failed-exact-run` once on the same run id. The accepted `201` response is the sole authoritative rerun queue-timer start: atomically discard the prior attempt's timer, set `queueStartedMonotonic` from that response receipt, and bind it to expected attempt prior+1 before state becomes `RERUN_REQUESTED`. Then invoke `read-exact-run`, require and bind the incremented attempt while state is `RERUN_REQUESTED`, replace the root allow/admission binding with that exact attempt, repeat the post-dispatch pre-release reconciliation for that attempt, and only afterward start/hold/release the offline runner. An absent/unknown/multiple failure code or any unmet predicate is terminal and cannot be reclassified by operator judgment. Tests cover the sole allowed code, every required GitHub/root predicate, every excluded failure class one at a time, unknown/missing/multiple codes, a started attestation step, stale/failed restore, old-timer reuse, timer start before/after the `201` receipt, attempted second rerun, and predicate drift. Any failure in that order stops; no second rerun or second run id is permitted. The job must prove the selected runner is the sole API row carrying the dedicated label across all registered online/offline runners and is `busy:true`, upload and read back its one exact artifact id, and make no storefront request.

After root returns the bound hold receipt with its one-use inventory challenge, the owner dispatcher performs Task 6's complete paginated all-state runner read and immediately sends the challenge-bound canonical inventory receipt over the same authenticated controller channel. Root never queries GitHub: it verifies the receipt/hold/admission/challenge/count/page/label bindings, records receipt arrival on its own monotonic clock, publishes release before the root-local five-second deadline, and acknowledges; the owner cancels and root restores if acknowledgement is absent. Owner UTC fields remain audit-only and no cross-host monotonic comparison exists. The in-job auditor App independently repeats the complete all-state uniqueness check as its first authority operation and the uploaded evidence binds both pre-release and in-job inventory digests.

Install the controller's unconditional cleanup trap before calling campaign acquisition; acquisition itself cannot mutate until durable state is fsynced and the independent watchdog is verified active. On success, failure, cancellation, timeout, API error, lost SSH session, or artifact-readback failure, stop the runner first, delete the allow and inventory records, stop the sampler, remove the exact campaign accounting table, three shared isolation entries, and two owned chains, remove the exact dedicated network/bridge, stop both dedicated daemons, restore exact host/cron/cpuset/timer/container/firewall/address/route state, and verify the restore receipt. A root watchdog independently performs the same stop/restore after 30 minutes if the controller dies. Accept the artifact only after external readback confirms the runner and dedicated daemons are offline, the network/bridge/shared entries/owned chains are absent, and the restore receipt is valid; evidence from a run whose cleanup is unproven is rejected.

- [ ] **Step 5: Write canonical evidence and owner-approve the digest**

Read only the fixed owner-only evidence handoff published by Step 4. Revalidate its directory/file ownership/modes, terminal binding receipt, canonical JSON bytes, and raw SHA-256; require the binding matches the exact run/attempt/artifact metadata/archive/member/host-restore digests and `EVIDENCE_VERIFIED` terminal generation. Atomically copy those exact JSON bytes—never a reparsed/reserialized substitute—to `h0-runner-attestation.json`, fsync, and require it exactly matches the Task 6 public schema; the committed JSON adds no key. The Markdown receipt may quote only fields already present in that JSON plus static prose for shared-host residual risk and the no-measurement conclusion; it must not expose a private receipt or invent another result/digest. Full admission, inventory, host, and controller receipts stay outside Git and contribute only the exact digest keys already enumerated by Task 6. Schema/tests reject every other resource, process, environment, command-line, address, route, path, identifier, inventory field, failure result, or digest. After the repository copy and digest are independently re-read, remove the complete evidence handoff and sealed Task 8 post-merge bootstrap bundle and prove both plus the Task 9 transaction directory are absent. The repository owner approves the computed digest through the exact-head PR review/merge record.

- [ ] **Step 6: Run the Task 9 receipt gate**

```bash
/bin/bash <<'BACI_CWV_TASK9_RECEIPT_GATE'
set -euo pipefail
node --test --test-concurrency=1 infra/cwv-runner/*.test.mjs .github/scripts/cwv-runner-*.test.mjs
pnpm exec biome check infra/cwv-runner .github/scripts/cwv-runner-*.mjs
actionlint -config-file .github/actionlint.yaml .github/workflows/cwv-runner-attestation.yml .github/workflows/actionlint.yml .github/workflows/deploy.yml
pnpm turbo lint
pnpm turbo typecheck
pnpm --filter @baci/web typecheck:tools-workers
pnpm turbo test
/usr/bin/git diff --check
readonly BACI_CWV_PRIMARY_CHECKOUT="${BACI_CWV_PRIMARY_CHECKOUT:?set the pre-recorded primary checkout}"
readonly BACI_CWV_PRIMARY_HEAD_SHA="${BACI_CWV_PRIMARY_HEAD_SHA:?set the pre-recorded primary HEAD SHA}"
readonly BACI_CWV_PRIMARY_GIT_DIR="${BACI_CWV_PRIMARY_GIT_DIR:?set the pre-recorded absolute primary git-dir}"
readonly BACI_CWV_PRIMARY_GIT_COMMON_DIR="${BACI_CWV_PRIMARY_GIT_COMMON_DIR:?set the pre-recorded absolute primary git-common-dir}"
readonly BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256="${BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256:?set the pre-recorded primary root marker hash}"
readonly BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256="${BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256:?set the pre-recorded primary web marker hash}"
readonly BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256="${BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256:?set the pre-recorded Task 9 root marker hash}"
readonly BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256="${BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256:?set the pre-recorded Task 9 web marker hash}"
case "$BACI_CWV_PRIMARY_CHECKOUT" in (/*) ;; (*) exit 1;; esac
case "$BACI_CWV_PRIMARY_GIT_DIR" in (/*) ;; (*) exit 1;; esac
case "$BACI_CWV_PRIMARY_GIT_COMMON_DIR" in (/*) ;; (*) exit 1;; esac
case "$BACI_CWV_PRIMARY_HEAD_SHA" in (*[!0-9a-f]*|'') exit 1;; esac
test "${#BACI_CWV_PRIMARY_HEAD_SHA}" = 40
for digest in \
  "$BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256" \
  "$BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256" \
  "$BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256" \
  "$BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256"; do
  case "$digest" in (*[!0-9a-f]*|'') exit 1;; esac
  test "${#digest}" = 64
done
test -d "$BACI_CWV_PRIMARY_GIT_DIR" && test -d "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
test "$( ( cd -- "$BACI_CWV_PRIMARY_CHECKOUT"; /bin/pwd -P ) )" = "$BACI_CWV_PRIMARY_CHECKOUT"
test "$( ( cd -- "$BACI_CWV_PRIMARY_GIT_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_PRIMARY_GIT_DIR"
test "$( ( cd -- "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse --show-toplevel)" = "$BACI_CWV_PRIMARY_CHECKOUT"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse HEAD)" = "$BACI_CWV_PRIMARY_HEAD_SHA"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse --path-format=absolute --git-dir)" = "$BACI_CWV_PRIMARY_GIT_DIR"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse --path-format=absolute --git-common-dir)" = "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
BACI_CWV_TASK9_CHECKOUT="$(/usr/bin/git rev-parse --show-toplevel)"
readonly BACI_CWV_TASK9_CHECKOUT
test "$BACI_CWV_PRIMARY_CHECKOUT" != "$BACI_CWV_TASK9_CHECKOUT"
readonly BACI_CWV_TASK9_GIT_DIR="$(/usr/bin/git -C "$BACI_CWV_TASK9_CHECKOUT" rev-parse --path-format=absolute --git-dir)"
readonly BACI_CWV_TASK9_GIT_COMMON_DIR="$(/usr/bin/git -C "$BACI_CWV_TASK9_CHECKOUT" rev-parse --path-format=absolute --git-common-dir)"
test -d "$BACI_CWV_TASK9_GIT_DIR" && test -d "$BACI_CWV_TASK9_GIT_COMMON_DIR"
test "$( ( cd -- "$BACI_CWV_TASK9_CHECKOUT"; /bin/pwd -P ) )" = "$BACI_CWV_TASK9_CHECKOUT"
test "$( ( cd -- "$BACI_CWV_TASK9_GIT_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_TASK9_GIT_DIR"
test "$( ( cd -- "$BACI_CWV_TASK9_GIT_COMMON_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_TASK9_GIT_COMMON_DIR"
test "$BACI_CWV_TASK9_GIT_DIR" != "$BACI_CWV_PRIMARY_GIT_DIR"
test "$BACI_CWV_TASK9_GIT_COMMON_DIR" = "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
verify_cli_latest_marker() {
  checkout=$1
  path=$2
  expected=$3
  marker="$checkout/$path"
  test -f "$marker" && test ! -L "$marker"
  test "$(/usr/bin/shasum -a 256 -- "$marker" | /usr/bin/awk '{print $1}')" = "$expected"
  test -z "$(/usr/bin/git -C "$checkout" status --porcelain=v1 -- "$path")"
}
verify_cli_latest_marker "$BACI_CWV_PRIMARY_CHECKOUT" supabase/.temp/cli-latest "$BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256"
verify_cli_latest_marker "$BACI_CWV_PRIMARY_CHECKOUT" apps/web/supabase/.temp/cli-latest "$BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256"
verify_cli_latest_marker "$BACI_CWV_TASK9_CHECKOUT" supabase/.temp/cli-latest "$BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256"
verify_cli_latest_marker "$BACI_CWV_TASK9_CHECKOUT" apps/web/supabase/.temp/cli-latest "$BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256"
node <<'NODE'
const { execFileSync } = require('node:child_process');
const allowed = new Set([
  'docs/ops/cwv-measurement-runner.md',
  'docs/ops/evidence/h0-runner-attestation.json',
  'docs/ops/evidence/h0-runner-receipt.md',
]);
const raw = execFileSync('/usr/bin/git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
if (!raw.length || raw.at(-1) !== 0) process.exit(1);
const entries = raw.subarray(0, -1).toString('utf8').split('\0');
if (entries.length !== allowed.size) process.exit(1);
for (const entry of entries) {
  if (entry.length < 4 || entry[2] !== ' ') process.exit(1);
  const code = entry.slice(0, 2);
  const path = entry.slice(3);
  if ((code !== '??' && code !== ' M') || !allowed.delete(path)) process.exit(1);
}
if (allowed.size) process.exit(1);
NODE
BACI_CWV_TASK9_RECEIPT_GATE
```

Expected: all Task 9 receipt checks green; the complete unstaged working-tree delta is exactly the three receipt/runbook paths intended for the later source receipt manifest; both protected CLI marker paths equal their four separately pre-recorded 64-hex hashes and remain unstaged in both distinct checkouts. Any extra path, staged byte, missing intended path, marker drift, or dirty marker refuses. This is a Task 9 receipt-only gate, not a second or weaker Task 1-6 integration gate: it neither validates nor replaces `H0_IMPLEMENTATION_MANIFEST`. The authoritative Task 1-6 gate above remains required for the normal integration of existing H0 implementation work, including its test concurrency `1`, normal and tools-worker typechecks, protected-marker checks, and manifest-scoped source/test/runtime/workflow line-limit check. Task 9's separate `SOURCE_RECEIPT_MANIFEST` below is the only manifest used for its three receipt paths.

- [ ] **Step 7: Review, commit, and merge PR B containing only the receipt/runbook evidence**

Before staging, require the Task 9 receipt gate from Step 6, one clean non-overlapping uncommitted CodeRabbit review, and an independent read-only review limited to the exact three receipt paths. Generate the review manifest without touching the index:

```bash
/bin/bash <<'BACI_CWV_RECEIPT_REVIEW'
set -euo pipefail
/usr/bin/git diff --cached --quiet
RECEIPT_PATHS=(
  docs/ops/cwv-measurement-runner.md
  docs/ops/evidence/h0-runner-attestation.json
  docs/ops/evidence/h0-runner-receipt.md
)
SOURCE_RECEIPT_MANIFEST=.superpowers/sdd/h0-runner-receipt-source.manifest
SOURCE_RECEIPT_MANIFEST_DIGEST=.superpowers/sdd/h0-runner-receipt-source.sha256
for ignored_path in "$SOURCE_RECEIPT_MANIFEST" "$SOURCE_RECEIPT_MANIFEST_DIGEST"; do
  /usr/bin/git check-ignore -q -- "$ignored_path"
done
SOURCE_RECEIPT_MANIFEST_SHA256="$(node <<'NODE'
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } = require('node:fs');
const { relative, resolve, sep } = require('node:path');
const fail = (message) => { throw new Error(`Task 9 source receipt: ${message}`); };
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { maxBuffer: 64 * 1024 * 1024, ...options });
const repoRoot = realpathSync.native(git(['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
const receiptPaths = [
  'docs/ops/cwv-measurement-runner.md',
  'docs/ops/evidence/h0-runner-attestation.json',
  'docs/ops/evidence/h0-runner-receipt.md',
];
const manifestPath = '.superpowers/sdd/h0-runner-receipt-source.manifest';
const digestPath = '.superpowers/sdd/h0-runner-receipt-source.sha256';
const hasSafeSegments = (path) => path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && /^[A-Za-z0-9._@+-]+$/.test(segment));
const sameNode = (left, right) => left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
const stableStat = (stat) => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const isBeneathRoot = (candidate) => {
  const relation = relative(repoRoot, candidate);
  return relation !== '' && relation !== '..' && !relation.startsWith(`..${sep}`) && resolve(repoRoot, relation) === candidate;
};
const assertSafeParents = (path, createMissing) => {
  if (!hasSafeSegments(path)) fail(`unsafe relative path: ${path}`);
  const rootStat = lstatSync(repoRoot, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync.native(repoRoot) !== repoRoot) fail('unsafe canonical repository root');
  let current = repoRoot;
  const parentIdentity = [[current, rootStat.dev, rootStat.ino, rootStat.mode].map(String).join(':')];
  for (const segment of path.split('/').slice(0, -1)) {
    current = resolve(current, segment);
    if (!isBeneathRoot(current)) fail(`parent escapes canonical repository root: ${path}`);
    let stat;
    try {
      stat = lstatSync(current, { bigint: true });
    } catch (error) {
      if (!createMissing || error.code !== 'ENOENT') throw error;
      mkdirSync(current, { mode: 0o700 });
      stat = lstatSync(current, { bigint: true });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(current) !== current) fail(`unsafe parent component: ${path}`);
    parentIdentity.push([current, stat.dev, stat.ino, stat.mode].map(String).join(':'));
  }
  const filename = resolve(repoRoot, path);
  if (!isBeneathRoot(filename)) fail(`file escapes canonical repository root: ${path}`);
  return { filename, parentIdentity: parentIdentity.join('\0') };
};
const readRegularNoFollow = (path) => {
  if (typeof constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW is unavailable');
  const parentBefore = assertSafeParents(path, false);
  let descriptor;
  try {
    descriptor = openSync(parentBefore.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) fail(`not a regular source file: ${path}`);
    const bytes = require('node:fs').readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (stableStat(before) !== stableStat(after)) fail(`source file drift: ${path}`);
    const leaf = lstatSync(parentBefore.filename, { bigint: true });
    if (!leaf.isFile() || leaf.isSymbolicLink() || !sameNode(leaf, before)) fail(`source leaf drift: ${path}`);
    const parentAfter = assertSafeParents(path, false);
    if (parentAfter.filename !== parentBefore.filename || parentAfter.parentIdentity !== parentBefore.parentIdentity) fail(`source parent drift: ${path}`);
    return { bytes, mode: (before.mode & 0o111) !== 0 ? '100755' : '100644' };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};
const writeRegularNoFollow = (path, bytes) => {
  if (typeof constants.O_NOFOLLOW !== 'number') fail('O_NOFOLLOW is unavailable');
  const parentBefore = assertSafeParents(path, true);
  let descriptor;
  try {
    descriptor = openSync(parentBefore.filename, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) fail(`receipt target is not regular: ${path}`);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!after.isFile() || !sameNode(before, after)) fail(`receipt target drift: ${path}`);
    const leaf = lstatSync(parentBefore.filename, { bigint: true });
    if (!leaf.isFile() || leaf.isSymbolicLink() || !sameNode(leaf, after)) fail(`receipt target leaf drift: ${path}`);
    const parentAfter = assertSafeParents(path, false);
    if (parentAfter.filename !== parentBefore.filename || parentAfter.parentIdentity !== parentBefore.parentIdentity) fail(`receipt target parent drift: ${path}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};
const fields = [];
for (const path of receiptPaths) {
  const { bytes, mode } = readRegularNoFollow(path);
  let status = 'A';
  try {
    git(['cat-file', '-e', `HEAD:${path}`], { stdio: 'ignore' });
    status = 'M';
  } catch {}
  fields.push(status, mode, createHash('sha256').update(bytes).digest('hex'), path);
}
const manifest = Buffer.from(`${fields.join('\0')}\0`);
const manifestSha256 = createHash('sha256').update(manifest).digest('hex');
writeRegularNoFollow(manifestPath, manifest);
writeRegularNoFollow(digestPath, Buffer.from(`${manifestSha256}\n`));
process.stdout.write(manifestSha256);
NODE
)"
case "$SOURCE_RECEIPT_MANIFEST_SHA256" in (*[!0-9a-f]*|'') exit 1;; esac
test "${#SOURCE_RECEIPT_MANIFEST_SHA256}" = 64
coderabbit review --agent -t uncommitted -c AGENTS.md
BACI_CWV_RECEIPT_REVIEW
```

The independent reviewer receives the three raw files, the NUL-delimited `SOURCE_RECEIPT_MANIFEST` whose rows are exact status/mode/hash/path tuples, and `SOURCE_RECEIPT_MANIFEST_SHA256`; no index mutation is permitted for that review. Its final owner-visible review receipt must publish the literal 64-hex manifest digest. That literal is the out-of-band authority for the commit gate: the owner supplies it once as `REVIEWED_SOURCE_RECEIPT_MANIFEST_SHA256` when invoking the following here-document, and the body marks it readonly before reading either mutable manifest file. The body may never derive, overwrite, or refresh that authority from `SOURCE_RECEIPT_MANIFEST` or its companion digest file; it only proves both files and the later staged-index manifest equal the independently published literal. Fix valid findings and repeat the affected Task 9 receipt gate plus both reviews until clean. Then stage only those exact paths, run the complete exact staged-path/status/mode/blob projection before the staged tests, capture its immutable tree, and rerun that entire projection plus the same-tree check immediately before commit:

```bash
/bin/bash <<'BACI_CWV_RECEIPT_COMMIT'
set -euo pipefail
RECEIPT_PATHS=(
  docs/ops/cwv-measurement-runner.md
  docs/ops/evidence/h0-runner-attestation.json
  docs/ops/evidence/h0-runner-receipt.md
)
SOURCE_RECEIPT_MANIFEST=.superpowers/sdd/h0-runner-receipt-source.manifest
SOURCE_RECEIPT_MANIFEST_DIGEST=.superpowers/sdd/h0-runner-receipt-source.sha256
: "${REVIEWED_SOURCE_RECEIPT_MANIFEST_SHA256:?owner must supply the independent review literal}"
readonly SOURCE_RECEIPT_MANIFEST_SHA256="$REVIEWED_SOURCE_RECEIPT_MANIFEST_SHA256"
case "$SOURCE_RECEIPT_MANIFEST_SHA256" in (*[!0-9a-f]*|'') exit 1;; esac
test "${#SOURCE_RECEIPT_MANIFEST_SHA256}" = 64
test "$(tr -d '\n' < "$SOURCE_RECEIPT_MANIFEST_DIGEST")" = "$SOURCE_RECEIPT_MANIFEST_SHA256"
test "$(/usr/bin/shasum -a 256 -- "$SOURCE_RECEIPT_MANIFEST" | /usr/bin/awk '{print $1}')" = "$SOURCE_RECEIPT_MANIFEST_SHA256"
/usr/bin/git add docs/ops/cwv-measurement-runner.md docs/ops/evidence/h0-runner-attestation.json docs/ops/evidence/h0-runner-receipt.md
STAGED_RECEIPT_MANIFEST=.superpowers/sdd/h0-runner-receipt-staged.manifest
verify_complete_staged_projection() {
  test "$(tr -d '\n' < "$SOURCE_RECEIPT_MANIFEST_DIGEST")" = "$SOURCE_RECEIPT_MANIFEST_SHA256"
  test "$(/usr/bin/shasum -a 256 -- "$SOURCE_RECEIPT_MANIFEST" | /usr/bin/awk '{print $1}')" = "$SOURCE_RECEIPT_MANIFEST_SHA256"
  # shellcheck disable=SC2016
  node -e 'const {execFileSync}=require("node:child_process"); const expected=Buffer.from(`${process.argv.slice(1).sort().join("\0")}\0`); const all=execFileSync("/usr/bin/git",["diff","--cached","--name-only","-z"]); if (!all.equals(expected)) process.exit(1)' "${RECEIPT_PATHS[@]}"
  /usr/bin/git diff --cached --check
  : > "$STAGED_RECEIPT_MANIFEST"
  for path in "${RECEIPT_PATHS[@]}"; do
    status=$(/usr/bin/git diff --cached --name-status -- "$path" | /usr/bin/awk 'NR==1 {print $1}')
    case "$status" in (A|M) ;; (*) exit 1;; esac
    mode=$(/usr/bin/git ls-files -s -- "$path" | /usr/bin/awk 'NR==1 {print $1}')
    case "$mode" in (100644|100755) ;; (*) exit 1;; esac
    printf '%s\0%s\0%s\0%s\0' "$status" "$mode" "$(/usr/bin/git show ":$path" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')" "$path" >> "$STAGED_RECEIPT_MANIFEST"
  done
  cmp -- "$SOURCE_RECEIPT_MANIFEST" "$STAGED_RECEIPT_MANIFEST"
  test "$(/usr/bin/shasum -a 256 -- "$STAGED_RECEIPT_MANIFEST" | /usr/bin/awk '{print $1}')" = "$SOURCE_RECEIPT_MANIFEST_SHA256"
}
verify_complete_staged_projection
readonly BACI_CWV_PRIMARY_CHECKOUT="${BACI_CWV_PRIMARY_CHECKOUT:?set the pre-recorded primary checkout}"
readonly BACI_CWV_PRIMARY_HEAD_SHA="${BACI_CWV_PRIMARY_HEAD_SHA:?set the pre-recorded primary HEAD SHA}"
readonly BACI_CWV_PRIMARY_GIT_DIR="${BACI_CWV_PRIMARY_GIT_DIR:?set the pre-recorded absolute primary git-dir}"
readonly BACI_CWV_PRIMARY_GIT_COMMON_DIR="${BACI_CWV_PRIMARY_GIT_COMMON_DIR:?set the pre-recorded absolute primary git-common-dir}"
readonly BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256="${BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256:?set the pre-recorded primary root marker hash}"
readonly BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256="${BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256:?set the pre-recorded primary web marker hash}"
readonly BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256="${BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256:?set the pre-recorded Task 9 root marker hash}"
readonly BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256="${BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256:?set the pre-recorded Task 9 web marker hash}"
case "$BACI_CWV_PRIMARY_CHECKOUT" in (/*) ;; (*) exit 1;; esac
case "$BACI_CWV_PRIMARY_GIT_DIR" in (/*) ;; (*) exit 1;; esac
case "$BACI_CWV_PRIMARY_GIT_COMMON_DIR" in (/*) ;; (*) exit 1;; esac
case "$BACI_CWV_PRIMARY_HEAD_SHA" in (*[!0-9a-f]*|'') exit 1;; esac
test "${#BACI_CWV_PRIMARY_HEAD_SHA}" = 40
for digest in \
  "$BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256" \
  "$BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256" \
  "$BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256" \
  "$BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256"; do
  case "$digest" in (*[!0-9a-f]*|'') exit 1;; esac
  test "${#digest}" = 64
done
test -d "$BACI_CWV_PRIMARY_GIT_DIR" && test -d "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
test "$( ( cd -- "$BACI_CWV_PRIMARY_CHECKOUT"; /bin/pwd -P ) )" = "$BACI_CWV_PRIMARY_CHECKOUT"
test "$( ( cd -- "$BACI_CWV_PRIMARY_GIT_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_PRIMARY_GIT_DIR"
test "$( ( cd -- "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse --show-toplevel)" = "$BACI_CWV_PRIMARY_CHECKOUT"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse HEAD)" = "$BACI_CWV_PRIMARY_HEAD_SHA"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse --path-format=absolute --git-dir)" = "$BACI_CWV_PRIMARY_GIT_DIR"
test "$(/usr/bin/git -C "$BACI_CWV_PRIMARY_CHECKOUT" rev-parse --path-format=absolute --git-common-dir)" = "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
BACI_CWV_TASK9_CHECKOUT="$(/usr/bin/git rev-parse --show-toplevel)"
readonly BACI_CWV_TASK9_CHECKOUT
test "$BACI_CWV_PRIMARY_CHECKOUT" != "$BACI_CWV_TASK9_CHECKOUT"
readonly BACI_CWV_TASK9_GIT_DIR="$(/usr/bin/git -C "$BACI_CWV_TASK9_CHECKOUT" rev-parse --path-format=absolute --git-dir)"
readonly BACI_CWV_TASK9_GIT_COMMON_DIR="$(/usr/bin/git -C "$BACI_CWV_TASK9_CHECKOUT" rev-parse --path-format=absolute --git-common-dir)"
test -d "$BACI_CWV_TASK9_GIT_DIR" && test -d "$BACI_CWV_TASK9_GIT_COMMON_DIR"
test "$( ( cd -- "$BACI_CWV_TASK9_CHECKOUT"; /bin/pwd -P ) )" = "$BACI_CWV_TASK9_CHECKOUT"
test "$( ( cd -- "$BACI_CWV_TASK9_GIT_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_TASK9_GIT_DIR"
test "$( ( cd -- "$BACI_CWV_TASK9_GIT_COMMON_DIR"; /bin/pwd -P ) )" = "$BACI_CWV_TASK9_GIT_COMMON_DIR"
test "$BACI_CWV_TASK9_GIT_DIR" != "$BACI_CWV_PRIMARY_GIT_DIR"
test "$BACI_CWV_TASK9_GIT_COMMON_DIR" = "$BACI_CWV_PRIMARY_GIT_COMMON_DIR"
verify_cli_latest_marker() {
  checkout=$1
  path=$2
  expected=$3
  marker="$checkout/$path"
  test -f "$marker" && test ! -L "$marker"
  test "$(/usr/bin/shasum -a 256 -- "$marker" | /usr/bin/awk '{print $1}')" = "$expected"
  test -z "$(/usr/bin/git -C "$checkout" status --porcelain=v1 -- "$path")"
}
verify_cli_latest_marker "$BACI_CWV_PRIMARY_CHECKOUT" supabase/.temp/cli-latest "$BACI_CWV_PRIMARY_ROOT_CLI_LATEST_SHA256"
verify_cli_latest_marker "$BACI_CWV_PRIMARY_CHECKOUT" apps/web/supabase/.temp/cli-latest "$BACI_CWV_PRIMARY_WEB_CLI_LATEST_SHA256"
verify_cli_latest_marker "$BACI_CWV_TASK9_CHECKOUT" supabase/.temp/cli-latest "$BACI_CWV_TASK9_ROOT_CLI_LATEST_SHA256"
verify_cli_latest_marker "$BACI_CWV_TASK9_CHECKOUT" apps/web/supabase/.temp/cli-latest "$BACI_CWV_TASK9_WEB_CLI_LATEST_SHA256"
node <<'NODE'
const { execFileSync } = require('node:child_process');
const allowed = new Set([
  'docs/ops/cwv-measurement-runner.md',
  'docs/ops/evidence/h0-runner-attestation.json',
  'docs/ops/evidence/h0-runner-receipt.md',
]);
const raw = execFileSync('/usr/bin/git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
if (!raw.length || raw.at(-1) !== 0) process.exit(1);
const entries = raw.subarray(0, -1).toString('utf8').split('\0');
if (entries.length !== allowed.size) process.exit(1);
for (const entry of entries) {
  if (entry.length < 4 || entry[2] !== ' ') process.exit(1);
  const code = entry.slice(0, 2);
  const path = entry.slice(3);
  if ((code !== 'A ' && code !== 'M ') || !allowed.delete(path)) process.exit(1);
}
if (allowed.size) process.exit(1);
NODE
REPO_ROOT=$(pwd -P)
readonly STAGED_TREE="$(/usr/bin/git write-tree)"
STAGED_COMMIT=$(printf '%s\n' 'temporary exact-index receipt gate' | /usr/bin/git -c user.name=baci-cwv-gate -c user.email=baci-cwv-gate@invalid commit-tree "$STAGED_TREE" -p HEAD)
STAGED_CHECKOUT=$(/usr/bin/mktemp -d /private/tmp/baci-cwv-staged-index.XXXXXX)
/bin/rmdir "$STAGED_CHECKOUT"
cleanup_staged_checkout() {
  /usr/bin/git worktree remove --force "$STAGED_CHECKOUT" >/dev/null 2>&1 || /bin/rm -rf -- "$STAGED_CHECKOUT"
}
trap cleanup_staged_checkout EXIT HUP INT TERM
/usr/bin/git worktree add --detach "$STAGED_CHECKOUT" "$STAGED_COMMIT"
test -d "$REPO_ROOT/node_modules" && test ! -L "$REPO_ROOT/node_modules"
/bin/ln -s "$REPO_ROOT/node_modules" "$STAGED_CHECKOUT/node_modules"
(
  cd "$STAGED_CHECKOUT"
  pnpm turbo lint
  pnpm turbo typecheck
  pnpm turbo test
  node --test --test-concurrency=1 infra/cwv-runner/*.test.mjs .github/scripts/cwv-runner-*.test.mjs
  pnpm exec biome check infra/cwv-runner .github/scripts/cwv-runner-*.mjs
  pnpm --filter @baci/web typecheck:tools-workers
)
verify_complete_staged_projection
test "$(/usr/bin/git write-tree)" = "$STAGED_TREE"
/usr/bin/git commit -m "docs: attest cwv measurement runner"
BACI_CWV_RECEIPT_COMMIT
```

The reviewed-source versus staged per-blob manifest comparison proves the reviewed source bytes did not change before commit; no same-source digest comparison is accepted as evidence. After the normal commit, push/create PR B, run required CI, and obtain fresh exact-head Codex CLEAN/no-issues with every thread resolved and branch current/conflict-free; only then merge normally. CI necessarily validates the committed/pushed head, while the independent source review plus staged-byte equality protects the pre-commit bytes. The merged receipt may unlock creation of `docs/superpowers/plans/2026-07-14-ogabassey-home-h0-measurement.md`. It does not authorize H0 measurement, H0-MEASURE rollout, storefront rendering changes, or category/H1/H2 implementation by itself.

## Self-Review Receipt

- **Plan review convergence:** two independent full-plan reviewers returned READY/CLEAN after the owner-approved exact-run exception, executable token isolation, split host/runtime identity, squash/rebase-safe source binding, exact-main dispatch gate, and terminal cleanup were corrected. The first required local CodeRabbit pass raised ten major and one minor issue: nine valid majors were fixed; the Actions-read App suggestion was rejected because the normative App is exactly Administration-read plus Metadata-read and never reads artifacts (the built-in job token owns artifact readback); the minor request to replace targeted standalone `node --test` commands was rejected because these `.mjs` contract suites intentionally use Node's native harness. The next substantive pass found five valid major contract gaps and two valid minor clarity/enforcement gaps; the resulting rereview then found four shared-host execution gaps. Later exact-byte passes closed canonical signed Ubuntu snapshot resolution, source/MAC-spoof-resistant zero-capability network isolation, and the complete Task 1 policy fixture. The latest substantive pass found four valid majors: unbound Ollama destructive targets, inconsistent build cleanup flags, omitted host-originated ambient egress, and one runner provenance digest typo. The subsequent exact-byte rereview found the symmetric host-local ingress omission, which is now closed with a policy-named same-hook host-local counter. During Task 1 review, a proposed digest edit regressed the runner value to 63 hex characters; the shared-VPS rereview rejected it, and the official GitHub release API for asset `442283019` re-established the exact 64-character digest now used in all four plan occurrences and the implementation. Task 2/3 preflight then closed two freeze-order collisions before Task 1 commit: later receipts now reuse the exported `canonicalJson()` bytes, and post-Task-1 watchdog digests bind through capture/attestation/source-manifest evidence rather than rewriting frozen policy. The quiesce/watchdog controller also now receives one explicit closed mode enum including rehearsal instead of relying on an ambient mode. Task 2 RED/GREEN implementation then exposed a provenance transport contradiction; immutable byte inputs retain mandatory raw SHA-256 verification, while only the raw-hashless runner-release and pnpm-registry JSON envelopes use a pinned-Node bounded exact-origin semantic fetch and can never replace independent artifact SHA/integrity checks. The final substantive CodeRabbit pass raised three valid majors and one stale minor: import CPU PSI now reuses the zero policy threshold, Task 2 defers accepted build/archive creation until Task 5 freezes the post-merge canonical source manifest, and the queue budget now equals the 120-second listener hold; the requested `-c AGENTS.md` flag was already present in the cited final review command. This revision now identity-binds every retirement mutation, uses one build/verify/cleanup output-flag contract, adds same-hook host-local-ingress and host-egress accounting to their ambient totals, corrects every digest occurrence, moves installer cleanup coverage to Task 5, separates host/runtime runner identity digests, adds a strictly local sampler interface, makes campaign/watchdog acquisition transactional before mutation, defines a no-network rehearsal, makes policy resource equality cumulative, moves PR B review before staging, enforces the line limit, and pins Task 2 policy-digest, custom-label, exact-download, and Ubuntu snapshot contracts. A fresh final CodeRabbit pass and independent rereview are required before this plan commit.
- **Latest dispatch/token review closure:** the newest substantive pass found four major contract issues. Three valid gaps are now closed: every dispatch/rerun requires a complete post-dispatch pre-release workflow reconciliation over the exact five active statuses; the registration token lives below a random non-traversable root-only parent with a continuous guard that permits only one receipt-bound registration container and sealed process/mount tree; and same-run recovery is limited to one deterministic transport-loss code produced from closed failed-job/root-restore evidence with an attempt-bound `201` queue timer. The request to zero the existing process-map `cleanup` vector was rejected as a phase-name ambiguity: that phase is the assigned job's in-process secure action/post-action cleanup and therefore still requires the pinned runner/action processes; terminal host restore is now separately named and requires every runner/job process to be absent. The subsequent CodeRabbit pass's `return_run_details` suggestion was rejected against GitHub's official `2026-03-10` English REST contract, which defines only `ref` and `inputs` body fields and returns run details with HTTP `200`; its network-rate and pinned direct-Listener-proof findings are incorporated. Fresh exact-byte independent and CodeRabbit review remain mandatory before commit.
- **Final exact-byte CodeRabbit closure:** the repository retention request is fixed at 90 days while accepting a repository ceiling `maximum_allowed_days >= 90`, and the automatic production-coherence gate now requires evidence of a prebuilt Vercel deployment using `vercel deploy --prebuilt --prod` bound to the exact merge SHA. Independent rereview then made that gate executable for infrastructure-only PR A by adding a contract-tested `infra/cwv-runner/**` web-deployment filter and expanded both retention matrices to the exact predicate. Task 2 independent code review also made the signed Ubuntu package boundary executable without overloading the Dockerfile by adding the declared, tested `verify-apt-snapshot.sh` helper and canonical package receipt. The final follow-up binds the installed `/srv/baci-cwv/source/<merge-sha>/` bytes to the one preserved post-merge canonical source manifest/archive before execution, adds fixed-tool copy/hash boundaries so neither privileged repository scripts nor image/receipt parsers consume user-writable staging, renders every watchdog `ExecStart` to that immutable exact-SHA tree without an alias, replaces the owner dispatcher's implicit host-Node dependency with an immediately rebound fixed-tool Mac CLI verifier, and moves GitHub App private-key upload into validated unsynchronized `/private/tmp` storage with fail-closed ownership/mode/symlink checks and unconditional cleanup. The last CodeRabbit pass also made dedicated-label uniqueness global across every registered online/offline runner with a second pre-listener read, added `deploy.yml` to the cumulative actionlint surface, and recorded why already-public non-secret host topology remains explicit while secrets/private receipts do not. Independent security rereview then made the second read executable without a VPS credential: the owner dispatcher sends a complete five-second paginated inventory receipt bound to the held container/admission, root verifies it before release, and the in-job App independently rechecks. The generic request to replace native `node --test` was rejected: these standalone `.mjs` contract suites deliberately use Node's built-in harness, the repository rules do not prohibit it, and existing tracked plans use the same command.
- **Credential-free final convergence:** the final contract rereview removed the last contradictory root-side GitHub metadata read; the authenticated owner dispatcher now validates live run metadata and sends a nonce-bound, short-lived canonical admission document that root validates offline before hold. The final CodeRabbit findings were also closed by explicitly approving only the public run/runner evidence projection while keeping full receipt bodies private, and by using one unambiguous raw file SHA-256 contract—computed over reviewed Git object contents and rechecked over copied bytes—for both source sealing and owner-CLI verification.
- **Finite final authority closure:** the last substantive CodeRabbit findings are closed by excluding registration `.env` from the sealed runtime, deriving the exact active tag ruleset and all four action pins from policy, anchoring `gpgv` in the content-addressed Ubuntu base image, freezing mark packing, and replacing the ambiguous process claim with one phase-aware image-derived executable map. The subsequent contract/security rereview is closed by separating the raw `policyFileSha256` authorization from supplementary `policyCanonicalSha256`, comparing embedded policy bytes exactly, and generating the sole public artifact by explicit projection into the closed one-member schema above; no raw receipt, open-ended digest, process detail, or extra failure result can enter the artifact or repository evidence. The fresh substantive CodeRabbit pass then closed three new contract gaps: admission/inventory freshness now uses only root-local monotonic arrival/deadlines with owner UTC as audit data, the source manifest has a distinct exact `sourceArchive` projection independent of broader PR-diff entries, and cleanup is performed inside the already-approved action Node process rather than by undeclared executables. Its fourth mark-derivation finding was already substantively present; this revision makes the one shared helper and all classifier/collision/accounting/cleanup consumers explicit. The final security rereview first rejected an impossible one-Bash-per-phase cap, then proved the pinned upstream `run.sh` chain mutates the read-only runner tree and invokes undeclared utilities. Policy now carries exact four-phase cardinality vectors and the normal lifecycle bypasses every upstream runner shell/helper: sealed PID-1 Node directly spawns one immutable `Runner.Listener run --once`, forwards signals, forbids restart/update exits, and the static/behavioral workflow contract accounts only for the one transient assigned `run:` shell before it immediately transfers control to sealed action Node. The subsequent CodeRabbit review closed the remaining trust-boundary gaps by inventorying the complete pre-install verifier tool/library/keyring closure, rejecting every non-regular leaf under the source-archive Git prefix rather than omitting it, and moving forwarded-ingress accounting to the `forward` hook after the campaign classifier while moving host-local ingress to the mutually exclusive `input` hook. The next exact-byte pass removed the last stale `run.sh` assertion and aligned every input/forward implementation text, made forwarded ingress total include unrelated production/container traffic while only the marked subset is runner-specific, fixed workflow-literal action pins as a one-to-one policy rendering, and binds both owner scripts plus policy to one immutable reviewed source-manifest digest before any dispatcher, network, key, or upload action.
- **Spec coverage:** Tasks 1-9 cover V4 lines 466-478: owner/host/account/service/labels; shared-host isolation; immutable supply chain; token hygiene; read-only auditor App; exact immutable ruleset and permanent probes; artifact retention; canonical attestation; failure matrix; reboot; no hosted fallback; replacement-generation boundary.
- **Shared-host exception:** The original isolated-host intent is preserved during campaigns with exclusive CPU cgroups, stopped competing runners/timers, continuing applications constrained to the other CPU set, and hard network/pressure refusal. Residual kernel/egress sharing is explicit and cannot be hidden by threshold relaxation.
- **No metric leakage:** No task runs a browser, Lighthouse, PSI, DebugBear, storefront curl, or H0 slot. The attestation workflow is infrastructure-only.
- **PR #2686:** Explicitly superseded for H0-RUNNER infrastructure; later H0 may inspect individual parser modules, never the stale branch as authority.
- **No placeholders:** Exact paths, values, commands, expected outcomes, permissions, labels, namespaces, thresholds, versions, hashes, and rollback boundaries are present. Execution-time identities are derived and validated from Git/GitHub rather than handwritten.
- **Type/interface consistency:** `policy.json` feeds every script/verifier; canonical identity excludes transient attempt data; the same runner name/labels/resources/ruleset/App variables are used throughout.
- **Protected state:** No proxy, migration, storefront code, SQL replay, Supabase marker, deployment command, or measurement workflow is in scope.

## Execution Handoff

Execute with **superpowers:subagent-driven-development** using disjoint file ownership and one integration owner, not a one-worker-per-task assumption. Tasks 1-6 are repository-only and may proceed without VPS mutation; they converge through the current cumulative-integration rule, a frozen final manifest/digest, CodeRabbit, and an independent exact-diff review before any implementation push. The plan itself is reviewed and committed separately as docs-only governance. Tasks 7-9 change external state and must run serially under the named owner approval and campaign/deployment non-overlap gates.
