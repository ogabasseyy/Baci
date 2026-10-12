-- Preserve encoded NUL bytes instead of crashing the sweep.
-- Ordinary stored text can contain the valid escape `%00` (merchant
-- content, query strings, HTTPS image URLs). The decoder turned it
-- into byte zero and called chr(0), which PostgreSQL rejects because
-- text values cannot contain NUL — outside the guarded conversion
-- block, so the exception aborted the whole sweep claim and every
-- cron run failed without reclaiming any tombstones. Byte zero now
-- keeps its literal `%00` spelling: it can never match a managed
-- path, so the scan outcome is identical without the abort.
CREATE OR REPLACE FUNCTION public.blog_media_percent_decode(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_bytes BYTEA;
  v_text TEXT;
  v_unescaped TEXT;
  v_hex TEXT;
  v_byte INTEGER;
  v_changed BOOLEAN;
  v_pass INTEGER;
  v_attempt INTEGER;
BEGIN
  v_unescaped := public.blog_media_json_unescape_slashes(value);
  IF pg_catalog.strpos(v_unescaped, '%') = 0 THEN
    RETURN v_unescaped;
  END IF;
  -- View the raw UTF8 bytes as Latin-1 so every byte is a splicing
  -- character: each %XX becomes the single byte it encodes, and
  -- literal non-ASCII text round-trips untouched. Up to three passes
  -- match the application scan's fixpoint for multiply-encoded URLs.
  v_bytes := pg_catalog.convert_to(v_unescaped, 'UTF8');
  FOR v_attempt IN 1..2 LOOP
    v_text := pg_catalog.convert_from(v_bytes, 'LATIN1');
    FOR v_pass IN 1..3 LOOP
      EXIT WHEN v_text NOT LIKE '%\%%' ESCAPE '\';
      v_changed := FALSE;
      FOR v_hex IN
        SELECT DISTINCT m[1]
          FROM pg_catalog.regexp_matches(
            v_text, '%([0-9A-Fa-f]{2})', 'g') AS m
      LOOP
        v_byte := ('x' || v_hex)::bit(8)::int;
        IF v_byte = 0 THEN
          -- chr(0) raises: NUL cannot live in a text value. The
          -- literal escape survives to the output, where it matches
          -- no managed path.
          CONTINUE;
        END IF;
        IF v_attempt = 2 AND (v_byte < 32 OR v_byte > 126) THEN
          CONTINUE;
        END IF;
        v_text := pg_catalog.replace(
          v_text, '%' || v_hex, pg_catalog.chr(v_byte));
        v_changed := TRUE;
      END LOOP;
      EXIT WHEN NOT v_changed;
    END LOOP;
    BEGIN
      RETURN pg_catalog.convert_from(
        pg_catalog.convert_to(v_text, 'LATIN1'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      -- First attempt only: fall through to the ASCII-only retry.
      -- The retry cannot fail, so reaching it twice returns the
      -- unescaped text.
      IF v_attempt = 2 THEN
        RETURN v_unescaped;
      END IF;
    END;
  END LOOP;
  RETURN v_unescaped;
END;
$function$;

ALTER FUNCTION public.blog_media_percent_decode(TEXT) OWNER TO postgres;
