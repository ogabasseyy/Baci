# Down-payment staging probe — 2026-10-24

User authorized one 30% and one decimal percentage test on the existing staging application, without cancellation, approval, activation or settlement.

- Application: `27e7fcb7-c924-45fd-ace0-d69a549023d0`.
- Workflow: `d3bf1b69-ec6e-4f1c-ae9c-044a8fdb7f17`.
- Both requests used the existing NGN396,000 order and three-month tenure.
- 30%: HTTP 400, provider outcome rejected. No validated new booking reference. This probe retained status/outcome but did not retain the provider message. Do not infer its cause or repeat it to recover the message.
- 37.25%: HTTP 400, provider outcome rejected. Captured sanitized message: “Failed to fetch loan history. Please try again later.” No validated new booking reference.
- Neither produced a confirmed repayment schedule or charges. Do not fabricate these from proportional calculations or overwrite cached confirmed plans.
- Canonical booking and reconciliation hold remained unchanged. Older indeterminate command fingerprints remained unchanged after each probe. Activation and settlement flags remained false. No approval operation or cancellation was called.
- Separate private exclusive locks and intent/result evidence exist for each probe; do not replay either script. The initial local startup failure happened at customer sign-in, before any provider call, and has a separate no-provider-call lock record.
- Browser security policy blocked checkout-tab acquisition. No popup screenshot or rendered verification was possible in this turn. Existing confirmed 25%, 35%, 50% cache remains unchanged.

Oxygen documents 25–90% inclusive with at most two decimal places. These failures do not establish that 30% or 37.25% is unsupported; the decimal response identifies a loan-history fetch failure.
