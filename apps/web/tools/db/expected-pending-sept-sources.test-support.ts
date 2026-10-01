import { EXPECTED_IMMEDIATE_NOTIFICATION_PENDING_SOURCES } from './expected-immediate-notification-pending-sources.test-support';

export const EXPECTED_PENDING_SEPT_SOURCES = [
  ...EXPECTED_IMMEDIATE_NOTIFICATION_PENDING_SOURCES,
  {
    repositoryPath: 'supabase/migrations/20260921180000_get_santa_catalog.sql',
    sha256: 'ccb69b3c76fc8fccdd2832177f66e2fb508afef422f554adf0ba9d792a58b19a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922120100_verify_payment_reference_token_rpc.sql',
    sha256: '16fee07c93035f58783ea0dcde7688b7c8155adedeb522b5dee446a3e932ba1d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922210000_guest_payment_reference_snapshot.sql',
    sha256: '1c8a5b5eaa76aa70b3f14f8d4772f013e53d3275bd6aec4b9608ab2a5f3c77d3',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922220000_guest_payment_reference_snapshot_minimal.sql',
    sha256: '02eeeffc747952e75c15025baa6556ae1013da364c698cd8e3261df43a706d38',
  },
  {
    repositoryPath:
      'supabase/migrations/20260923120000_guest_snapshot_inventory_proof.sql',
    sha256: '3864292ba62afad64de22549f334e2080fc558602bc31a94c6cdc9d233974614',
  },
  {
    repositoryPath:
      'supabase/migrations/20260922120000_normalize_product_key_specs_gpu.sql',
    sha256: '27140ce538838e4a31f6fbc2f9871eaa3697d02888aed5d3b360c5f68ccd2245',
  },
  {
    repositoryPath:
      'supabase/migrations/20260924090000_quiz_start_guard_context_v2.sql',
    sha256: 'ad1b4afac28db2099449ef0f63208ef0401ea9bad9e9f0dfbee1041effd83bd2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260925090000_pr3468_followup_payment_hardening.sql',
    sha256: 'e92fdbcad279fb7cbf8bc1553404b5e54026c124e2b0c5c29d334b9cd2b1bad7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260925100000_credit_direct_inventory_proof.sql',
    sha256: 'd48421f956f86ef4c18a4fcf84eb74f0f4ea9a486393fc957e5ac659d1691eea',
  },
];
