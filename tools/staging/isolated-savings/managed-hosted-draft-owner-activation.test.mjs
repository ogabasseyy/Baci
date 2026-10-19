import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hostedDraftActivationFailureMessage,
  hostedDraftActivationFailureSteps,
} from './managed-hosted-draft-owner-activation.mjs';

test('reports only enumerated redacted activation failure steps', () => {
  assert.equal(
    hostedDraftActivationFailureMessage(
      hostedDraftActivationFailureSteps.readNginxSource
    ),
    'Hosted draft activation refused at read-nginx-source; no raw error output.\n'
  );
  assert.equal(
    hostedDraftActivationFailureMessage('private token: secret'),
    'Hosted draft activation refused at bootstrap; no raw error output.\n'
  );
});
