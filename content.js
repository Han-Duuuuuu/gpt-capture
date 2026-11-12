(() => {
  if (document.getElementById('gpt-capture-assistant')) return;
  const host = document.createElement('div');
  host.id = 'gpt-capture-assistant';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const shadow = host.attachShadow({mode: 'closed'});
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box} :host{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
      button{font:inherit;cursor:pointer} .dock{position:absolute;right:22px;top:42%;pointer-events:auto;color:#f5f7fa}
      .orb{display:grid;place-items:center;width:46px;height:46px;border:1px solid #ffffff28;border-radius:16px;background:#18272b;box-shadow:0 4px 22px #0003;color:#8af1d0;touch-action:none}
      .orb:hover,.orb[aria-expanded=true]{background:#25443f;box-shadow:0 4px 24px #0004;outline:2px solid #7cdeb433}
      button:focus-visible{outline:2px solid #71e9be;outline-offset:3px} svg{width:24px;height:24px;pointer-events:none}
      .menu{position:absolute;right:58px;top:0;width:252px;padding:8px;border:1px solid #ffffff20;border-radius:16px;background:#172125;box-shadow:0 12px 40px #0005}
      .title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 5px 6px 10px;color:#adbbb9;font-size:12px;letter-spacing:1px}.settings-toggle{display:grid;place-items:center;width:30px;height:30px;padding:5px;border:0;border-radius:8px;background:none;color:#93a4a8}.settings-toggle:hover,.settings-toggle[aria-expanded=true]{background:#ffffff10;color:#7ce8c4}.settings-toggle svg{width:19px;height:19px}.settings-panel{margin:0 2px 5px;padding-bottom:5px;border-bottom:1px solid #ffffff12}.item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 10px;background:none;border:0;border-radius:10px;color:inherit}.item:hover{background:#ffffff10}.item svg{width:21px;color:#7ce8c4;flex-shrink:0}.item small{display:block;color:#93a4a8;font-size:11px;margin-top:3px}
      .toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:min(480px,90vw);padding:12px 18px;background:#172b27;color:#ddfff3;border:1px solid #ffffff24;border-radius:12px;box-shadow:0 5px 30px #0003;pointer-events:auto}
      [hidden]{display:none!important}
    </style>
    <div class="dock">
      <button class="orb" aria-label="截图助手（可拖动）" aria-expanded="false" title="截图助手 · 拖动可调整位置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h4l2-3h4l2 3h4v13H4z" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5"/></svg>
      </button>
      <div class="menu" hidden>
        <div class="title"><span>GPT 截图助手</span><button class="settings-toggle" aria-label="展开或收起首次启用设置" aria-expanded="false" aria-controls="settings-panel" title="首次启用设置"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2h4l.5 3a7 7 0 0 1 1.7 1l2.8-1 2 3.5-2.3 2a7 7 0 0 1 0 3l2.3 2-2 3.5-2.8-1a7 7 0 0 1-1.7 1L14 22h-4l-.5-3a7 7 0 0 1-1.7-1L5 19l-2-3.5 2.3-2a7 7 0 0 1 0-3L3 8.5 5 5l2.8 1a7 7 0 0 1 1.7-1z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
        <div class="settings-panel" id="settings-panel" hidden><button class="item" id="setup"><span>首次启用一键截图<small>安装 Windows 本机助手 / 检查连接</small></span></button></div>
        <button class="item" data-mode="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M7 6h.01M10 6h.01"/></svg><span>截取当前页面<small>框选当前可见的网页内容</small></span></button>
        <button class="item" data-mode="desktop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5M8 7l8 6M16 7l-8 6"/></svg><span>隐藏本页后截图<small>直接截取窗口后方画面 · 无需选择</small></span></button>
      </div>
    </div><div class="toast" role="status" hidden></div>`;
  document.documentElement.appendChild(host);
  const dock = shadow.querySelector('.dock'), orb = shadow.querySelector('.orb'), menu = shadow.querySelector('.menu');
  const settingsToggle = shadow.querySelector('.settings-toggle'), settingsPanel = shadow.querySelector('#settings-panel');
  let busy = false, enabled = true, hiddenForCapture = false, setupIntroSeen = true, toastTimer;
  const visibility = () => { dock.hidden = !enabled || hiddenForCapture; };
  function showSettings(show) { settingsPanel.hidden = !show; settingsToggle.setAttribute('aria-expanded', String(show)); }
  function closeMenu() { menu.hidden = true; orb.setAttribute('aria-expanded', 'false'); showSettings(false); }
  function toast(message) {
    const el = shadow.querySelector('.toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }
  function position(x, y) {
    const width = 46, height = 46, padding = 12;
    const left = Math.max(padding, Math.min(innerWidth - width - padding, x));
    const top = Math.max(padding, Math.min(innerHeight - height - padding, y));
    dock.style.cssText = `left:${left}px;top:${top}px;right:auto;`;
    menu.style.right = left > 275 ? '58px' : 'auto';
    menu.style.left = left > 275 ? 'auto' : '58px';
    const above = top + (menu.offsetHeight || 250) > innerHeight - padding;
    menu.style.top = above ? 'auto' : '0';
    menu.style.bottom = above ? '0' : 'auto';
  }
  const settingsReady = chrome.storage.local.get(['enabled', 'position', 'setupIntroSeen']).then(settings => {
    enabled = settings.enabled !== false; visibility();
    setupIntroSeen = settings.setupIntroSeen === true;
    if (settings.position) position(settings.position.x * innerWidth, settings.position.y * innerHeight);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) { enabled = changes.enabled.newValue !== false; closeMenu(); visibility(); }
    if (area === 'local' && changes.setupIntroSeen) setupIntroSeen = changes.setupIntroSeen.newValue === true;
  });
  window.addEventListener('resize', () => {
    const rect = dock.getBoundingClientRect(); if (!dock.hidden) position(rect.x, rect.y);
  });
  let drag, suppressClick = false;
  orb.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = dock.getBoundingClientRect();
    drag = {x: event.clientX, y: event.clientY, left: rect.x, top: rect.y, moved: false};
    orb.setPointerCapture(event.pointerId);
  });
  orb.addEventListener('pointermove', event => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) { closeMenu(); position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y); }
  });
  function endDrag() {
    if (!drag) return;
    suppressClick = drag.moved;
    if (drag.moved) {
      const rect = dock.getBoundingClientRect();
      chrome.storage.local.set({position: {x: rect.x / innerWidth, y: rect.y / innerHeight}}).catch(() => {});
    }
    drag = null;
  }
  orb.addEventListener('pointerup', endDrag);
  orb.addEventListener('pointercancel', endDrag);
  orb.addEventListener('click', async () => {
    if (suppressClick) { suppressClick = false; return; }
    await settingsReady;
    if (!menu.hidden) { closeMenu(); return; }
    menu.hidden = false; orb.setAttribute('aria-expanded', 'true');
    showSettings(!setupIntroSeen);
    if (!setupIntroSeen) {
      setupIntroSeen = true;
      chrome.storage.local.set({setupIntroSeen: true}).catch(() => {});
    }
    const rect = dock.getBoundingClientRect(); position(rect.x, rect.y);
  });
  settingsToggle.addEventListener('click', () => {
    showSettings(settingsPanel.hidden);
    const rect = dock.getBoundingClientRect(); position(rect.x, rect.y);
  });
  document.addEventListener('pointerdown', event => { if (!event.composedPath().includes(host)) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  shadow.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; closeMenu();
    try {
      const result = await chrome.runtime.sendMessage({type: 'START_CAPTURE', mode: button.dataset.mode});
      if (!result?.ok) throw new Error(result?.error || '无法启动截图。');
    } catch (error) { hiddenForCapture = false; visibility(); toast(error.message + ' 如刚更新插件，请刷新页面。'); }
    finally { busy = false; }
  }));
  shadow.querySelector('#setup').addEventListener('click', () => {
    closeMenu(); chrome.runtime.sendMessage({type: 'OPEN_SETUP'}).catch(error => toast(error.message));
  });

  function findComposer() {
    return [...document.querySelectorAll('#prompt-textarea, [data-testid="prompt-textarea"], [contenteditable="true"][role="textbox"], textarea[placeholder]')]
      .find(el => el.getClientRects().length && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  }

  async function insertImage(dataUrl) {
    const composer = findComposer();
    if (!composer) return {attempted: false, error: '没有找到可用的 ChatGPT 输入框，请先打开一个可输入的对话。'};
    const binary = atob(dataUrl.split(',')[1]);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const name = `GPT截图-${Date.now()}.png`;
    const file = new File([bytes], name, {type: 'image/png', lastModified: Date.now()});
    const transfer = new DataTransfer(); transfer.items.add(file);
    const root = composer.closest('form') || composer.closest('[data-testid="composer"]') || composer.parentElement.parentElement.parentElement;
    const selector = 'img, [data-testid*="attachment"], [data-testid*="file"], button[aria-label*="Remove"], button[aria-label*="移除"], button[aria-label*="删除"]';
    const before = new Set(root.querySelectorAll(selector));
    const beforeSources = new Map([...before].map(el => [el, el.getAttribute('src')]));
    let settle, timer;
    const observed = new Promise(resolve => { settle = resolve; });
    function check() {
      const found = [...root.querySelectorAll(selector)].some(el =>
        !before.has(el) || (el.tagName === 'IMG' && el.getAttribute('src') !== beforeSources.get(el)));
      if (found || root.textContent.includes(name)) settle(true);
    }
    const observer = new MutationObserver(check);
    observer.observe(root, {childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-testid']});
    timer = setTimeout(() => settle(false), 5000);
    try {
      // Use the site's file upload input when available; preserve any typed draft.
      const candidates = [...document.querySelectorAll('input[type="file"]')].filter(el => {
        const accept = el.accept.toLowerCase();
        return !el.disabled && (!accept || /image\/\*|image\/png|\.png|\*\/\*/.test(accept));
      });
      const input = candidates.find(el => root.contains(el)) || candidates[0];
      if (input) {
        input.value = '';
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', {bubbles: true}));
      } else {
        composer.focus();
        composer.dispatchEvent(new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true, composed: true}));
      }
      check();
      const confirmed = await observed;
      if (confirmed) toast('截图已放入输入框，请检查附件后发送。');
      return {attempted: true, confirmed};
    } finally { observer.disconnect(); clearTimeout(timer); }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'PREPARE_CAPTURE') {
      hiddenForCapture = true; visibility(); shadow.querySelector('.toast').hidden = true;
      requestAnimationFrame(() => requestAnimationFrame(() => respond({ok: true})));
      return true;
    }
    if (message.type === 'CAPTURE_ENDED') { hiddenForCapture = false; visibility(); respond({ok: true}); }
    if (message.type === 'INSERT_IMAGE') {
      insertImage(message.image).then(respond).catch(error => respond({attempted: false, error: error.message}));
      return true;
    }
  });
})();
