export const DEVICE_CHANGE_STATEMENTS = {
  publishDeviceChange: {
    text: 'SELECT piggyvest_device_change.publish($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::jsonb) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  confirmDeviceChange: {
    text: 'SELECT piggyvest_device_change.confirm($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::jsonb) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
  readDeviceChange: {
    text: 'SELECT piggyvest_device_change.read($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
    parameters: 7,
    roles: ['piggyvest_staging_policy_writer'],
  },
} as const;
