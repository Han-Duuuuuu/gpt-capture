import assert from 'node:assert/strict';
import {connectCaptureHost} from '../native-client.js';

function mockHost(reply) {
  const events = {}; let disconnected = false;
  globalThis.chrome = {runtime: {connectNative(name) {
    assert.equal(name, 'com.gpt_capture.assistant');
    return {
      onMessage: {addListener: fn => { events.message = fn; }},
      onDisconnect: {addListener: fn => { events.disconnect = fn; }},
      postMessage: request => queueMicrotask(() => reply(request, events)),
      disconnect: () => { disconnected = true; }
    };
  }}};
  return {events, get disconnected() { return disconnected; }};
}

// Large images must use many sub-1-MB native messages and reconstruct exactly.
const image = 'abcd/'.repeat(310000);
let mock = mockHost((request, events) => {
  if (request.command === 'prepare') { events.message({type: 'prepared'}); return; }
  if (request.command === 'ping') { events.message({type: 'pong'}); return; }
  events.message({type: 'imageStart', length: image.length});
  for (let offset = 0, index = 0; offset < image.length; offset += 512 * 1024, index++) {
    events.message({type: 'imageChunk', index, data: image.slice(offset, offset + 512 * 1024)});
  }
  events.message({type: 'imageEnd'});
});
let client = connectCaptureHost();
await client.ping(); await client.prepare();
assert.equal(await client.capture(), 'data:image/png;base64,' + image);
client.close(); assert(mock.disconnected);
console.log('PASS native prepare/ping, chunked images >1 MB, exact reconstruction and disconnect');

for (const scenario of ['order', 'truncated', 'oversize', 'characters']) {
  mockHost((request, events) => {
    events.message({type: 'imageStart', length: scenario === 'oversize' ? 64 * 1024 * 1024 : 4});
    if (scenario === 'order') events.message({type: 'imageChunk', index: 1, data: 'abcd'});
    if (scenario === 'characters') events.message({type: 'imageChunk', index: 0, data: '<bad'});
    events.message({type: 'imageEnd'});
  });
  client = connectCaptureHost(); await assert.rejects(client.capture()); client.close();
}
console.log('PASS malformed, incomplete, oversized and out-of-order native messages rejected');
mockHost((request, events) => events.disconnect());
client = connectCaptureHost();
await assert.rejects(client.prepare(), /install\.cmd/); client.close();
mockHost((request, events) => events.message({type: 'error', message: 'capture failed'}));
client = connectCaptureHost();
await assert.rejects(client.prepare(), /capture failed/); client.close();
console.log('PASS missing host and capture errors produce actionable messages');
