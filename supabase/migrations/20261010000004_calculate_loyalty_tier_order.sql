-- Evaluate loyalty tiers in threshold order (issue #3165).
--
-- calculate_loyalty_tier iterated loyalty_settings.tiers in stored array
-- order with last-match-wins, while the status route sorts the same ladder
-- by minPoints before computing progression. A merchant with unsorted tier
-- JSON could see enrollment assign one tier while status progress pointed
-- at another. Evaluate in ascending threshold order (stored order breaks
-- ties) so assignment and progress share one ordering. Behavior on the
-- default sorted ladder is unchanged; NULL thresholds sort last and never
-- match, as before. Non-numeric minPoints (merchant JSON is arbitrary)
-- is treated the same as NULL instead of raising mid-transaction.
-- Thresholds compare as NUMERIC so digit strings past the integer range
-- simply never match instead of raising integer out of range. Entries
-- without a usable name are skipped (falling back to the prior tier)
-- instead of assigning NULL, which the API result schema would reject.
CREATE OR REPLACE FUNCTION "public"."calculate_loyalty_tier"("p_lifetime_points" integer, "p_merchant_id" "uuid") RETURNS character varying
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    v_tiers JSONB;
    v_tier JSONB;
    v_result VARCHAR(50) := 'Bronze';
BEGIN
    SELECT tiers INTO v_tiers
    FROM public.loyalty_settings
    WHERE merchant_id = p_merchant_id;

    -- Malformed containers (object/scalar: the settings field persists
    -- without schema validation) fall back like NULL instead of raising
    -- inside jsonb_array_elements and failing every tier call.
    IF v_tiers IS NULL OR jsonb_typeof(v_tiers) <> 'array' THEN
        RETURN 'Bronze';
    END IF;

    FOR v_tier IN
        SELECT t.value AS value
        FROM jsonb_array_elements(v_tiers) WITH ORDINALITY AS t(value, ord)
        ORDER BY
            CASE
                WHEN t.value->>'minPoints' ~ '^-?[0-9]+$'
                THEN (t.value->>'minPoints')::NUMERIC
                ELSE NULL
            END ASC NULLS LAST,
            t.ord
    LOOP
        -- Skip nameless entries: assigning NULL would commit a loyalty
        -- row the API result schema rejects (500 on an enrolled
        -- customer), so fall through to the prior tier instead.
        IF (v_tier->>'minPoints') ~ '^-?[0-9]+$'
           AND p_lifetime_points >= (v_tier->>'minPoints')::NUMERIC
           AND pg_catalog.btrim(COALESCE(v_tier->>'name', '')) <> '' THEN
            v_result := v_tier->>'name';
        END IF;
    END LOOP;

    RETURN v_result;
END;
$$;

-- Close the baseline's anon grant: tier names and thresholds are merchant
-- configuration, enumerable with arbitrary merchant IDs. The
-- authenticated grant stays (accepted tier-ladder enumeration): the
-- invoker's-rights award_purchase_points calls this with the caller's
-- rights, so revoking authenticated would break direct purchase awards.
-- Same shape as the sibling loyalty RPCs.
REVOKE ALL ON FUNCTION public.calculate_loyalty_tier(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_loyalty_tier(integer, uuid)
  TO authenticated, service_role;
