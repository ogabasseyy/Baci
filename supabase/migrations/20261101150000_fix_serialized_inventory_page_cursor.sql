-- The lookahead row establishes hasMore; it must not become the cursor,
-- otherwise the strict next-page predicate drops that unseen row.
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
  new_block text := $new$      v_count := v_count + 1;
      v_next_cursor := jsonb_build_object(
        'createdAt', v_row.created_at,
        'id', v_row.id
      );
    ELSE
      v_has_more := true;
    END IF;
  END LOOP;

  IF NOT v_has_more THEN
    v_next_cursor := NULL;
  END IF;

  RETURN jsonb_build_object($new$;
BEGIN
  IF (length(definition) - length(replace(definition, old_block, ''))) / length(old_block) <> 1 THEN
    RAISE EXCEPTION 'serialized inventory listing source mismatch';
  END IF;
  EXECUTE replace(definition, old_block, new_block);
END;
$$;
