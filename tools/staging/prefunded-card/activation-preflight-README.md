# Prefunded first-card owner diagnostic

Run the existing entrypoint from the receiver worktree:

```sh
shasum -a 256 -c tools/staging/prefunded-card/activation-preflight.SHA256SUMS
bash tools/staging/prefunded-card/activation-preflight.sh
```

The launcher verifies the local diagnostic checksum, creates a unique
checksum-addressed user staging directory on `bassey@82.29.190.219`, then opens
an interactive owner-sudo session. The owner copies the candidate to a new
root-only temporary directory, verifies its checksum again, and runs it with a
cleared environment. Existing root candidates are refused rather than replaced.

The root-only diagnostic uses only the approved fixed container
`baci-isolated-savings-db-1` and the exact `docker exec ... psql` contract. It
runs two `BEGIN TRANSACTION READ ONLY` / `ROLLBACK` queries. Both check system
identifier `7685292944002592802`; the second query gates all schema, function,
role, and membership metadata on that same identity, so a container change
between connections returns no relation metadata.

The JSON result contains only allowlisted metadata: prefunded schema presence,
the checkout function catalog, restricted executor roles and memberships,
root-level `prefunded` system-unit names, and file hash/mode/owner metadata for
the existing gateway binding and unit. It never reads configuration content,
environment files, credentials, provider responses, or database rows.

`checkoutFunctionBaseline` remains `seven_function_partial` when the historical
seven checkout functions exist but `checkout_capability(jsonb,uuid,uuid,uuid,bigint)`
is absent. Only all eight returns `eight_function_ready`; neither label enables
the feature or establishes that the full treasury, webhook, worker, or provider
provisioning is complete.
