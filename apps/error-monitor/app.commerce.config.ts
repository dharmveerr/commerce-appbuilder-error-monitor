import { defineConfig } from '@adobe/aio-commerce-lib-app/config';
import { MENU_SYSTEM } from '@adobe/aio-commerce-sdk/admin-ui/menu';

/**
 * App Management definition (Admin UI SDK V2, extension point commerce/backend-ui/2).
 * There is no registration action and no ExtensionRegistration component in V2: Commerce reads this file
 * (through the generated manifest) when the app is associated and installed under Apps > App Management.
 */
export default defineConfig({
  metadata: {
    id: 'commerce-error-monitor', // letters, digits, hyphens; cannot change after install
    displayName: 'Error Monitor', // shown in App Management (max 50 chars)
    description: 'Records sanitized errors from App Builder apps and lets admins list and inspect them.',
    version: '0.1.0', // Major.Minor.Patch only
  },
  adminUi: {
    menu: {
      id: 'error_monitor_dashboard', // letters, digits, / : _ only
      label: 'Error Monitor',
      description: 'List and inspect errors reported by App Builder apps for this Commerce instance.',
      parentMenu: MENU_SYSTEM,
      pageTitle: 'App Builder Error Monitor',
      // Decision (PoC): no per-role ACL. The menu uses the shared Admin UI SDK extensions resource.
      // Set to true later to create a dedicated Commerce ACL resource for this menu (solution design, section 7).
      aclProtected: false,
    },
  },
});
