'use strict';
// Admin UI SDK V2 (commerce/backend-ui/2) contract checks, done offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP = path.join(__dirname, '..');
const B = path.join(APP, 'src/commerce-backend-ui-2');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

/** Load app.commerce.config.ts with tiny stand-ins for the two Adobe modules it imports (no eval, no network). */
async function loadAppConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appcfg-'));
  const stub = (pkg, exportsMap) => {
    const root = path.join(dir, 'node_modules', ...pkg.split('/'));
    fs.mkdirSync(root, { recursive: true });
    const files = {};
    for (const [sub, src] of Object.entries(exportsMap)) {
      const file = `${sub.replace(/[./]/g, '_') || 'index'}.mjs`;
      fs.writeFileSync(path.join(root, file), src);
      files[sub] = `./${file}`;
    }
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: pkg, type: 'module', exports: files }));
  };
  stub('@adobe/aio-commerce-lib-app', { './config': 'export const defineConfig = (c) => c;' });
  stub('@adobe/aio-commerce-sdk', { './admin-ui/menu': "export const MENU_SYSTEM = 'stub:MENU_SYSTEM';" });
  fs.copyFileSync(path.join(APP, 'app.commerce.config.ts'), path.join(dir, 'app.commerce.config.ts'));
  return (await import(pathToFileURL(path.join(dir, 'app.commerce.config.ts')).href)).default;
}

test('app.commerce.config: metadata obeys App Management rules', async () => {
  const { metadata } = await loadAppConfig();
  assert.match(metadata.id, /^[A-Za-z0-9-]{1,100}$/, 'metadata.id: letters, digits, hyphens');
  assert.ok(metadata.displayName.length > 0 && metadata.displayName.length <= 50);
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 255);
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/, 'numeric semver only');
});

test('app.commerce.config: one V2 menu with valid id, required fields, Commerce parent constant, ACL decision applied', async () => {
  const { adminUi } = await loadAppConfig();
  assert.ok(adminUi && adminUi.menu && !Array.isArray(adminUi.menu), 'V2 menu is a single object');
  const m = adminUi.menu;
  assert.match(m.id, /^[A-Za-z0-9_/:]+$/, 'menu id: letters, digits, / : _ (no hyphens)');
  assert.ok(m.label && m.description, 'label and description are required');
  assert.equal(m.parentMenu, 'stub:MENU_SYSTEM', 'parentMenu must use the SDK constant, not a raw string');
  assert.equal(m.aclProtected, false, 'current scope: no per-role ACL yet (solution design, section 7)');
  assert.ok(!('sortOrder' in m) && !('path' in m), 'V1-only / not-allowed fields must be absent');
});

test('V1 artefacts are gone and V2 wiring is in place', () => {
  assert.ok(!fs.existsSync(path.join(APP, 'src/commerce-backend-ui-1')), 'no V1 extension folder');
  assert.ok(!fs.existsSync(path.join(B, 'actions/registration')), 'V2 has no registration action');
  assert.match(read('app.config.yaml'), /commerce\/backend-ui\/2:\s*\n\s*\$include: src\/commerce-backend-ui-2\/ext\.config\.yaml/);
  assert.doesNotMatch(read('app.config.yaml'), /backend-ui\/1/);
  const all = read('src/commerce-backend-ui-2/web-src/src/app.jsx') + read('src/commerce-backend-ui-2/web-src/src/pages/main-page.jsx');
  assert.doesNotMatch(all, /@adobe\/uix-guest|ExtensionRegistration|register\(/);
});

test('ext.config.yaml: own package (not reserved), IMS on dashboard actions, HMAC ingest, Node >= 22', () => {
  const y = read('src/commerce-backend-ui-2/ext.config.yaml');
  assert.match(y, /packages:\s*\n\s*error-monitor:/);
  assert.doesNotMatch(y, /^\s*app-management:/m, '`app-management` package name is reserved');
  const block = (name) => y.split(`${name}:`)[1].split(/\n {8}[a-z-]+:\n/)[0];
  for (const a of ['list-errors', 'get-error']) assert.match(block(a), /require-adobe-auth:\s*true/, a);
  assert.match(block('record-error'), /raw-http:\s*true/);
  for (const v of y.match(/runtime:\s*nodejs:(\d+)/g)) assert.ok(Number(v.split(':').pop()) >= 22, v);
  assert.match(y, /^web: web-src$/m, 'menu view operation needs web-src (managed by the build)');
  assert.match(y, /^operations:\s*\n\s*view:/m);
});

test('initializer output is committed: App Management extension, install.yaml, web entry points at our app.jsx', () => {
  assert.match(read('app.config.yaml'), /commerce\/extensibility\/1:\s*\n\s*\$include: src\/commerce-extensibility-1\/ext\.config\.yaml/);
  assert.match(read('install.yaml'), /commerce\/backend-ui\/2/);
  assert.match(read('src/commerce-backend-ui-2/web-src/index.html'), /src="\.\/src\/app\.jsx"/);
  assert.ok(!fs.existsSync(path.join(B, 'web-src/src/app.tsx')), 'no generated placeholder entry competing with app.jsx');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.imports['#web/*'], './src/commerce-backend-ui-2/web-src/src/*');
  for (const d of ['@adobe/aio-commerce-lib-app', '@adobe/aio-commerce-lib-admin-ui', '@react-spectrum/s2', 'react']) assert.ok(pkg.dependencies[d], d);
});

test('app.jsx: createExtensionApp with config.metadata.id and the menu page', () => {
  const s = read('src/commerce-backend-ui-2/web-src/src/app.jsx');
  assert.match(s, /createExtensionApp\(\{/);
  assert.match(s, /extensionId: config\.metadata\.id/);
  assert.match(s, /menu: <MainPage \/>/);
  assert.doesNotMatch(s, /index: true/, 'the installed admin-ui library has no index routes; the menu page uses the menu option');
});

test('main page: IMS only via useIms, sends org header, uses generated action URLs, no HTML sinks', () => {
  const s = read('src/commerce-backend-ui-2/web-src/src/pages/main-page.jsx');
  assert.match(s, /useIms\(\)/);
  assert.match(s, /'x-gw-ims-org-id': ims\.imsOrgId/);
  assert.match(s, /getActionUrl\('error-monitor\/list-errors'\)/);
  assert.match(s, /getActionUrl\('error-monitor\/get-error'\)/);
  assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML|eval\(|location\.search|localStorage/);
});
