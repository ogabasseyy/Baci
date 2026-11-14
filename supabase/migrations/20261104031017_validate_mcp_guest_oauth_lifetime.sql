-- Validate in a separate migration transaction, after releasing the DDL lock.
ALTER TABLE public.mcp_guest_oauth_records
  VALIDATE CONSTRAINT mcp_guest_oauth_record_lifetime;
