-- Preserve valid path decodes despite unrelated invalid bytes. The
-- whole-field decoder below replaced every escape and then converted
-- to UTF-8 in one step: a single undecodable run (a bare %FF) failed
-- the conversion, the exception path returned the entire original
-- field, and the claim scan missed a valid encoded reference such as
-- %74oken.webp — marking the live object unreferenced and permitting
-- the worker to delete it. Decoding now runs in two attempts: first
-- every escape (multi-byte escapes like %C3%A9 must still resolve
-- when the field is otherwise clean), then — when undecodable bytes
-- poison the whole-field conversion — only printable-ASCII escapes,
-- so valid path references survive independently of malformed
-- escapes elsewhere. The retry only substitutes ASCII bytes for
-- ASCII bytes on valid UTF-8, which cannot fail; escapes that match
-- no pass (%ZZ, a trailing %) stay literal as before.
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
  v_hex TEXT;
  v_byte INTEGER;
  v_changed BOOLEAN;
  v_pass INTEGER;
  v_attempt INTEGER;
BEGIN
  IF pg_catalog.strpos(value, '%') = 0 THEN
    RETURN value;
  END IF;
  -- View the raw UTF8 bytes as Latin-1 so every byte is a splicing
  -- character: each %XX becomes the single byte it encodes, and
  -- literal non-ASCII text round-trips untouched. Up to three passes
  -- match the application scan's fixpoint for multiply-encoded URLs.
  v_bytes := pg_catalog.convert_to(value, 'UTF8');
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
      -- The retry cannot fail, so reaching it twice returns raw.
      IF v_attempt = 2 THEN
        RETURN value;
      END IF;
    END;
  END LOOP;
  RETURN value;
END;
$function$;

ALTER FUNCTION public.blog_media_percent_decode(TEXT) OWNER TO postgres;
