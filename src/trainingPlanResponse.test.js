import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretTrainingPlanResponse } from './trainingPlanResponse.js';

test('confirms explicit success including n8n item arrays', () => {
 assert.equal(interpretTrainingPlanResponse(200, true, '{"success":true,"email":"a@example.com"}').kind, 'success');
 assert.equal(interpretTrainingPlanResponse(200, true, '[{"json":{"success":true}}]').kind, 'success');
});

test('preserves explicit failures even on HTTP 200', () => {
 assert.deepEqual(interpretTrainingPlanResponse(200, true, '{"success":false,"error":"Email failed"}'), { kind: 'error', message: 'Email failed' });
 assert.equal(interpretTrainingPlanResponse(500, false, '{"success":true}').kind, 'error');
});

test('does not claim email delivery from an empty or unrecognized HTTP 200', () => {
 for (const body of ['', '{}', '[{"id":"queued"}]', 'Workflow was started']) {
  assert.equal(interpretTrainingPlanResponse(200, true, body).kind, 'accepted');
 }
});
