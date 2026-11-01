-- Normalize only the known source block, preserving unrelated function text.
DO $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'private.list_variant_inventory_units(uuid,uuid,uuid,text,text,uuid,integer,timestamptz,uuid)'::regprocedure
  );
  old_block text := $old$      v_count := v_count + 1;
    ELSE
      v_has_more := true;
      v_next_cursor := jsonb_build_object(
        'createdAt', v_row.created_at,
        'id', v_row.id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object($old$;
  crlf_block text := replace(old_block, E'\n', E'\r\n');
BEGIN
  IF position(old_block IN definition) > 0 THEN
    RETURN;
  END IF;
  IF (length(definition) - length(replace(definition, crlf_block, ''))) / length(crlf_block) <> 1 THEN
    RAISE EXCEPTION 'serialized inventory listing source mismatch';
  END IF;
  EXECUTE replace(definition, crlf_block, old_block);
END;
$$;
