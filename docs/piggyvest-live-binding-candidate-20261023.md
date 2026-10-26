# Disabled live binding candidate

Date: 23 October 2026. Review artifact only; not a runtime configuration or executed SQL.

| Field | Observed value | Evidence |
| --- | --- | --- |
| Provider business name | Ogabassey Services Limited | Signed-in Business settings |
| Provider displayed business ID | `01KANDA76ZVWQXDMJ8N507TW8F` | Settings ID label |
| Merchant slug | `ogabassey` | Read-only production merchant query |
| Production merchant ID | `6b5cb8a4-5575-456c-b936-8cdfae30db74` | Same query; do not use the sandbox fixture merchant ID |
| Database project | `aivqthbxdshhltbwipbr` | Connected Baci project and metadata inspection |
| Provider environment candidate | production | Saved live credentials; successful production-origin read |
| Provider keys association | Both stored keys match the dashboard's masked endings | VPS emitted match booleans only |
| Authenticated API business binding | Verified for the observed API wallet | Read-only production wallet-list response contained a business ID matching the dashboard; only availability/match booleans were printed |
| Dashboard mode label | Test Mode Active | Still displayed in the signed-in UI |
| Integration ID | Not allocated | No production integration row exists |
| Activation | Disabled | No service, role, authority or route configuration changed |

Masked suffix comparison alone is association evidence. The additional authenticated production wallet-list GET returned provider success and at least one wallet business ID, with every observed ID matching the dashboard's displayed business ID. This establishes the credential-to-business binding for the tested live API response without exposing wallet details. No wallet was created or modified. Refresh this evidence before eventual cutover, especially after key rotation or changing the active business. This verified binding does not authorize enabling runtime authorities.

Provisioning must reuse existing SQL contracts. Determine the exact provisioner, bank intake, bank worker and evidence logins and approved memberships from the deployed functions; create no broad shared role. Keep authority rows disabled until cutover approval. Keep the onboarding fingerprint key stable across retries and distinct from the provider/relay credentials. Review login expiry against receipt-drain and recovery requirements rather than copying the sandbox lease.

The bank, paid-interest inbox and completion-notification SQL replays now pass after fixture-only setup repairs. Production login/grant readiness still requires its own verification: test fixtures do not provision live logins, establish authority rows or enable payments. Existing migration/table presence alone does not authorize those actions.

The live keys remain in the existing private VPS file. This artifact contains no provider key, login password or generated HMAC secret. No Vercel environment variable was added.
