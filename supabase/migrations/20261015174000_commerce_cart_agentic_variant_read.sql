-- Let the merchant-scoped agentic checkout client read the variants of
-- its own merchant: the final product_variants SELECT policy only
-- recognizes merchant owners/staff via auth.uid(), so explicit UCP
-- variant lanes and variant-UUID shorthand resolved to an empty set
-- under RLS and were rejected as invalid. This mirrors the existing
-- agentic scoped-access pattern (20260430142500): authenticated role,
-- agentic checkout context, and the JWT's merchant claim must match.
CREATE POLICY "Agentic checkout variants are readable by scoped client"
  ON public.product_variants
  FOR SELECT
  TO authenticated
  USING (
    public.is_agentic_checkout_context()
    AND merchant_id = public.current_agentic_merchant_id()
  );
