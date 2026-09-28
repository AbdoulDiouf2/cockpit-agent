'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatServiceInstallFailure, escapeXmlText } = require('../lib/service-install-diagnostics');

test('SCM 7038 exposes service logon failure without credentials', () => {
  const message = formatServiceInstallFailure({ phase: 'start', code: 15, eventId: 7038 });
  assert.match(message, /compte Windows.*ouvrir de session/);
  assert.match(message, /SCM 7038/);
  assert.doesNotMatch(message, /secret-example/);
});

test('WinSW 15 at start identifies logon failure when event log is unavailable', () => {
  const message = formatServiceInstallFailure({ phase: 'start', code: 15 });
  assert.match(message, /WinSW 15/);
  assert.match(message, /vrai mot de passe Windows/);
});

test('other failures retain the exact phase and exit code', () => {
  const message = formatServiceInstallFailure({ phase: 'install', code: 16 });
  assert.match(message, /pendant install \(WinSW 16\)/);
  assert.doesNotMatch(message, /mot de passe Windows/);
});

test('service account XML escapes special characters without changing the password', () => {
  assert.equal(escapeXmlText('a&b<c>"d\''), 'a&amp;b&lt;c&gt;&quot;d&apos;');
});
