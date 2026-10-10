-- Evaluate loyalty tiers in threshold order (issue #3165).
--
-- calculate_loyalty_tier iterated loyalty_settings.tiers in stored array
-- order with last-match-wins, while the status route sorts the same ladder
-- by minPoints before computing progression. A merchant with unsorted tier
-- JSON could see enrollment assign one tier while status progress pointed
-- at another. Evaluate in ascending threshold order (stored order breaks
-- ties) so assignment and progress share one ordering. Behavior on the
-- default sorted ladder is unchanged; NULL thresholds sort last and never
-- match, as before.
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

    IF v_tiers IS NULL THEN
        RETURN 'Bronze';
    END IF;

    FOR v_tier IN
        SELECT t.value AS value
        FROM jsonb_array_elements(v_tiers) WITH ORDINALITY AS t(value, ord)
        ORDER BY (t.value->>'minPoints')::INTEGER ASC NULLS LAST, t.ord
    LOOP
        IF p_lifetime_points >= (v_tier->>'minPoints')::INTEGER THEN
            v_result := v_tier->>'name';
        END IF;
    END LOOP;

    RETURN v_result;
END;
$$;
