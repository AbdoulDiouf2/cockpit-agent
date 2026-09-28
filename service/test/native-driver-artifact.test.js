'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const built = path.join(root, 'dist/service/cockpit-agent-service.exe');
const installer = path.join(root, 'dist/installer/Cockpit Agent Setup 1.1.3.exe');
const sevenZip = path.join(root, 'node_modules/7zip-bin/win/x64/7za.exe');

function verifyNativeDriver(executable) {
  const output = execFileSync(executable, ['--check-native-driver'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  }).trim();
  assert.match(output, /^WINDOWS_AUTH_DRIVER_OK node=18\.\d+\.\d+ abi=108 arch=x64$/);
}

test('built service executable loads the Windows Auth native driver without SQL', () => {
  assert.ok(fs.existsSync(built), 'build the service before this test');
  verifyNativeDriver(built);
});

test('NSIS installer contains the exact verified service executable', () => {
  assert.ok(fs.existsSync(installer), 'build the installer before this test');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-native-artifact-'));
  assert.equal(path.dirname(temporary), os.tmpdir());
  try {
    execFileSync(sevenZip, ['e', installer,
      'resources/service/dist/cockpit-agent-service.exe', `-o${temporary}`, '-y'],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
    const packaged = path.join(temporary, 'cockpit-agent-service.exe');
    assert.ok(fs.existsSync(packaged), 'service executable missing from NSIS installer');
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(hash(packaged), hash(built));
    verifyNativeDriver(packaged);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
