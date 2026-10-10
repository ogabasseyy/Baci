-- Decode JSON string escapes (slashes and ASCII unicode) in one
-- left-to-right pass. Structured editor content spells managed
-- image sources with escaped slashes (`\/`, `\u002f`) and escaped
-- URL characters (`\u0074oken`, `\u0025`), which the storefront's
-- JSON.parse resolves to the live URL. The previous helper decoded
-- slash spellings only, so the reference scan missed the literal
-- candidate path, the save registered nothing, and the upload's
-- tombstone expired onto a live image. Only ASCII escapes decode:
-- managed URLs cannot contain higher planes unencoded, and decoding
-- stops at `\u00ff`, so surrogate pairs and astral codepoints stay
-- literal instead of risking invalid chr() calls. `\u0000` stays
-- literal because NUL cannot live in a text value. Output is never
-- rescanned, so a decoded backslash (`\u005c`) cannot start a new
-- escape — exactly JSON.parse behavior for this subset. Backslashes
-- spell via chr(92) throughout so no literal depends on escape
-- string syntax.
CREATE OR REPLACE FUNCTION public.blog_media_json_unescape_string(
  value TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_backslash TEXT := pg_catalog.chr(92);
  v_out TEXT := '';
  v_rest TEXT := value;
  v_pos INTEGER;
  v_hex TEXT;
BEGIN
  LOOP
    v_pos := pg_catalog.strpos(v_rest, v_backslash);
    IF v_pos = 0 THEN
      RETURN v_out || v_rest;
    END IF;
    v_out := v_out || pg_catalog.substring(v_rest, 1, v_pos - 1);
    v_rest := pg_catalog.substring(v_rest, v_pos + 1);
    IF pg_catalog.substring(v_rest, 1, 1) = '/' THEN
      v_out := v_out || '/';
      v_rest := pg_catalog.substring(v_rest, 2);
    ELSIF pg_catalog.substring(v_rest, 1, 5) ~
        '^u00[0-9A-Fa-f][0-9A-Fa-f]$'
        AND pg_catalog.substring(v_rest, 4, 2) <> '00' THEN
      v_hex := pg_catalog.substring(v_rest, 4, 2);
      v_out := v_out || pg_catalog.chr(('x' || v_hex)::bit(8)::int);
      v_rest := pg_catalog.substring(v_rest, 6);
    ELSE
      -- Not a decodable escape: the backslash stays literal and the
      -- scan continues after it. Decoded output is never re-entered,
      -- so escapes cannot chain.
      v_out := v_out || v_backslash;
    END IF;
  END LOOP;
END;
$function$;

ALTER FUNCTION public.blog_media_json_unescape_string(TEXT)
  OWNER TO postgres;

-- Re-point percent-decoding at the wider unescape, carrying the NUL
-- guard forward: byte zero still keeps its literal `%00` spelling
-- instead of calling chr(0) outside the exception block.
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
  v_unescaped := public.blog_media_json_unescape_string(value);
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
