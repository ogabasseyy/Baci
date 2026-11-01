# Merchant media deletion safety (#3669)

Deletion resolves an authenticated merchant's Storage object UUID or filename to the canonical `media/<merchant>/<path>` identity. Database permission checks repeat owner/staff authorization independently of the API. The generic media route requires product delete permission; the blog route retains marketing edit permission, scoped to that merchant's blog prefix.

The private source registry covers current catalog products, variants, offers and feed images; merchant branding/settings; builder draft, published and rollback page data; pending builder operations; merchant/platform blog content; categories/brands; loyalty reward media and order/negotiation snapshots. Views delegate to registered base tables. Stored relation OIDs survive schema moves. New media-bearing storage added by a future feature must register the base table and its guard in the same migration.

Every registered source insert/update takes durable UUID gates shared with deletion admission. Gates include merchant, object and referenced UUID identities, in sorted order. Numeric inventory changes with identical string data return without gate writes. The durable gate update forces stale REPEATABLE READ callers to retry rather than missing a newly committed claim. A claim scans existing sources under those gates; any literal, percent/HTML-encoded path or object ID match blocks deletion. Matching is conservative and may refuse ambiguous references. Saved historical page versions deliberately count as references.

For a request containing multiple files, the authenticated batch admission RPC
qualifies and claims every member in a single database transaction. An in-use,
missing, or unauthorized member rolls back the whole batch. Numeric HTML
entities that do not represent valid Unicode remain literal text during scans;
valid encodings continue to be decoded before matching.

Removing a saved blog featured image clears the editor reference for the next
save. Physical cleanup is attempted only for an upload tracked by the current
editor session and can fail safely while a saved post or revision still refers
to the file. The merchant can still remove or replace the image in the form.

After admission, a permanent private claim blocks new references and reuse of the same Storage path. Restrictive Storage policies also guard direct authenticated removal, replacement and upload calls. Storage's API removes the actual bytes. Completion requires the object metadata to be absent; an empty/no-op `remove` response cannot report success while metadata remains. Failed removal remains pending and can be retried. API list status and the media picker expose pending deletion, and the picker prevents selecting a pending object.

No request uses a service-role client. Platform-prefixed blog media retain their existing worker protocol; the new removal gate applies to merchant UUID prefixes. Application-controlled deletion never directly deletes Storage metadata with SQL. The native test's owned, empty Storage metadata schema simulates RLS transactions only and does not establish external Storage byte deletion. Current-head full-schema replay and provider integration remain CI/staging qualification boundaries.

Private claims and gate UUID rows persist after byte deletion so stale clients cannot resurrect dead URLs. They contain no customer text, tokens or provider response bodies. This is synchronous admission followed by an idempotent Storage API removal; it does not enable a production cleanup worker or delete any existing media during migration.
