-- Match the bounded open queue scan without sorting closed follow-up history.
CREATE INDEX IF NOT EXISTS order_follow_ups_open_due_idx
  ON public.order_follow_ups (merchant_id, follow_up_on ASC NULLS LAST, order_id)
  WHERE stage <> 'closed';
