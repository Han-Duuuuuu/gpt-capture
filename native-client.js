const HOST = 'com.gpt_capture.assistant';
const MAX_IMAGE = 48 * 1024 * 1024; // Base64 characters, not bytes of a native message.
const INSTALL_HELP = '请先运行新版压缩包中的 windows/install.cmd 安装截图助手，再重新加载扩展。';

export function connectCaptureHost() {
  let port;
  try { port = chrome.runtime.connectNative(HOST); }
  catch { throw new Error(INSTALL_HELP); }
  let pending = null, closed = false;
  function settle(error, result) {
    if (!pending) return;
    const request = pending; pending = null; clearTimeout(request.timer);
    if (error) request.reject(error); else request.resolve(result);
  }
  port.onDisconnect.addListener(() => {
    // Read lastError in the event callback so Chrome does not log it as unchecked.
    const detail = chrome.runtime.lastError?.message || '';
    closed = true;
    settle(new Error('无法连接 Windows 截图助手。' + INSTALL_HELP + (detail ? '（' + detail + '）' : '')));
  });
  port.onMessage.addListener(message => {
    if (!pending) return;
    const bad = () => settle(new Error('截图助手返回的数据不完整，请重新截图。'));
    if (message?.type === 'error') { settle(new Error('Windows 截图失败：' + message.message)); return; }
    if (pending.expected !== 'image') {
      if (message?.type !== pending.expected) { bad(); return; }
      settle(null, message); return;
    }
    if (message?.type === 'imageStart') {
      if (pending.parts || !Number.isInteger(message.length) || message.length < 1 || message.length > MAX_IMAGE) { bad(); return; }
      pending.parts = []; pending.length = message.length; pending.received = 0;
    } else if (message?.type === 'imageChunk') {
      if (!pending.parts || message.index !== pending.parts.length || typeof message.data !== 'string' ||
          message.data.length > 512 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(message.data) ||
          pending.received + message.data.length > pending.length) { bad(); return; }
      pending.parts.push(message.data); pending.received += message.data.length;
    } else if (message?.type === 'imageEnd') {
      if (!pending.parts || pending.received !== pending.length) { bad(); return; }
      settle(null, 'data:image/png;base64,' + pending.parts.join(''));
    } else bad();
  });
  function request(command, expected) {
    if (closed) return Promise.reject(new Error(INSTALL_HELP));
    if (pending) return Promise.reject(new Error('截图助手正忙。'));
    return new Promise((resolve, reject) => {
      pending = {expected, resolve, reject, timer: setTimeout(() => settle(new Error('截图助手响应超时，请重试。')), 20000)};
      try { port.postMessage({command}); } catch { settle(new Error(INSTALL_HELP)); }
    });
  }
  return {
    ping: () => request('ping', 'pong'),
    prepare: () => request('prepare', 'prepared'),
    capture: () => request('capture', 'image'),
    close() { closed = true; settle(new Error('截图已取消。')); try { port.disconnect(); } catch {} }
  };
}
