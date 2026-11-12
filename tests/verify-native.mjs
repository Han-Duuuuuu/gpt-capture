import {spawn} from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const hex = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
const id = [...hex].map(x => String.fromCharCode(97 + parseInt(x, 16))).join('');
assert.deepEqual(config.allowed_origins, [`chrome-extension://${id}/`]);
assert.equal(config.name, 'com.gpt_capture.assistant');
assert.equal(config.type, 'stdio');
const child = spawn(config.path, [], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
const output = [], errors = [];
child.stdout.on('data', chunk => output.push(chunk));
child.stderr.on('data', chunk => errors.push(chunk));
// On an early host failure, report stderr rather than an incidental EPIPE exception.
child.stdin.on('error', () => {});
const completed = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Native host timed out.')); }, 10000);
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('close', code => {
    clearTimeout(timeout);
    if (code !== 0) reject(new Error(`Native host exited ${code}: ${Buffer.concat(errors).toString('utf8')}`));
    else resolve();
  });
});
for (const command of ['ping', 'capture', 'unknown', 'ping']) {
  const payload = Buffer.from(JSON.stringify({command}), 'utf8');
  const prefix = Buffer.alloc(4); prefix.writeUInt32LE(payload.length);
  child.stdin.write(prefix.subarray(0, 2)); child.stdin.write(prefix.subarray(2));
  child.stdin.write(payload.subarray(0, 1)); child.stdin.write(payload.subarray(1));
}
child.stdin.end();
await completed;
const bytes = Buffer.concat(output), replies = [];
for (let offset = 0; offset < bytes.length;) {
  assert(offset + 4 <= bytes.length, 'Truncated native header');
  const size = bytes.readUInt32LE(offset); offset += 4;
  assert(size > 0 && size <= 1024 * 1024, 'Invalid native message length');
  assert(offset + size <= bytes.length, 'Truncated native payload');
  replies.push(JSON.parse(bytes.subarray(offset, offset + size).toString('utf8'))); offset += size;
}
assert.deepEqual(replies.map(reply => reply.type), ['pong', 'error', 'error', 'pong']);
assert.match(replies[1].message, /minimized/);
assert.match(replies[2].message, /Unknown command/);
assert.equal(Buffer.concat(errors).length, 0, 'Unexpected native host stderr');
console.log('PASS Windows host compilation, registry, exact origin allowlist, framed UTF-8 JSON, errors and EOF cleanup');
