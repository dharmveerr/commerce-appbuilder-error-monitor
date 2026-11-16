'use strict';
// Synthetic sensitive values. Assembled at runtime so no secret-shaped literals live in source control
// (avoids secret-scanner false positives). None of these are real credentials.
const jwt = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJ0ZXN0In0', '.', 'c2lnbmF0dXJlLXRlc3Q'].join('');
const bearer = 'tok_' + 'A1b2C3d4E5f6G7h8';
const aws = 'AKIA' + 'IOSFODNN7EXAMPLE';
const stripe = 'sk_' + 'test_' + '4eC39HqLyjWDarjtT1zdp7dc';
const github = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const password = 'Hunter2-test-value';
const email = 'jane.doe' + '@' + 'example.com';
const card = '4242 4242 4242 4242';
const urlPass = 's3cretPass';
const urlToken = 'abc123XYZtoken';
const pkBody = 'MIIFAKEKEYBODY';
const privateKey = '-----BEGIN ' + 'PRIVATE KEY-----\n' + pkBody + '\n-----END ' + 'PRIVATE KEY-----';

/** A realistic-looking error message that smuggles every kind of sensitive value. */
const dirtyMessage = [
  `Upstream call failed for ${email}: Authorization: Bearer ${bearer}`,
  `password=${password}`,
  `card ${card}`,
  `jwt ${jwt}`,
  `aws ${aws} stripe ${stripe} gh ${github}`,
  `url https://svc:${urlPass}@internal.example.com/api?access_token=${urlToken}&page=2`,
  privateKey
].join(' | ');

/** Raw substrings that must NEVER appear in stored records, events, API responses or UI view-models. */
const SENSITIVE_VALUES = [bearer, password, card, jwt, aws, stripe, github, urlPass, urlToken, pkBody, email];

module.exports = { dirtyMessage, SENSITIVE_VALUES, jwt, bearer, aws, stripe, github, password, email, card, privateKey };
