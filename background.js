import {connectCaptureHost} from './native-client.js';

// Screenshot bytes stay in this Map briefly, then move to the editor's memory.
// storage.session contains recovery metadata only, never image data.
const frames = new Map();
let starting = false;
const supported = url => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url || '');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJob = async () => (await chrome.storage.session.get('captureJob')).captureJob;
const saveJob = job => chrome.storage.session.set({captureJob: job});

async function restore(job) {
  if (!job) return;
  await chrome.windows.update(job.sourceWindowId, {state: job.sourceState === 'minimized' ? 'normal' : job.sourceState}).catch(() => {});
  await chrome.tabs.update(job.sourceTabId, {active: true}).catch(() => {});
  await chrome.windows.update(job.sourceWindowId, {focused: true}).catch(() => {});
}

async function finish(job) {
  if (!job) return;
  frames.delete(job.id);
  await restore(job);
  await chrome.storage.session.remove('captureJob');
  await chrome.tabs.sendMessage(job.sourceTabId, {type: 'CAPTURE_ENDED'}).catch(() => {});
  if (job.editorWindowId) await chrome.windows.remove(job.editorWindowId).catch(() => {});
}

async function startCapture(mode, tab) {
  if (!supported(tab?.url) || !['page', 'desktop'].includes(mode)) throw new Error('请在 ChatGPT 页面使用截图按钮。');
  if (starting) throw new Error('截图正在启动，请稍候。');
  starting = true;
  let job, native;
  try {
    const existing = await getJob();
    if (existing) {
      const live = await chrome.windows.get(existing.editorWindowId).catch(() => null);
      if (live) {
        await chrome.windows.update(live.id, {focused: true});
        throw new Error('已有截图窗口，请先完成或取消。');
      }
      await finish(existing);
    }
    const sourceWindow = await chrome.windows.get(tab.windowId);
    job = {id: crypto.randomUUID(), mode, sourceTabId: tab.id, sourceWindowId: tab.windowId,
      sourceState: sourceWindow.state, editorWindowId: null, editorTabId: null};
    await saveJob(job);
    const current = (await chrome.tabs.query({windowId: tab.windowId, active: true}))[0];
    if (current?.id !== tab.id || !sourceWindow.focused) throw new Error('请回到要截图的 ChatGPT 页面后重试。');
    if (mode === 'page') {
      await chrome.tabs.sendMessage(tab.id, {type: 'PREPARE_CAPTURE'});
      await delay(100);
      frames.set(job.id, await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'}));
    } else {
      // Prepare while Edge is still in front: the host remembers this physical monitor.
      // No editor or picker is created until the exposed desktop has been captured.
      native = connectCaptureHost();
      await native.prepare();
      await chrome.windows.update(tab.windowId, {state: 'minimized'});
      await delay(350);
      frames.set(job.id, await native.capture());
      native.close(); native = null;
    }
    if ((await getJob())?.id !== job.id) throw new Error('原窗口已关闭，请重新截图。');
    const editor = await chrome.windows.create({url: chrome.runtime.getURL('editor.html') + '?job=' + job.id,
      type: 'popup', width: 1120, height: 780, focused: true});
    job.editorWindowId = editor.id;
    job.editorTabId = editor.tabs[0].id;
    await saveJob(job);
    return {ok: true};
  } catch (error) {
    if (job) await finish(job);
    throw error;
  } finally { native?.close(); starting = false; }
}

async function editorJob(message, sender) {
  // The editor can load before windows.create has resolved.
  let job;
  for (let i = 0; i < 30; i++) {
    job = await getJob();
    if (job?.editorTabId) break;
    await delay(50);
  }
  if (!job || job.id !== message.jobId || (sender.tab && sender.tab.id !== job.editorTabId) ||
      sender.url !== chrome.runtime.getURL('editor.html') + '?job=' + job.id) throw new Error('截图会话已结束，请重新截图。');
  return job;
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('无效请求。');
  if (message.type === 'START_CAPTURE') return startCapture(message.mode, sender.tab);
  if (message.type === 'OPEN_SETUP' && supported(sender.tab?.url)) {
    await chrome.tabs.create({url: chrome.runtime.getURL('setup.html')}); return {ok: true};
  }
  if (message.type === 'CHECK_NATIVE' && sender.url === chrome.runtime.getURL('setup.html')) {
    const native = connectCaptureHost();
    try { await native.ping(); return {ok: true}; } finally { native.close(); }
  }
  const job = await editorJob(message, sender);
  switch (message.type) {
    case 'GET_JOB': {
      const image = frames.get(job.id);
      frames.delete(job.id);
      if (!image) throw new Error('截图已释放，请关闭窗口后重新截图。');
      return {ok: true, job, image};
    }
    case 'EDITOR_STATE':
      await chrome.windows.update(job.editorWindowId, {state: message.state === 'minimized' ? 'minimized' : 'maximized'});
      return {ok: true};
    case 'DELIVER_IMAGE': {
      if (typeof message.image !== 'string' || !message.image.startsWith('data:image/png;base64,') || message.image.length > 24 * 1024 * 1024) {
        throw new Error('图片过大，请缩小截图范围（上限约 18 MB）。');
      }
      const tab = await chrome.tabs.get(job.sourceTabId);
      if (!supported(tab.url)) throw new Error('原 ChatGPT 页面已关闭或跳转，请取消后重新截图。');
      await restore(job);
      await delay(200);
      const result = await chrome.tabs.sendMessage(job.sourceTabId, {type: 'INSERT_IMAGE', image: message.image}).catch(async () => {
        await chrome.windows.update(job.editorWindowId, {state: 'normal', focused: true}).catch(() => {});
        throw new Error('无法连接原 ChatGPT 页面。请先检查页面是否刷新，或使用“复制图片”后手动粘贴。');
      });
      if (result?.confirmed) { await finish(job); return {ok: true, confirmed: true}; }
      // Keep the image in the editor for a manual clipboard fallback.
      await chrome.windows.update(job.editorWindowId, {state: 'normal', focused: true});
      return {ok: true, confirmed: false, attempted: !!result?.attempted, error: result?.error};
    }
    case 'CANCEL_CAPTURE':
      await finish(job);
      return {ok: true};
    default: throw new Error('未知操作。');
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond).catch(error => respond({ok: false, error: error.message}));
  return true;
});

chrome.windows.onRemoved.addListener(async windowId => {
  const job = await getJob();
  if (job?.editorWindowId === windowId) await finish(job);
  else if (job?.sourceWindowId === windowId) {
    frames.delete(job.id);
    await chrome.storage.session.remove('captureJob');
    if (job.editorWindowId) await chrome.windows.remove(job.editorWindowId).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async tab => {
  if (!supported(tab?.url)) { await chrome.tabs.create({url: 'https://chatgpt.com/'}); return; }
  const {enabled = true} = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({enabled: !enabled});
});
