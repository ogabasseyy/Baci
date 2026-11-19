import { pickString } from './loose-schemas';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { foundAnswer } from './read-rules';

/**
 * Proof 4, added step (GET only, every live mode): is the operator-supplied
 * sandbox bank destination one the sandbox knows? The bank code is looked up
 * in GET /transfer/bank-list and the account in GET /transfer/name-enquiry.
 * Neither value, nor the resolved account name, ever reaches the evidence.
 */

const QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'bank_code_listed',
    "Is the configured bank code in the sandbox's bank list?",
  ],
  [
    'bank_destination_resolves',
    'Does a name enquiry resolve the configured destination account?',
  ],
];

export async function runBankDestinationCheck(
  ctx: ProofContext,
  b: ProofBuilder
): Promise<void> {
  const { api, bank, redactor } = ctx;
  if (!bank) {
    b.inconclusive(
      'no sandbox bank destination configured (PVB_PROOF_BANK_CODE, PVB_PROOF_BANK_ACCOUNT)'
    );
    for (const [id, question] of QUESTIONS) b.finding(id, question, 'unknown');
    return;
  }
  redactor.register('B', bank.account);
  redactor.register('B', bank.code);

  const banks = await api.banks();
  const list = banks.ok && Array.isArray(banks.data) ? banks.data : null;
  b.value('bank_list_http_status', banks.httpStatus).value(
    'bank_list_size',
    list ? list.length : null
  );
  b.finding(
    QUESTIONS[0][0],
    QUESTIONS[0][1],
    list
      ? answerOf(
          list.some((entry) => pickString(entry, ['code']) === bank.code)
        )
      : 'unknown'
  );

  const enquiry = await api.nameEnquiry(bank.code, bank.account);
  // Whatever came back is registered, since a failed body may still hold a
  // name; registering is never a measurement.
  const returned: unknown = enquiry.data;
  redactor.register('N', pickString(returned, ['account_name']));
  b.shape('GET /transfer/name-enquiry', enquiry.httpStatus, enquiry.data);
  b.value('name_enquiry_http_status', enquiry.httpStatus);
  if (!enquiry.ok)
    b.value(
      'name_enquiry_message',
      enquiry.message ? redactor.message(enquiry.message) : null
    );
  b.finding(QUESTIONS[1][0], QUESTIONS[1][1], foundAnswer(enquiry));
}
