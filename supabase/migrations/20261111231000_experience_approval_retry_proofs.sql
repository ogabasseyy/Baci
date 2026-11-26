-- Each independently captured proof has its own timestamp. Confirmation keeps
-- checking effect, issue time and expiry against the unchanged owner intent.
ALTER TABLE experience_authorization.approval_checks
  DROP CONSTRAINT approval_checks_pkey,
  ADD CONSTRAINT approval_checks_pkey PRIMARY KEY (intent_id, verified_at);
