-- Ignore the DNS root label in the deduplication key while preserving verified URL bytes.
CREATE OR REPLACE FUNCTION private.brilstash_image_url_key(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT CASE WHEN parts[1] IS NOT NULL AND char_length(rtrim(parts[1], '.')) <= 253
      AND COALESCE(parts[2]::integer, 443) <= 65535
      AND p_url COLLATE "C" !~ '[^!-~]' AND strpos(p_url, '#') = 0 AND strpos(p_url, chr(92)) = 0
    THEN 'https://' || lower(rtrim(parts[1], '.') COLLATE "C")
      || CASE WHEN COALESCE(parts[2]::integer, 443) = 443 THEN '' ELSE ':' || (parts[2]::integer)::text END
      || CASE WHEN left(parts[3], 1) = '/' THEN parts[3] ELSE '/' || COALESCE(parts[3], '') END END
  FROM (
    SELECT regexp_match(p_url COLLATE "C",
      '^https://((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?[.]?)(?::([0-9]{1,5}))?([/?].*)?$', 'i') AS parts
  ) matched
$$;
