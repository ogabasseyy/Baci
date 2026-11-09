2025-05-18 — Custodian: Email Log Scrubbing
Issue: Email PII logged in plaintext in staff invite action, violating data minimization principles.
Learning: Ensure `sanitizeForLog` is applied before logging PII strings.
Prevention: Audit logger calls for PII strings and apply `sanitizeForLog`.
Source: NDPR / Nigeria Data Protection Act 2023
