-- #3669: permanent deletion admission, never storage.objects mutation.
CREATE TABLE private.merchant_media_delete_claims (
 path text PRIMARY KEY, merchant_id uuid NOT NULL, object_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','deleted')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
CREATE INDEX merchant_media_delete_claims_merchant_idx ON private.merchant_media_delete_claims(merchant_id);
CREATE INDEX merchant_media_delete_claims_object_idx ON private.merchant_media_delete_claims(object_id);
ALTER TABLE private.merchant_media_delete_claims ENABLE ROW LEVEL SECURITY;
CREATE TABLE private.merchant_media_reference_gates(id uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 0);
ALTER TABLE private.merchant_media_reference_gates ENABLE ROW LEVEL SECURITY;
CREATE TABLE private.merchant_media_reference_sources(relation regclass PRIMARY KEY);
ALTER TABLE private.merchant_media_reference_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.merchant_media_delete_claims,private.merchant_media_reference_gates,
 private.merchant_media_reference_sources FROM PUBLIC,anon,authenticated,service_role;

-- Decode strings rather than serialized JSON, so escaped slashes/unicode and
-- HTML/URL encodings cannot hide a saved content reference. Matching is deliberately
-- conservative: an ambiguous substring blocks deletion rather than guessing.
CREATE FUNCTION private.merchant_media_reference_text(payload jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text; entity text; point integer;
BEGIN
 SELECT coalesce(string_agg(value #>> '{}', E'\n'),'') INTO result
 FROM pg_catalog.jsonb_path_query(payload,'$.** ? (@.type() == "string")') AS value;
 result:=lower(result);
 result:=replace(replace(replace(replace(replace(result,'&amp;','&'),'&sol;','/'),'&period;','.'),'&percnt;','%'),'&lowbar;','_');
 FOR entity IN SELECT DISTINCT m[1] FROM regexp_matches(result,'&#(x[0-9a-f]{1,6}|[0-9]{1,7});','g') m LOOP
  point:=CASE WHEN left(entity,1)='x' THEN ('x'||lpad(substr(entity,2),8,'0'))::bit(32)::integer ELSE entity::integer END;
  IF point<=0 OR point>1114111 OR point BETWEEN 55296 AND 57343 THEN
   RAISE EXCEPTION 'media_reference_unverifiable' USING ERRCODE='22023';
  END IF;
  result:=replace(result,'&#'||entity||';',chr(point));
 END LOOP;
 result:=public.blog_media_percent_decode(result);
 RETURN lower(regexp_replace(replace(result,chr(92),'/'),E'[\t\n\r\f]','','g'));
END $$;
CREATE FUNCTION private.merchant_media_reference_ids(payload text) RETURNS uuid[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT m[1]::uuid ORDER BY m[1]::uuid),'{}'::uuid[])
 FROM regexp_matches(payload,'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})','g') m
$$;
-- Updating a durable gate also serializes REPEATABLE READ/SERIALIZABLE callers:
-- a stale snapshot receives a serialization error, not an invisible new claim.
CREATE FUNCTION private.lock_merchant_media_references(ids uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE identity uuid;
BEGIN
 FOR identity IN SELECT DISTINCT value FROM unnest(ids) value ORDER BY value LOOP
  INSERT INTO private.merchant_media_reference_gates AS gates(id) VALUES(identity)
  ON CONFLICT(id) DO UPDATE SET revision=gates.revision+1;
 END LOOP;
END $$;
CREATE FUNCTION private.can_manage_merchant_media(merchant uuid,path text,reading boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND
 (EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=merchant AND m.user_id=auth.uid())
 OR public.check_staff_permission(auth.uid(),merchant,'products',CASE WHEN reading THEN 'view' ELSE 'delete' END)
 OR (path LIKE merchant::text||'/blog/%' AND public.check_staff_permission(auth.uid(),merchant,'marketing','edit')))
$$;
REVOKE ALL ON FUNCTION private.merchant_media_reference_text(jsonb),private.merchant_media_reference_ids(text),
 private.lock_merchant_media_references(uuid[]),private.can_manage_merchant_media(uuid,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
