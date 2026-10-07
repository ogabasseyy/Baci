# Owner-run staging drafts artifact upgrade candidate

This is a **candidate only**. It does not contact the VPS on its own, change
systemd units, environment files, timer definitions, Nginx, DNS, Vercel, or any
credentials. The retired cutover installer and its expired lease are not used.

The owner wrapper must create and review a complete JSON manifest before it
invokes this script. The format is `{"version":1,"entries":[...]}`, where each
sorted entry records either a file SHA-256 or an internal relative symlink
target. The wrapper passes the manifest's independently pinned SHA-256:

```sh
sudo /root/reviewed-draft-upgrade/upgrade-savings-drafts.py --upgrade \
  --source /home/bassey/baci-funding-build-20260922-1822/apps/web/.next/standalone \
  --manifest /root/reviewed-draft-upgrade/full-artifact-manifest.json \
  --manifest-sha256 '<owner-reviewed-lowercase-sha256>'
```

The source path remains untrusted until every file and symlink matches that
manifest. The candidate requires static and public assets; rejects `.env*`,
dangling, cyclic, escaping, and symlink-ancestor paths; parses the manifest
from the exact bytes it hashes; and refuses changed unit/process identity,
drop-ins, pending daemon reload, inactive or changed September 29 2026
15:59:10 UTC deadline, or unsafe smoke configuration.

It copies to a new root-owned path under `/opt`, re-verifies the full artifact,
rechecks and stops only the captured existing service invocation, then atomically
exchanges only `/opt/baci-savings-drafts` and retains the former artifact as a
rollback backup. It runs the existing restricted 4794 smoke unit before starting
the replacement. Health checks retry on bounded startup delay. If a captured
replacement fails `401` health, it stops only that same invocation, restores the
old artifact, and starts the re-proven original service identity.

Run locally with:

```sh
python3 apps/web/tools/piggyvest-staging/draft-upgrade/upgrade-savings-drafts.test.py
```
