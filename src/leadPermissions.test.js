import test from 'node:test';
import assert from 'node:assert/strict';
import { isPersonalLeadRole } from './leadPermissions.js';

test('sale and PT leads stay assigned to the signed-in staff member', () => {
 assert.equal(isPersonalLeadRole('sale'), true);
 assert.equal(isPersonalLeadRole('pt'), true);
});

test('manager and admin may assign a lead to another owner', () => {
 assert.equal(isPersonalLeadRole('manager'), false);
 assert.equal(isPersonalLeadRole('admin'), false);
});
