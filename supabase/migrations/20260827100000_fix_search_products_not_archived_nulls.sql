-- Keep the append-only search_products_v2 source immutable while making its
-- not_archived filter include legacy products whose status is still NULL.
DO $migration$
DECLARE
  v_original_definition text;
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.search_products_v2(text,uuid,integer,integer,text,uuid,text,text,numeric,numeric,double precision,text,boolean,text)'::regprocedure
  ) INTO v_original_definition;

  IF v_original_definition IS NULL THEN
    RAISE EXCEPTION 'search_products_v2 function is missing';
  ELSIF v_original_definition LIKE '%p.status IS NULL OR p.status <> ''archived''%' THEN
    -- The repair is already installed. This makes history recovery and
    -- manually retried migration application a safe no-op.
    NULL;
  ELSE
    v_definition := replace(
      v_original_definition,
      E'OR (status_filter = ''not_archived'' AND p.status <> ''archived'')',
      E'OR (status_filter = ''not_archived'' AND (p.status IS NULL OR p.status <> ''archived''))'
    );

    IF v_definition = v_original_definition
      OR v_definition NOT LIKE '%p.status IS NULL OR p.status <> ''archived''%'
    THEN
      RAISE EXCEPTION 'search_products_v2 not_archived NULL-safe repair did not apply';
    END IF;

    EXECUTE v_definition;
  END IF;
END;
$migration$;
