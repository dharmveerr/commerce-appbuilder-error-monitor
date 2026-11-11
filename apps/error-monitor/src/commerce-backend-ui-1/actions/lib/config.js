'use strict';
const { INSTANCE_PATTERN, SEVERITIES } = require('@commerce-ext/error-monitor-sdk');

class ConfigError extends Error {
  constructor(problems) {
    super('service_misconfigured');
    this.name = 'ConfigError';
    this.problems = problems; // names of settings only - never values
  }
}

const bool = (v, dflt) => (v === undefined || v === '' ? dflt : ['true', '1', 'yes', true].includes(typeof v === 'string' ? v.toLowerCase() : v));
const int = (v, dflt) => (v === undefined || v === '' ? dflt : Number.parseInt(v, 10));

/**
 * Build typed config from action params (populated from .env via ext.config.yaml `inputs`).
 * @param {object} params
 * @param {'ingest'|'read'} mode  which settings are mandatory for the calling action
 */
function loadConfig(params = {}, mode = 'ingest') {
  const problems = [];
  const instanceId = params.COMMERCE_INSTANCE_ID;
  if (!INSTANCE_PATTERN.test(instanceId || '')) problems.push('COMMERCE_INSTANCE_ID (1-64 chars: letters, digits, _ -)');

  const signingKey = params.INGEST_SIGNING_KEY;
  if (mode === 'ingest' && (typeof signingKey !== 'string' || signingKey.length < 32)) problems.push('INGEST_SIGNING_KEY (min 32 chars)');

  const imsOrgId = params.IMS_ORG_ID;
  if (mode === 'read' && (typeof imsOrgId !== 'string' || !/^[A-Za-z0-9]+@AdobeOrg$/.test(imsOrgId))) problems.push('IMS_ORG_ID (<id>@AdobeOrg; dashboard access is denied without it)');

  const stateTtlSeconds = int(params.STATE_TTL_SECONDS, 604800);
  if (!(stateTtlSeconds >= 60 && stateTtlSeconds <= 31536000)) problems.push('STATE_TTL_SECONDS (60..31536000)');

  const eventsEnabled = bool(params.EVENTS_ENABLED, Boolean(params.EVENT_PROVIDER_ID));
  const events = {
    enabled: eventsEnabled,
    providerId: params.EVENT_PROVIDER_ID,
    eventCode: params.EVENT_CODE || 'com.example.commerce.error_monitor.error_recorded',
    minSeverity: params.EVENT_MIN_SEVERITY || 'error',
    imsOrgId,
    imsClientId: params.IMS_CLIENT_ID,
    imsClientSecret: params.IMS_CLIENT_SECRET,
    imsScopes: params.IMS_SCOPES || 'openid,AdobeID,adobeio_api',
    imsTokenUrl: params.IMS_TOKEN_URL || 'https://ims-na1.adobelogin.com/ims/token/v3'
  };
  if (mode === 'ingest' && eventsEnabled) {
    if (!events.providerId) problems.push('EVENT_PROVIDER_ID');
    if (!SEVERITIES.includes(events.minSeverity)) problems.push(`EVENT_MIN_SEVERITY (${SEVERITIES.join('|')})`);
    for (const k of ['imsOrgId', 'imsClientId', 'imsClientSecret']) if (!events[k]) problems.push(`events: ${k === 'imsOrgId' ? 'IMS_ORG_ID' : k === 'imsClientId' ? 'IMS_CLIENT_ID' : 'IMS_CLIENT_SECRET'}`);
    if (!/^https:\/\//.test(events.imsTokenUrl)) problems.push('IMS_TOKEN_URL (must be https)');
  }

  if (problems.length) throw new ConfigError(problems);
  return { instanceId, signingKey, imsOrgId, stateTtlSeconds, archiveEnabled: bool(params.ARCHIVE_ENABLED, true), events };
}

module.exports = { loadConfig, ConfigError };
