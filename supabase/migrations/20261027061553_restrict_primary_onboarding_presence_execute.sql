-- Keep onboarding-presence lookup limited to the dedicated provisioner role.
REVOKE EXECUTE ON FUNCTION piggyvest_primary.has_onboarding(jsonb)
  FROM service_role;
