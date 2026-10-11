# Restricted Baci blog publisher

The daily `platform_marketing` writer still produces review handoffs. It does
not approve or publish its own output. This worker publishes only owner-approved
releases assigned to its dedicated ordinary Supabase Auth identity.

## Approval and publication

1. Review the official sources, article claims, originality and generated images.
2. In the web package, run `pnpm exec tsx
   tools/blog/prepare-platform-blog-release-cli.ts handoff.json payload.json`.
   This uses the shared parser, sanitizer, save schema and publication image gates.
   Simple generated figures become image and caption paragraphs; unusual figure
   markup fails closed. Images and captions are retained.
3. A trusted operator inserts the prepared payload into the private release queue,
   recording the owner approval and assigning the publisher. The worker cannot
   write approvals, alter approved content or acquire platform-admin permission.
4. Run the worker with `--dry-run`, then without it. The publish RPC accepts only
   an approved release UUID. It atomically creates an audited platform post and
   records its ID. Retrying the same release returns that post, never a duplicate.
5. The worker checks the public page's heading before recording local completion.
   Published releases remain discoverable for recovery even after approval expiry;
   unpublished expired and all revoked releases remain unavailable.

## Installed layout

- `/home/bassey/.config/baci/blog-publisher.json`: mode 0600, dedicated identity
  password and public API key only; no service-role key or admin permission.
- `/home/bassey/baci-blog-publisher/publisher.py`: reviewed runtime source.
- `/home/bassey/.local/state/baci/blog-publisher.json`: mode 0600 replay/verification
  journal. Do not clear it during routine upgrades.
- Cron checks the approved queue every 15 minutes under a non-overlapping lock.
  The existing daily writer schedule is unchanged.

The public platform blog uses the existing `merchant` cache profile (60-second
revalidation). The worker never primes an unpublished article URL. Check the
public listing/feed after publication; HTTP success is not evidence of indexing
or ranking. It does not bypass editorial approval or introduce a new app deploy.

## Disable and recover

A trusted operator sets the identity's private registry entry `enabled = false`
and removes its cron entry. Authorization checks the live registry on every RPC,
so previously issued access tokens do not retain publishing access. Revoke a
specific release by setting `revoked_at`; never rewrite its approved payload.
If the Auth password must be rotated, update the protected credential file and
verify `--dry-run` before resuming. Full-admin credentials are not a substitute.

## Checks

- `python3 -m unittest discover -s vps-workers/baci-blog-publisher`
- `pnpm --filter @baci/web exec vitest run tools/blog`
- Replay `supabase/tests/scoped_baci_blog_release.sql` **only** in an empty
  disposable PostgreSQL database. It creates its own fixture roles and tables.

## Two-post corrections

The owner separately approved a correction-only updater for the existing Bumpa
and Selar comparisons (post IDs are allowlisted in the migration). This does not
give the worker general update or platform-admin rights. A trusted operator
queues reviewed, sanitized content with the exact old `updated_at` and body hash,
approval evidence and a maximum 24-hour expiry. The queue binds those fields to
an immutable SHA256 payload. The worker accepts only its assigned revision ID.

Run `python3 correction.py REVISION_UUID POST_UUID`. The RPC locks the approval,
publisher registry and target, rejects stale content, and changes only body,
excerpt and reading statistics. The existing audit guard verifies the exact
old/new row in the RPC transaction. Both its ordinary mutation audit and the
hash-bound correction receipt commit atomically. URLs, titles, cover metadata,
tenant ownership and publication time are preserved. Replays cannot overwrite
a later edit. Revoked approvals and disabled publisher identities fail closed.

The updater is manual, not added to the writer cron. Revoke the two approvals
after public verification. Replay `supabase/tests/scoped_baci_blog_corrections.sql`
only in an empty disposable database; it includes the insert-publisher fixture.

Apply correction migrations in timestamp order, including the audit-metadata
repair. The first correction migration was applied before the production audit
allowlist mismatch was observed; it is retained unchanged. The repair preserves
that allowlist and links the audit's `reason_code` to the private revision record.
