/**
 * Flip to true when utilities (airtime, data, bills) can be paid from the
 * PiggyVest savings wallet (the VTU wallet-pay project). Separate from
 * SAVINGS_WALLET_CAN_PAY (Codex): IMEI wallet pay alone must not show the
 * wallet card's utility shortcuts to a customer with ₦0 store credit, since
 * those utilities would only send them to a card top-up.
 */
export const SAVINGS_WALLET_CAN_PAY_UTILITIES = false;
