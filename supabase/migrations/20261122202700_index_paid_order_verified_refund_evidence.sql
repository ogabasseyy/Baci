-- Support the order foreign key and order-scoped settlement and invoice reads.
CREATE INDEX paid_order_verified_refund_evidence_order_id_idx
  ON private.paid_order_verified_refund_evidence (order_id);
