document.querySelector('#check').addEventListener('click', async () => {
  const button = document.querySelector('#check'), status = document.querySelector('#status');
  button.disabled = true; status.textContent = '正在检查…';
  try {
    const result = await chrome.runtime.sendMessage({type: 'CHECK_NATIVE'});
    status.textContent = result?.ok ? '已连接，可以一键隐藏并截图。回到 ChatGPT 刷新页面后使用。' : result?.error || '连接失败，请重试安装助手。';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
