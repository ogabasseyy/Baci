-- Allow the quiz-finalization worker (service_role) to read
-- quiz_prize_reservations during watermark probing and product cache sweeps
-- instead of failing with 42501 on every tick and keeping
-- hasPendingRecoverySweep stuck true.
GRANT SELECT ON TABLE public.quiz_prize_reservations TO service_role;
