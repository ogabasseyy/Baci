-- Durable safe recovery state, independent of the diagnostic retention window.
-- No customer/worker API clears it: clearing requires confirmed reconciliation.
CREATE TABLE oxygen_private.booking_blocks (
 workflow_id uuid PRIMARY KEY REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
 command_id uuid NOT NULL REFERENCES oxygen_private.commands(id),
 code text NOT NULL CHECK (code='active_loan'),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oxygen_booking_blocks_command_idx ON oxygen_private.booking_blocks(command_id);
ALTER TABLE oxygen_private.booking_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oxygen_private.booking_blocks FROM PUBLIC,anon,authenticated;

-- A matching diagnostic is written only after the bound worker finishes a
-- definitely rejected book command. The existing transaction holds the workflow lock.
CREATE FUNCTION oxygen_private.retain_booking_block()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.diagnostic->>'operation'='book'
  AND NEW.diagnostic->>'kind'='http'
  AND NEW.diagnostic->>'outcome'='rejected'
  AND NEW.diagnostic->'httpStatus'='400'::jsonb
  AND NEW.diagnostic->>'providerMessage'='User has an active loan'
  AND EXISTS (SELECT 1 FROM oxygen_private.commands c
    WHERE c.id=NEW.command_id AND c.workflow_id=NEW.workflow_id
      AND c.command->>'action'='book' AND c.status='failed') THEN
  INSERT INTO oxygen_private.booking_blocks(workflow_id,command_id,code)
   VALUES(NEW.workflow_id,NEW.command_id,'active_loan')
   ON CONFLICT(workflow_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.retain_booking_block() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER retain_oxygen_booking_block AFTER INSERT ON oxygen_private.attempt_diagnostics
FOR EACH ROW EXECUTE FUNCTION oxygen_private.retain_booking_block();

-- Recover already recorded rejections; never infer a blocker from an HTTP 500,
-- timeout, unconfirmed result, or a different operation/message.
INSERT INTO oxygen_private.booking_blocks(workflow_id,command_id,code)
SELECT DISTINCT ON (d.workflow_id) d.workflow_id,d.command_id,'active_loan'
FROM oxygen_private.attempt_diagnostics d
JOIN oxygen_private.commands c ON c.id=d.command_id AND c.workflow_id=d.workflow_id
WHERE d.diagnostic->>'operation'='book' AND d.diagnostic->>'kind'='http'
 AND d.diagnostic->>'outcome'='rejected' AND d.diagnostic->'httpStatus'='400'::jsonb
 AND d.diagnostic->>'providerMessage'='User has an active loan'
 AND c.command->>'action'='book' AND c.status='failed'
ORDER BY d.workflow_id,d.recorded_at DESC
ON CONFLICT(workflow_id) DO NOTHING;

-- Extend the installed function narrowly, preserving its identity/tenant checks,
-- workflow locking, pending-intent protections and disabled financial flags.
DO $migration$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.runtime(text,uuid,jsonb)'::regprocedure);
 needle:='''executionEnabled'',coalesce(b.enabled,false)';
 IF position(needle IN definition)=0
  OR position('  INSERT INTO oxygen_private.commands(workflow_id' IN definition)=0
  OR position('  v_result:=oxygen_private.claim_command(c.id);' IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected Oxygen runtime definition';
 END IF;
 definition:=replace(definition,needle,
  '''bookingBlock'',(SELECT code FROM oxygen_private.booking_blocks WHERE workflow_id=w.id),'||needle);
 definition:=replace(definition,'  INSERT INTO oxygen_private.commands(workflow_id',
  '  IF v_action=''book'' AND EXISTS (SELECT 1 FROM oxygen_private.booking_blocks WHERE workflow_id=w.id) THEN
    RAISE EXCEPTION ''Booking requires provider reconciliation'' USING ERRCODE=''55000'';
  END IF;
  INSERT INTO oxygen_private.commands(workflow_id');
 definition:=replace(definition,'  v_result:=oxygen_private.claim_command(c.id);',
  '  IF c.command->>''action''=''book'' AND EXISTS (SELECT 1 FROM oxygen_private.booking_blocks WHERE workflow_id=w.id) THEN
    RAISE EXCEPTION ''Booking requires provider reconciliation'' USING ERRCODE=''55000'';
  END IF;
  v_result:=oxygen_private.claim_command(c.id);');
 EXECUTE definition;
END $migration$;
NOTIFY pgrst,'reload schema';
