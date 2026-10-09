-- Decode HTML character references before the JSON and percent
-- stages. Persisted markup spells URLs with entities (`tok&#x65;
-- n.webp`), which HTML parsing resolves to the live URL: without
-- decoding, the claim scan misses the candidate path and the sweep
-- deletes rendered media. Numeric references decode with or without
-- the semicolon (the parser flags the missing terminator but still
-- resolves the longest digit run); named references keep requiring
-- it. Codepoints cover the full scalar range while unknown names
-- stay literal, mirroring the TypeScript decoder exactly (same six
-- named entities, same NUL/surrogate/range preservation). Entities
-- decode first because they can reveal JSON escapes (`&#x5c;
-- u002f`) and percent escapes (`&#x25;32`) the later stages then
-- handle. Significant digit runs cap at 7 decimal / 6 hex digits so
-- the casts below can never overflow — longer runs always exceed
-- the scalar range and stay literal in both layers.
CREATE OR REPLACE FUNCTION public.blog_media_decode_html_entities(
  value TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  v_out TEXT := '';
  v_rest TEXT := value;
  v_pos INTEGER;
  v_semi INTEGER;
  v_body TEXT;
  v_digits TEXT;
  v_stripped TEXT;
  v_consumed INTEGER;
  v_point INTEGER;
BEGIN
  LOOP
    v_pos := pg_catalog.strpos(v_rest, '&');
    IF v_pos = 0 THEN
      RETURN v_out || v_rest;
    END IF;
    v_out := v_out || pg_catalog.substring(v_rest, 1, v_pos - 1);
    v_rest := pg_catalog.substring(v_rest, v_pos + 1);
    IF v_rest ~ '^#[0-9]' THEN
      -- Greedy decimal run with an optional terminator.
      v_digits := pg_catalog.substring(v_rest, '^#([0-9]+)');
      v_consumed := 1 + pg_catalog.length(v_digits);
      IF pg_catalog.substring(v_rest, v_consumed + 1, 1) = ';' THEN
        v_consumed := v_consumed + 1;
      END IF;
      v_body := pg_catalog.substring(v_rest, 1, v_consumed);
      v_rest := pg_catalog.substring(v_rest, v_consumed + 1);
      -- Leading zeros carry no value; stripping them first keeps
      -- `&#0000065` decodable while over-long runs stay literal.
      v_stripped := pg_catalog.ltrim(v_digits, '0');
      IF v_stripped = '' THEN
        v_stripped := '0';
      END IF;
      IF pg_catalog.length(v_stripped) > 7 THEN
        v_out := v_out || '&' || v_body;
      ELSE
        v_point := v_stripped::integer;
        IF v_point = 0
          OR v_point > 1114111
          OR (v_point >= 55296 AND v_point <= 57343)
        THEN
          v_out := v_out || '&' || v_body;
        ELSE
          v_out := v_out || pg_catalog.chr(v_point);
        END IF;
      END IF;
    ELSIF v_rest ~ '^#[xX][0-9A-Fa-f]' THEN
      -- Greedy hex run with an optional terminator.
      v_digits := pg_catalog.substring(v_rest, '^#[xX]([0-9A-Fa-f]+)');
      v_consumed := 2 + pg_catalog.length(v_digits);
      IF pg_catalog.substring(v_rest, v_consumed + 1, 1) = ';' THEN
        v_consumed := v_consumed + 1;
      END IF;
      v_body := pg_catalog.substring(v_rest, 1, v_consumed);
      v_rest := pg_catalog.substring(v_rest, v_consumed + 1);
      v_stripped := pg_catalog.ltrim(v_digits, '0');
      IF v_stripped = '' THEN
        v_stripped := '0';
      END IF;
      IF pg_catalog.length(v_stripped) > 6 THEN
        v_out := v_out || '&' || v_body;
      ELSE
        -- Pad to a full 8 digits: bit(32) right-pads short input,
        -- which would inflate the value out of range.
        v_point := ('x' || pg_catalog.lpad(v_stripped, 8, '0'))::bit(32)::integer;
        IF v_point = 0
          OR v_point > 1114111
          OR (v_point >= 55296 AND v_point <= 57343)
        THEN
          v_out := v_out || '&' || v_body;
        ELSE
          v_out := v_out || pg_catalog.chr(v_point);
        END IF;
      END IF;
    ELSE
      v_semi := pg_catalog.strpos(v_rest, ';');
      IF v_semi = 0 OR v_semi > 12 THEN
        -- No terminator in entity range: the ampersand stays
        -- literal and the scan continues after it.
        v_out := v_out || '&';
        CONTINUE;
      END IF;
      v_body := pg_catalog.substring(v_rest, 1, v_semi - 1);
      v_rest := pg_catalog.substring(v_rest, v_semi + 1);
      IF v_body = 'amp' THEN
        v_out := v_out || '&';
      ELSIF v_body = 'lt' THEN
        v_out := v_out || '<';
      ELSIF v_body = 'gt' THEN
        v_out := v_out || '>';
      ELSIF v_body = 'quot' THEN
        v_out := v_out || '"';
      ELSIF v_body = 'apos' THEN
        v_out := v_out || pg_catalog.chr(39);
      ELSIF v_body = 'nbsp' THEN
        v_out := v_out || pg_catalog.chr(160);
      ELSE
        v_out := v_out || '&' || v_body || ';';
      END IF;
    END IF;
  END LOOP;
END;
$function$;

ALTER FUNCTION public.blog_media_decode_html_entities(TEXT)
  OWNER TO postgres;

-- Chain entity decoding in front of the JSON and percent stages,
-- carrying the NUL guard forward.
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
  v_unescaped := public.blog_media_json_unescape_string(
    public.blog_media_decode_html_entities(value)
  );
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
