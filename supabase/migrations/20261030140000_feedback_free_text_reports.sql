-- In-app "Send feedback" reports are free text with no star rating, and carry
-- the screen and device they were sent from so issues can be reproduced.
ALTER TABLE public.feedback ALTER COLUMN rating DROP NOT NULL;

ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS screen text;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS device text;
