BEGIN;
DO $$
DECLARE document tsvector;
BEGIN
  document := public.product_discovery_search_document('Generic item', 'Acme', 'Accessories',
    'gaming', '{"product_type":"phone","model":"ZX-42","attributes":{"storage_gb":256,"ram_gb":16,"power_w":65}}'::jsonb);
  IF NOT document @@ plainto_tsquery('simple', 'ZX-42 gaming') THEN
    RAISE EXCEPTION 'Combined model/marketing retrieval failed';
  END IF;
  IF NOT document @@ plainto_tsquery('simple', '256GB phone') OR
     NOT document @@ plainto_tsquery('simple', '256 GB phone') OR
     NOT document @@ plainto_tsquery('simple', '65W Acme') THEN
    RAISE EXCEPTION 'Canonical unit lexeme retrieval failed';
  END IF;
  IF document @@ plainto_tsquery('simple', '512GB phone') THEN
    RAISE EXCEPTION 'Search document fabricated a numeric specification';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.search_product_discovery_facts(uuid,text,integer,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'Fact retrieval must preserve invoker RLS';
  END IF;
END;
$$;
ROLLBACK;
