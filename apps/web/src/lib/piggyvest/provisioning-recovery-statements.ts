export const PIGGYVEST_PROVISIONING_RECOVERY_STATEMENTS = {
  readCustomerMapping: {
    text: 'SELECT outcome, provider_customer_id FROM piggyvest_staging.read_customer_mapping($1::uuid, $2::uuid, $3::uuid, $4::text)',
    parameters: 4,
    roles: ['piggyvest_staging_provisioner'],
  },
  recordCreatedCustomer: {
    text: 'SELECT piggyvest_staging.record_created_customer($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::text) AS outcome',
    parameters: 7,
    roles: ['piggyvest_staging_provisioner'],
  },
  beginProvisioningVerification: {
    text: 'SELECT verification_token, provider_wallet_id, completed FROM piggyvest_staging.begin_provisioning_verification($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text)',
    parameters: 6,
    roles: ['piggyvest_staging_provisioner'],
  },
  confirmProvisioningRecovery: {
    text: 'SELECT piggyvest_staging.confirm_provisioning_recovery($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::uuid, $8::text, $9::text, $10::text, $11::text) AS outcome',
    parameters: 11,
    roles: ['piggyvest_staging_provisioner'],
  },
  readProvisioningRecovery: {
    text: 'SELECT intent_id, merchant_id, customer_id, goal_id, operation, status, provider_customer_id, provider_wallet_id, dispatch_provider_customer_id FROM piggyvest_staging.read_provisioning_recovery($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text)',
    parameters: 6,
    roles: ['piggyvest_staging_provisioner'],
  },
  observeProvisioningRecovery: {
    text: 'SELECT piggyvest_staging.observe_provisioning_recovery($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::text, $8::text, $9::text, $10::text) AS outcome',
    parameters: 10,
    roles: ['piggyvest_staging_provisioner'],
  },
} as const;
