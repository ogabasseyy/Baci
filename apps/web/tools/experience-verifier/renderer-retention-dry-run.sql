-- Operator-only, read-only pilot report. Bind $1 to a merchant UUID and $2 to the
-- evaluation time. Use a current database snapshot in a READ ONLY transaction.
-- Renderer bytes are estimated stored datum bytes, excluding table overhead.
-- No eligibility, evidence, build, or object is changed by this report.
WITH scope AS (
  SELECT $1::uuid AS merchant_id, $2::timestamptz AS as_of
  WHERE $1::uuid IS NOT NULL AND isfinite($2::timestamptz)
),
published AS (
  SELECT h.build_id
  FROM public.experience_published_heads AS h JOIN scope AS s USING (merchant_id)
),
-- A draft-only transition leaves the published head in place.
publication_events AS (
  SELECT r.id, r.intent_id, r.build_id, r.publication_revision, r.committed_at,
    lead(r.committed_at) OVER (ORDER BY r.publication_revision) AS superseded_at
  FROM experience_authorization.lifecycle_receipts AS r
  JOIN scope AS s USING (merchant_id)
  WHERE r.committed_at <= s.as_of
    AND r.action IN ('publish','rollback','restore-legacy','unpublish-legacy-draft')
),
last_publication AS (
  SELECT DISTINCT ON (build_id) build_id, superseded_at
  FROM publication_events
  WHERE build_id IS NOT NULL
  ORDER BY build_id, publication_revision DESC
),
last_verified_release AS (
  SELECT r.build_id, max(r.publication_revision) AS revision
  FROM publication_events AS r
  JOIN experience_authorization.lifecycle_intents AS i ON i.id = r.intent_id
  CROSS JOIN scope AS s
  WHERE r.build_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM experience_authorization.lifecycle_checks AS c
      WHERE c.receipt_id = r.id AND c.intent_id = i.id AND c.kind = 'public'
        AND c.effect_digest = i.effect_digest
        AND c.verified_at >= r.committed_at AND c.verified_at <= s.as_of
    )
    AND NOT EXISTS (SELECT 1 FROM published AS h WHERE h.build_id = r.build_id)
  GROUP BY r.build_id
),
verified_floor AS (
  SELECT build_id FROM last_verified_release ORDER BY revision DESC LIMIT 3
),
active_references AS (
  SELECT p.build_id::text
  FROM public.experience_preview_bindings AS p JOIN scope AS s USING (merchant_id)
  WHERE NOT p.revoked AND p.expires_at > s.as_of
  UNION
  SELECT a.build_id::text
  FROM experience_authorization.apply_intents AS a JOIN scope AS s USING (merchant_id)
  WHERE a.issued_at <= s.as_of AND a.expires_at > s.as_of
  UNION
  SELECT i.payload->>'buildId'
  FROM experience_authorization.lifecycle_intents AS i JOIN scope AS s USING (merchant_id)
  WHERE i.action IN ('publish','rollback')
    AND i.issued_at <= s.as_of AND i.expires_at > s.as_of
)
SELECT r.job_id, r.attempt_nonce, b.id AS build_id,
  pg_column_size(r.renderer) AS renderer_bytes, history.superseded_at,
  CASE
    WHEN b.id IN (SELECT build_id FROM published) THEN 'keep_published_head'
    WHEN EXISTS (
      SELECT 1 FROM public.experience_draft_heads AS h
      WHERE h.merchant_id = e.merchant_id AND h.build_id = b.id
    ) THEN 'keep_draft_head'
    WHEN j.status IN ('queued','running','verified') THEN 'keep_in_flight'
    WHEN b.id::text IN (SELECT build_id FROM active_references) THEN 'keep_active_reference'
    WHEN b.id IN (SELECT build_id FROM verified_floor) THEN 'keep_verified_floor'
    WHEN history.superseded_at >= s.as_of - interval '720 hours' THEN 'keep_rollback_window'
    WHEN b.id IS NOT NULL AND (
      j.status <> 'finalized' OR j.attempt_nonce <> e.attempt_nonce
      OR b.build_digest <> e.build_digest OR b.host_origin IS DISTINCT FROM e.host_origin
      OR (history.build_id IS NOT NULL AND history.superseded_at IS NULL)
    ) THEN 'keep_uncertain_history'
    WHEN history.build_id IS NOT NULL THEN 'candidate_expired_release'
    WHEN j.status IN ('failed','cancelled') AND b.id IS NULL
      AND greatest(e.verified_at, j.expires_at) < s.as_of - interval '24 hours'
      THEN 'candidate_expired_attempt'
    WHEN b.id IS NOT NULL AND e.verified_at < s.as_of - interval '168 hours'
      THEN 'candidate_expired_draft'
    ELSE 'keep_recent_or_unclassified'
  END AS decision
FROM scope AS s
JOIN public.experience_evidence AS e USING (merchant_id)
JOIN experience_authorization.verified_renderers AS r USING (job_id, attempt_nonce)
JOIN public.experience_jobs AS j ON j.id = e.job_id AND j.merchant_id = e.merchant_id
LEFT JOIN public.experience_builds AS b ON b.job_id = j.id AND b.merchant_id = e.merchant_id
LEFT JOIN last_publication AS history ON history.build_id = b.id
ORDER BY r.job_id, r.attempt_nonce;
