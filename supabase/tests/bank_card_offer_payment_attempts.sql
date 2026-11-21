-- The cases share a saved checkout and Paystack reference. The fixture is
-- transaction-local and is rolled back after each assembled contract run.
BEGIN;

\ir bank_card_offer_checkout_replay_contract.inc.sql
\ir bank_card_offer_attempt_recovery_contract.inc.sql
\ir bank_card_offer_capture_reversal_contract.inc.sql
\ir bank_card_offer_refund_dispatch_contract.inc.sql

ROLLBACK;
