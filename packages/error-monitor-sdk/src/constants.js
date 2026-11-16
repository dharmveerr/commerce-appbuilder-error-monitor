'use strict';

const SCHEMA_VERSION = '1.0';
const SEVERITIES = Object.freeze(['debug', 'info', 'warning', 'error', 'critical']);
const SEVERITY_RANK = Object.freeze({ debug: 0, info: 1, warning: 2, error: 3, critical: 4 });

// Hard limits keep stored records small and bound the blast radius of a noisy or hostile caller.
const LIMITS = Object.freeze({
  name: 100,
  code: 100,
  message: 1000,
  stack: 4000,
  stackLines: 30,
  app: 100,
  action: 100,
  version: 50,
  environment: 50,
  requestId: 128,
  path: 300,
  tags: 20,
  tagKey: 40,
  tagValue: 200,
  bodyBytes: 65536
});

const HEADERS = Object.freeze({ timestamp: 'x-em-timestamp', signature: 'x-em-signature' });

module.exports = { SCHEMA_VERSION, SEVERITIES, SEVERITY_RANK, LIMITS, HEADERS };
