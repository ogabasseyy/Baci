# Staging application installation gate

The reviewed installer was rehearsed against the actual isolated application cluster `7685292944002592802` in an uncommitted transaction. It created candidate tables, verified the synthetic fixture and mapping, then refused activation because the candidate worker could access `net.http_request_queue_id_seq` through existing PUBLIC permissions. Connection termination rolled back the transaction. No tables, mapping or worker role from this attempt were committed.

Read-only inspection found explicit PUBLIC grants on `cron.job`, `cron.job_run_details`, `extensions.spatial_ref_sys`, `net._http_response`, `net.http_request_queue` and its sequence. Existence of grants is not itself proof of every effective operation; role/schema/RLS access must be evaluated before remediation. Do not disable the worker isolation audit or grant a service-role bypass.

The approved replay installer does not authorize changing unrelated extension permissions. Next decision: authorize a staging-only permission review and least-privilege remediation that preserves explicit access for existing staging services; alternatively design a separately isolated app-ledger boundary. No production changes are needed.

A separate genuine-event incompatibility was reproduced and corrected locally: the recognition RPC required session_id even though the observed inflows omit it. The installer now composes the existing additive nullable-session migration and accepts null in the RPC. Scratch PostgreSQL regression failed before and passed after the fix. Existing migration files were not modified.

Synthetic fixture validation now checks the existing customer/merchant relationship and a reserved test email domain; actual fixture domain was verified as `savings.example.invalid` without exporting its full address. Root typecheck passed; root lint remains blocked. Adapter work is tracked separately; live financial replay has not run.
