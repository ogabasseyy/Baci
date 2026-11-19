-- Authenticated callers can insert feedback directly under RLS, so the API's
-- length caps (apps/web/src/schemas/feedback-report.ts) are enforced here too.
-- The message cap is NOT VALID so any older rows are left as they are while
-- every new or updated row is checked. screen and device are new columns
-- (20261030140000_feedback_free_text_reports), so their caps validate now.
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_screen_length_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_screen_length_check
  CHECK (screen IS NULL OR char_length(screen) <= 200);

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_device_length_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_device_length_check
  CHECK (device IS NULL OR char_length(device) <= 120);

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_message_length_check;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_message_length_check
  CHECK (message IS NULL OR char_length(message) <= 4000) NOT VALID;
