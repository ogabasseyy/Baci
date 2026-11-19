-- Claim-activity recording resolves fallback hashes, not just the
-- current token: same-recipient retries rotate token_hash while the
-- mailed link survives on previous/delivered grace. Recording clicks,
-- login starts, and app-download taps only against token_hash silently
-- drops the funnel rows for the mailed link whenever a retry rotated
-- after acceptance. Preview and redemption already resolve all three
-- hashes; activity follows so attribution matches resolution.
-- Historical hashes revoked by a recipient correction match nothing
-- (the rotation clears them), so no leak reopens here.

CREATE OR REPLACE FUNCTION private.record_receipt_claim_click_v2(
  p_token_hash text,
  p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text := CASE
    WHEN lower(btrim(COALESCE(p_source, ''))) IN ('web', 'app')
      THEN lower(btrim(p_source))
    ELSE 'unknown'
  END;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RETURN;
  END IF;

  UPDATE public.receipt_claims
  SET first_clicked_at = COALESCE(first_clicked_at, now()),
      last_clicked_at = now(),
      first_click_source = CASE
        WHEN first_clicked_at IS NULL THEN v_source
        ELSE first_click_source
      END,
      last_click_source = v_source,
      last_viewed_at = now(),
      click_count = click_count + 1,
      updated_at = now()
  WHERE (token_hash = p_token_hash
      OR previous_token_hash = p_token_hash
      OR delivered_token_hash = p_token_hash)
    AND notification_sent_at IS NOT NULL
    AND expires_at > now();
END;
$$;

REVOKE ALL ON FUNCTION private.record_receipt_claim_click_v2(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.record_receipt_claim_click_v2(text, text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.record_receipt_claim_login_started_v2(
  p_token_hash text,
  p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text := CASE
    WHEN lower(btrim(COALESCE(p_source, ''))) IN ('web', 'app')
      THEN lower(btrim(p_source))
    ELSE 'unknown'
  END;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RETURN;
  END IF;

  UPDATE public.receipt_claims
  SET first_login_started_at = COALESCE(first_login_started_at, now()),
      last_login_started_at = now(),
      first_login_started_source = CASE
        WHEN first_login_started_at IS NULL THEN v_source
        ELSE first_login_started_source
      END,
      last_login_started_source = v_source,
      last_viewed_at = now(),
      login_started_count = login_started_count + 1,
      updated_at = now()
  WHERE (token_hash = p_token_hash
      OR previous_token_hash = p_token_hash
      OR delivered_token_hash = p_token_hash)
    AND notification_sent_at IS NOT NULL
    AND expires_at > now();
END;
$$;

REVOKE ALL ON FUNCTION private.record_receipt_claim_login_started_v2(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.record_receipt_claim_login_started_v2(text, text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.record_receipt_claim_app_download_clicked_v2(
  p_token_hash text,
  p_source text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source text := CASE
    WHEN lower(btrim(COALESCE(p_source, ''))) IN ('app_store', 'play_store')
      THEN lower(btrim(p_source))
    ELSE 'unknown'
  END;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RETURN;
  END IF;

  UPDATE public.receipt_claims
  SET first_app_download_clicked_at = COALESCE(
        first_app_download_clicked_at,
        now()
      ),
      last_app_download_clicked_at = now(),
      first_app_download_source = CASE
        WHEN first_app_download_clicked_at IS NULL THEN v_source
        ELSE first_app_download_source
      END,
      last_app_download_source = v_source,
      last_viewed_at = now(),
      app_download_click_count = app_download_click_count + 1,
      updated_at = now()
  WHERE (token_hash = p_token_hash
      OR previous_token_hash = p_token_hash
      OR delivered_token_hash = p_token_hash)
    AND notification_sent_at IS NOT NULL
    AND expires_at > now();
END;
$$;

REVOKE ALL ON FUNCTION private.record_receipt_claim_app_download_clicked_v2(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.record_receipt_claim_app_download_clicked_v2(text, text)
  TO anon, authenticated;
