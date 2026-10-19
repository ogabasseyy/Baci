export const EXPECTED_EXPENSE_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260809120000_expense_editing_and_groups.sql',
    sha256: '5c2401058d5598610122d81a68d2f29cdbe4f4b5b26d5b6994f82d6af1b796f8',
  },
  {
    repositoryPath:
      'supabase/migrations/20260809120100_drop_blocking_expense_group_date_index.sql',
    sha256: '4fe162a1363f8b64e7c83c51a6cef06575b089cb3831287d62c47e3894d3cc29',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812120000_preserve_legacy_expense_descriptions.sql',
    sha256: '3414f5a0698c0f4c5543a1d6a47fa5a77e1e74e5a9f0cba2eb81bd69afab03fb',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812130000_harden_legacy_expense_receipt_cleanup.sql',
    sha256: '779850d82bfb311d79070e24e038ac74d60d46f1d884f3c2a210b3fcbe9de528',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812140000_preserve_legacy_expense_amounts.sql',
    sha256: '9a051ae62cb8951c10d2ba6579d3898e7b93a6d12a4dcf9b0c667357a662ad39',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812150000_preserve_expense_audit_updater.sql',
    sha256: '28d103804eeab405556e58d0ae14b8c2ebb7b6cec4e7b137601a17842226d477',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812160000_concurrent_expense_audit_indexes.sql',
    sha256: '71cd7b5827cc09973b9dffc64536ab345744a2c9bf7aad106ec7ca43838e1ef7',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812170100_enforce_expense_receipt_scope.sql',
    sha256: '8e108e6af50bb753beacc30e3b6e66dd4b2b4958c10ba1bbfdfe74cacd13c75f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812180100_repair_invalid_expense_audit_indexes.sql',
    sha256: 'aba3323c0c8389a6bc1a7c2c525cf339db5d513a85ae5db27b1abeec5e6277d2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812200000_harden_expense_group_assignment_lock.sql',
    sha256: 'cf1454bc7c870e20fe49d0b1a9536d3c3e46a2105e141ad3de3ad9a3f22d0831',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812209900_define_expense_receipt_is_referenced.sql',
    sha256: 'b0a73426f96e837b077428ffc93194ffed61556adafbc27b6f39d0b126bd0b72',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812210000_enforce_expense_receipt_storage_policy_scope.sql',
    sha256: '1b40447f7e7437d9dffb047b7ba96bbf8dbed9b68636927c779d562c2d6905e9',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812220000_cleanup_legacy_expense_receipt_candidates.sql',
    sha256: '157874e043fcde9728a9b42901e69c61abedcc261d9e93ceb64e717c532f3e0f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260812230000_preserve_create_receipt_cleanup.sql',
    sha256: '4ce0607d0e1300f189287845b4847458d248e54c045e610c359e7356977b0145',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813072525_retain_legacy_expense_receipt_cleanup_candidates.sql',
    sha256: '17b31b1de2a62d41b8cb8dab88eec2ec249b7b4e55395e9224b8c9d49eda7f3f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813072659_rebuild_expense_group_date_index_concurrently.sql',
    sha256: '42728fe956e5353aa2c77a38f4e87d75fdbbbdbfbce7be1d5aec0b8649b5d287',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813100050_concurrent_expense_audit_indexes.sql',
    sha256: '6eb1b7910baae5dc61d1b44036396a89166d0f314cdb9679aab20336366d9318',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813100100_expense_audit_foreign_key_indexes.sql',
    sha256: '9cd64b2bd1a4320b0121263272bd5807dd4bdf2d4eab005164f5c0a8c955c01c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813100200_authorize_legacy_expense_receipt_cleanup.sql',
    sha256: '6fa3e10832b8f621b2f8e948b13317c2f6537be3ad518cc4e08f3d2830f09520',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813100300_capture_legacy_expense_receipts.sql',
    sha256: '293b61cbd2e438e8ac3a271cb876c084b8f00e5bb5d5cb87271071b15aa0b03b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813131332_harden_legacy_expense_receipt_cleanup_candidates.sql',
    sha256: '4a69fb375da694135f59231a3103de9c69023d60f6cfcea5a8c2c892d21f8613',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813140000_allow_create_only_expense_group_select.sql',
    sha256: 'bf7642771fcf9ff2bdf91e4add7319cc38fa544c6b8ba7f07e369b5139cbc28f',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813150000_restrict_create_only_expense_group_select.sql',
    sha256: 'e7427f923cee7c02357ff3e8b97640c02514581edc7f6d87137d77fcffb92040',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813150100_restore_expense_receipt_delete_namespace.sql',
    sha256: '6ebe0b2fa49be670d3a8a292510faa4917078fca7446a95a939e7585da505747',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813150200_preserve_legacy_receipt_storage_api_cleanup.sql',
    sha256: '640802653f5e1bbc0585dd95a8aa826640a7c85e95728a10be53bb8b1c6e2c30',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813150300_legacy_expense_receipt_cleanup_worker.sql',
    sha256: 'bad4932e935d21825d989e24deef6025db82d0cfbe6bf8ece41eebb54f85e50c',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813150400_enforce_expense_immutable_columns.sql',
    sha256: 'b5b4b1e504a0e17267c1fb17731a2a830b0d746eeb77488bcfad9f8d33d92c3d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260813150500_harden_legacy_expense_receipt_cleanup_authorization.sql',
    sha256: 'cedd239c9a08ab0c12b3a0ee672cb0d8b6ac7fa13fe18fe4a4081d4b295af775',
  },
  {
    repositoryPath:
      'supabase/migrations/20260814213000_private_expense_receipt_cleanup_worker.sql',
    sha256: 'decca0f510f77769aa67481a79b9fc711a1a2eb1a296370fb89f7428292bb029',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815103000_capture_private_expense_receipt_cleanup.sql',
    sha256: '64530e9b7d94d9e2f832a8464593af977cb0af18c727a1a1b54c62310550997b',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815143000_strip_legacy_receipt_url_query_params.sql',
    sha256: 'b1d023a94a81447adc0f9ae483b8a77ff75d4b89a1aeac9518f27943830dfdaf',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815200000_harden_private_expense_receipt_cleanup_claims.sql',
    sha256: '9d8770222f94f07bb6e5d666d942aa6cfb4833b1dd861babb21188b89e21cf31',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815210000_normalize_legacy_receipt_path_references.sql',
    sha256: '1d18b8bfff6eddc9a9af5b7586c895a055eb597502844104a8a78dab1b392783',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815220000_repair_capture_private_expense_receipt_cleanup.sql',
    sha256: '80f1d1f3daf54121999dd23973067ca17d0817d578ae87ef7529d476314ec74a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260815230000_restore_legacy_receipt_storage_api_cleanup.sql',
    sha256: 'e4f07e52d0455674625123567c3203cf8f4d6d51b54ab6b2f5183554b13327df',
  },
];
