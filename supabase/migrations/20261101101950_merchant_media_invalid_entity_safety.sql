-- Invalid numeric HTML entities are literal text, not a reason to block every
-- media reference scan or to prevent a merchant from editing affected rows.
CREATE OR REPLACE FUNCTION private.merchant_media_reference_text(payload jsonb) RETURNS text
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
   CONTINUE;
  END IF;
  result:=replace(result,'&#'||entity||';',chr(point));
 END LOOP;
 result:=public.blog_media_percent_decode(result);
 RETURN lower(regexp_replace(replace(result,chr(92),'/'),E'[\t\n\r\f]','','g'));
END $$;
