# REDVAULT fresh-claim cutover

The fresh-claim migration must not be applied while older application instances can start or finish a REDVAULT provider initialization. An already claimed HTTP request may remain in flight across the database commit; the migration cannot revoke that request or an already issued Paystack checkout URL.

Before a future rollout, stop admission on every old server and worker, wait for all in-flight initializations to finish, and reconcile every initializing or indeterminate attempt against durable provider evidence. A lookup miss, unpaid status, local timeout, or expired lease alone does not prove a checkout cannot settle. Keep unresolved attempts fenced and do not void, replace, or reissue them without an authoritative retirement contract.

Apply the combined migration before deploying callers that require the v4 freshness marker. Those callers fail closed if v4 is unavailable. The migration prevents legacy v3 from reclaiming an initializing attempt and rejects voiding uncertain attempts; it does not prevent a provider request already in flight at cutover. Verify the migration and deployed server versions separately before restoring admission. This document does not authorize a migration, provider request, configuration change, or deployment.
