-- Local transactional fixture. Run with -v install_guard=false for the regression's RED case.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.agentic_cart_sessions(cart_id text PRIMARY KEY,cart_items jsonb,updated_at timestamptz NOT NULL);
INSERT INTO public.agentic_cart_sessions VALUES('fixture','[]','2026-10-14 00:00:00+00');
\if :install_guard
\ir ../migrations/20261014140001_agentic_cart_revision_guard.sql
\endif
DO $$ DECLARE old_revision timestamptz; affected integer; BEGIN
 SELECT updated_at INTO old_revision FROM public.agentic_cart_sessions WHERE cart_id='fixture';
 -- Simulate two replacements whose application timestamps are identical.
 UPDATE public.agentic_cart_sessions SET cart_items='["first"]',updated_at=old_revision WHERE cart_id='fixture' AND updated_at=old_revision;
 UPDATE public.agentic_cart_sessions SET cart_items='["stale-second"]',updated_at=old_revision WHERE cart_id='fixture' AND updated_at=old_revision;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'stale replacement overwrote the committed cart within the same clock tick'; END IF;
 IF (SELECT cart_items FROM public.agentic_cart_sessions WHERE cart_id='fixture') <> '["first"]' THEN RAISE EXCEPTION 'committed cart lost'; END IF;
END $$;
ROLLBACK;
