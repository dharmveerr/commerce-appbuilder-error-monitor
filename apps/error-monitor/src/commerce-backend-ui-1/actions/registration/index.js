'use strict';
/**
 * Commerce Admin UI SDK registration (extension point commerce/backend-ui/1).
 * One section + one menu per app (Admin UI SDK limit). IDs: letters, digits, / : _ only.
 * EXTENSION_ID must equal web-src/src/constants.js `extensionId` (enforced by test/admin-ui.test.js).
 * NOTE: V1 extension points are deprecated in favour of commerce/backend-ui/2 (design doc, risk R8).
 */
const EXTENSION_ID = 'error_monitor';

async function main() {
  return {
    statusCode: 200,
    body: {
      registration: {
        menuItems: [
          { id: `${EXTENSION_ID}::dashboard`, title: 'Error Monitor', parent: `${EXTENSION_ID}::apps`, sortOrder: 1 },
          { id: `${EXTENSION_ID}::apps`, title: 'App Builder Apps', isSection: true, sortOrder: 100 }
        ],
        page: { title: 'Error Monitor' }
      }
    }
  };
}

module.exports = { main, EXTENSION_ID };
