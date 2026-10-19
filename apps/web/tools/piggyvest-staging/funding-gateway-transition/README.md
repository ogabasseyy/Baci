# Hosted Funding Transition Candidate

This folder is a read-only preflight candidate. It does not deploy, start, stop, enable, alter a timer, read credentials, or write the provenance receipt.

## Owner Inputs

The future root wrapper must place a root-owned, single-link `0400` or `0600` JSON file at `/etc/baci-savings-gateway/funding-transition-inputs.json`. Its parent chain must be root-owned and not group/world writable. The JSON must have this exact schema; all SHA-256 values are owner-supplied lowercase hexadecimal digests.

```json
{
  "version": 1,
  "deadline": "2026-09-29T15:59:10.000Z",
  "preRenewalManifestSha256": "<64 lowercase hex>",
  "postRenewalManifestSha256": "<64 lowercase hex and different from preRenewalManifestSha256>",
  "packageManifestSha256": "<64 lowercase hex>",
  "archive": {
    "name": "<existing single directory name below renewals>",
    "bindingSha256": "<64 lowercase hex>",
    "startupEvidenceSha256": "<64 lowercase hex>"
  },
  "identity": {
    "restRoutes": ["<the exact nine hosted-funding route objects>"]
  }
}
```

The fixed state inputs are `/var/lib/baci-savings-gateway-install/receipt.json`, `renewal-receipt.json`, and the two files in the named archive. The candidate requires the real install receipt's `{version, manifestSha256, entries}` shape and the renewal writer's exact five-field receipt shape, including its seven-day elapsed interval. `/etc/baci-savings-gateway/post-renewal-install-manifest.json` must hash to `postRenewalManifestSha256` and its `managed-gateway.service` pin must hash the installed `/etc/systemd/system/baci-savings-gateway.service`. The reviewed renewal wrapper installs that unit as `0644`, so the candidate accepts root-owned single-link `0444` or `0644` only. `/etc/baci-savings-gateway/funding-transition-package-manifest.json` must hash to `packageManifestSha256`; this candidate binds those bytes but does not claim to validate an activation wrapper's import graph. State inputs must each be root-owned, single-link `0400` or `0600` regular files with a safe root-owned ancestor chain.

## Checklist

1. Supply the reviewed post-renewal manifest digest; the candidate refuses a digest equal to the predecessor manifest pin.
2. Supply the renewal archive directory name and hashes; the candidate verifies the receipt's predecessor and archived-evidence hashes against the actual archived files.
3. Preserve the literal deadline. The candidate accepts neither a new seven-day lease nor a different ISO timestamp.
4. Supply an identity with only the nine declared hosted-funding routes. No implicit or extra route is accepted.
5. Ensure `/var/lib/baci-savings-gateway-install/funding-transition-receipt.json` is absent. A future root wrapper must create it with `O_EXCL` only after activation and final deadline proof.

`render_provenance` defines the intended receipt payload only. It does not create a file.

## Owner Diagnostic

`funding-gateway-owner-diagnostic.py --check` is read-only and root-only. It emits validated keyed systemd state, fixed receipt, unit, managed-gateway, and binding SHA-256 metadata, the binding expiry epoch, and the one matching renewal archive ID. It emits only the allowlisted journal labels `withdrawn`, `stopped`, or `unclassified`; it never prints journal lines, receipt contents, environment values, or secrets. The managed gateway intentionally redacts its internal exception as `withdrawn`; an `unclassified` result is not an invitation to expose raw journal data.
