'use strict';
/**
 * Read the signed-in Commerce admin's IMS credentials from the Admin UI SDK shared context.
 * For menu pages the shared context carries only `imsToken` and `imsOrgId`.
 * Returns null unless both are present and well-formed, so the page fails closed with a clear message.
 */
function readIms(sharedContext) {
  if (!sharedContext || typeof sharedContext.get !== 'function') return null;
  const token = sharedContext.get('imsToken');
  const org = sharedContext.get('imsOrgId');
  if (typeof token !== 'string' || token.length < 20) return null;
  if (typeof org !== 'string' || !/^[A-Za-z0-9]+@AdobeOrg$/.test(org)) return null;
  return { token, org };
}

module.exports = { readIms };
