# Oxygen application popup and funnel

The existing checkout payment selector is unchanged. After Begin Process saves
the unpaid order, its owned checkout route opens the application dialog. Closing
it returns to checkout; Continue application reopens it. Native dialog focus
containment, Escape dismissal and a scrollable full-screen mobile layout apply.
Partial form values autosave as encrypted server drafts for the same authenticated
customer and workflow. Closing, reloading or following a secure chat continuation
link restores that draft. No sensitive values are stored in browser storage.
Consent, OTPs and bank verification results are never restored. See
[AUTOSAVE.md](AUTOSAVE.md) for storage and deployment requirements.
Activation and settlement remain disabled in the existing runtime contracts.

## Events

Events use the existing lazy PostHog client sink. Every event is prefixed
`oxygen_application_` and carries only `order_id`, `provider: oxygen`, `stage`,
and, for action events, the action enum. No identity, bank, address, document,
consent payload, provider URL or raw error text is sent by this instrumentation.

| Suffix | Meaning |
| --- | --- |
| opened | Application dialog opened or reopened |
| closed | Customer dismissed the dialog; application can resume |
| page_left | Page exited while the dialog was open; best effort |
| stage_reached | Initial or changed workflow stage, or identity/bank/income step |
| step_completed | Local identity or bank section validation passed |
| action_started | Authenticated runtime command submitted |
| action_response_received | API returned a parsed snapshot; pending is not proof of provider completion |
| action_unconfirmed | Submission failed or response was indeterminate; reconciliation still applies |
| load_failed | Saved application could not be loaded |

Use order_id to correlate resumes, and the last stage reached to group interrupted
applications. A close/page exit alone is not abandonment. Define drop-offs over
the chosen reporting window as applications with no subsequent progress or
return; distinguish pending provider checks and unconfirmed actions. Local
section completion is not provider KYC verification. Confirm provider results
from server workflow state and reconciliation, not browser telemetry.

PostHog must be configured and analytics permitted for delivery. Local tests
verify event contents and dispatch, not production ingestion or a configured
dashboard. Browser exits, blocked analytics, and network failures make client
telemetry incomplete; do not use it for payment/accounting decisions.
