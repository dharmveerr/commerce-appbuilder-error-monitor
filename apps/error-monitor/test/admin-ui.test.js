'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { main, EXTENSION_ID } = require('../src/commerce-backend-ui-1/actions/registration');
const { extensionId } = require('../src/commerce-backend-ui-1/web-src/src/constants');
const { readIms } = require('../src/commerce-backend-ui-1/web-src/src/lib/ims');
const fs = require('node:fs');
const path = require('node:path');

const ctx = (values) => ({ get: (k) => values[k] });

test('registration: one section + one menu, valid IDs, same extension ID as the web app', async () => {
  const res = await main();
  assert.equal(res.statusCode, 200);
  const items = res.body.registration.menuItems;
  assert.equal(EXTENSION_ID, extensionId, 'register/attach ID and menu ID prefix must match');
  assert.equal(items.filter((i) => i.isSection).length, 1);
  assert.equal(items.filter((i) => !i.isSection).length, 1);
  for (const i of items) {
    assert.match(i.id, /^[A-Za-z0-9/:_]+$/, `invalid menu id ${i.id}`);
    assert.ok(i.id.startsWith(`${EXTENSION_ID}::`));
  }
  const menu = items.find((i) => !i.isSection);
  assert.ok(items.some((i) => i.id === menu.parent), 'menu parent must be the declared section');
});

test('registration action is IMS-protected in ext.config.yaml (Admin UI SDK requirement)', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../src/commerce-backend-ui-1/ext.config.yaml'), 'utf8');
  const block = yaml.split('registration:')[1].split('record-error:')[0];
  assert.match(block, /require-adobe-auth:\s*true/);
});

test('readIms: accepts a well-formed shared context, fails closed otherwise', () => {
  const token = 'x'.repeat(40);
  assert.deepEqual(readIms(ctx({ imsToken: token, imsOrgId: 'ABC123@AdobeOrg' })), { token, org: 'ABC123@AdobeOrg' });
  for (const bad of [null, undefined, {}, ctx({}), ctx({ imsToken: token }), ctx({ imsOrgId: 'ABC@AdobeOrg' }),
    ctx({ imsToken: 'short', imsOrgId: 'ABC@AdobeOrg' }), ctx({ imsToken: token, imsOrgId: 'not-an-org' })]) {
    assert.equal(readIms(bad), null);
  }
});

test('page never reads credentials from the URL (they come only from the Admin shared context)', () => {
  const dir = path.join(__dirname, '../src/commerce-backend-ui-1/web-src/src');
  const src = ['App.js', 'index.js', 'components/ExtensionRegistration.js', 'components/ErrorMonitorPage.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(!/location\.search|URLSearchParams\(window|__IMS_TOKEN__/.test(src));
  assert.match(src, /attach\(\{ id: extensionId \}\)/);
  assert.match(src, /register\(\{ id: extensionId/);
});
