import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const events = {}, log = [], windows = new Map([[1, {id: 1, state: 'maximized', focused: true}]]);
const tabs = new Map([[10, {id: 10, windowId: 1, url: 'https://chatgpt.com/c/test', active: true}]]);
const local = {}, session = {}; let nextId = 100, confirmed = true, failure = '';
const store = bag => ({get: async key => structuredClone(key ? {[key]: bag[key]} : bag),
  set: async value => Object.assign(bag, structuredClone(value)), remove: async key => { delete bag[key]; }});
const connectCaptureHost = () => ({
  prepare: async () => { log.push('prepare'); if (failure === 'prepare') throw new Error('install.cmd'); },
  capture: async () => { log.push('capture-desktop'); if (failure === 'capture') throw new Error('capture failed'); return 'data:image/png;base64,abcd'; },
  close: () => log.push('close-host')
});
const chrome = {
  runtime: {id: 'test', getURL: path => 'chrome-extension://test/' + path, onMessage: {addListener: fn => { events.message = fn; }}},
  storage: {local: store(local), session: store(session)},
  tabs: {query: async () => [tabs.get(10)], captureVisibleTab: async () => { log.push('capture-page'); return 'data:image/png;base64,abcd'; },
    sendMessage: async (id, m) => { log.push(m.type); return m.type === 'INSERT_IMAGE' ? {confirmed, attempted: true} : {ok: true}; },
    update: async (id, changes) => Object.assign(tabs.get(id), changes), get: async id => tabs.get(id), create: async () => {}},
  windows: {get: async id => { if (!windows.has(id)) throw new Error('closed'); return structuredClone(windows.get(id)); },
    update: async (id, changes) => { Object.assign(windows.get(id), changes); log.push(changes.state || 'focus'); },
    create: async options => { log.push('editor'); const id = nextId++; windows.set(id, {id, state: 'normal'});
      tabs.set(id, {id, windowId: id, url: options.url}); return {id, tabs: [tabs.get(id)]}; },
    remove: async id => windows.delete(id), onRemoved: {addListener: fn => { events.removed = fn; }}},
  action: {onClicked: {addListener: fn => { events.action = fn; }}}
};
const sandbox = vm.createContext({chrome, crypto: webcrypto, setTimeout, Map, connectCaptureHost});
const sourceCode = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8').replace(/^import .*\n/, '');
vm.runInContext(sourceCode, sandbox);
const send = (message, sender) => new Promise(resolve => events.message(message, {id: 'test', ...sender}, resolve));
const source = {tab: tabs.get(10), url: tabs.get(10).url};
let result = await send({type: 'START_CAPTURE', mode: 'desktop'}, source); assert(result.ok, result.error);
let job = structuredClone(session.captureJob);
const editor = () => ({url: `chrome-extension://test/editor.html?job=${job.id}`});
assert(log.indexOf('prepare') < log.indexOf('minimized'));
assert(log.indexOf('minimized') < log.indexOf('capture-desktop'));
assert(log.indexOf('capture-desktop') < log.indexOf('editor'));
assert(!JSON.stringify(session).includes('data:image'));
result = await send({type: 'GET_JOB', jobId: job.id}, editor()); assert.equal(result.image, 'data:image/png;base64,abcd');
result = await send({type: 'GET_JOB', jobId: job.id}, editor()); assert(!result.ok);
result = await send({type: 'START_CAPTURE', mode: 'desktop'}, source); assert(!result.ok);
result = await send({type: 'CANCEL_CAPTURE', jobId: job.id}, editor()); assert(result.ok);
assert.equal(windows.get(1).state, 'maximized'); assert(!session.captureJob);
console.log('PASS prepare -> minimize -> native capture -> editor, no picker, one-shot in-memory frame, cancel restoration');

for (const scenario of ['prepare', 'capture']) {
  failure = scenario; log.length = 0;
  result = await send({type: 'START_CAPTURE', mode: 'desktop'}, source); assert(!result.ok);
  assert.equal(windows.get(1).state, 'maximized'); assert(!session.captureJob);
  assert(!log.includes('editor')); assert(log.includes('close-host'));
  if (scenario === 'prepare') assert(!log.includes('minimized'));
}
failure = '';
console.log('PASS missing helper never hides Edge; capture failure restores window and does not open editor');
await send({type: 'START_CAPTURE', mode: 'desktop'}, source); job = structuredClone(session.captureJob);
await events.removed(job.editorWindowId); assert(!session.captureJob); assert.equal(windows.get(1).state, 'maximized');
console.log('PASS closing the editor restores the source window');

log.length = 0;
result = await send({type: 'START_CAPTURE', mode: 'page'}, source); assert(result.ok, result.error); job = structuredClone(session.captureJob);
assert(log.indexOf('PREPARE_CAPTURE') < log.indexOf('capture-page')); assert(!log.includes('prepare'));
result = await send({type: 'DELIVER_IMAGE', jobId: job.id, image: 'data:image/png;base64,abcd'}, {url: 'https://evil.test'}); assert(!result.ok);
result = await send({type: 'DELIVER_IMAGE', jobId: job.id, image: 'data:image/png;base64,abcd'}, editor()); assert(result.confirmed);
assert(!session.captureJob); assert.equal(windows.get(1).state, 'maximized');
console.log('PASS current-page capture still works without native helper; sender validation and attachment cleanup');
await send({type: 'START_CAPTURE', mode: 'page'}, source); job = structuredClone(session.captureJob); confirmed = false;
result = await send({type: 'DELIVER_IMAGE', jobId: job.id, image: 'data:image/png;base64,abcd'}, editor());
assert(result.ok && !result.confirmed); assert(session.captureJob);
await send({type: 'CANCEL_CAPTURE', jobId: job.id}, editor());
console.log('PASS unconfirmed attachment keeps screenshot available for manual clipboard fallback');
