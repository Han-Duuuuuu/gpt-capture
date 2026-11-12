import {rectFromPoints, fitImage, toPixels} from './geometry.js';

const $ = selector => document.querySelector(selector);
const jobId = new URLSearchParams(location.search).get('job');
const canvas = $('#canvas'), stage = $('#stage'), ctx = canvas.getContext('2d');
let job, image, fit, selection, gesture, tool = 'select', marks = [], draftMark;
let delivering = false, noticeTimer, shuttingDown = false;

async function send(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({type, jobId, ...extra});
  if (!result?.ok) throw new Error(result?.error || '扩展连接已断开，请关闭截图窗口后重试。');
  return result;
}
function notice(text, persistent = false) {
  $('#notice').textContent = text; $('#notice').hidden = false;
  clearTimeout(noticeTimer);
  if (!persistent) noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 4500);
}
async function cancel() {
  if (shuttingDown || delivering) return;
  shuttingDown = true;
  try { await send('CANCEL_CAPTURE'); } catch { window.close(); }
}
function setTool(value) {
  tool = value;
  document.querySelectorAll('[data-tool]').forEach(button => {
    const active = button.dataset.tool === value;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}
function refreshControls() {
  const selected = selection?.width >= 2 && selection?.height >= 2;
  $('#confirm').disabled = !selected || delivering;
  $('#copy').disabled = !selected || delivering;
  $('#whole').disabled = !image || delivering;
  $('#undo').disabled = marks.length === 0 || delivering;
  document.querySelectorAll('[data-tool], #color').forEach(el => { el.disabled = !image || delivering; });
}
function drawMark(context, mark) {
  context.save(); context.strokeStyle = mark.color; context.fillStyle = mark.color;
  context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round';
  const a = mark.points[0], b = mark.points[mark.points.length - 1];
  context.beginPath();
  if (mark.type === 'rectangle') context.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  else {
    context.moveTo(a.x, a.y);
    mark.points.slice(1).forEach(p => context.lineTo(p.x, p.y));
  }
  context.stroke();
  if (mark.type === 'arrow') {
    const angle = Math.atan2(b.y - a.y, b.x - a.x), length = 13;
    context.beginPath(); context.moveTo(b.x, b.y);
    context.lineTo(b.x - length * Math.cos(angle - Math.PI / 6), b.y - length * Math.sin(angle - Math.PI / 6));
    context.lineTo(b.x - length * Math.cos(angle + Math.PI / 6), b.y - length * Math.sin(angle + Math.PI / 6));
    context.closePath(); context.fill();
  }
  context.restore();
}
function render() {
  if (!image || !fit) return;
  const width = stage.clientWidth, height = stage.clientHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);
  ctx.fillStyle = '#050c10a6'; ctx.fillRect(0, 0, width, height);
  if (selection?.width > 0 && selection?.height > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(selection.x, selection.y, selection.width, selection.height); ctx.clip();
    ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);
    marks.forEach(mark => drawMark(ctx, mark));
    if (draftMark) drawMark(ctx, draftMark);
    ctx.restore();
    ctx.strokeStyle = '#a2f4d8'; ctx.lineWidth = 1;
    ctx.strokeRect(selection.x + .5, selection.y + .5, selection.width - 1, selection.height - 1);
    ctx.fillStyle = '#a2f4d8';
    for (const x of [selection.x, selection.x + selection.width]) {
      for (const y of [selection.y, selection.y + selection.height]) ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    const pixels = toPixels(selection, fit, image.naturalWidth, image.naturalHeight);
    $('#dimensions').textContent = `${pixels.width} × ${pixels.height} px`;
    $('#dimensions').style.left = `${Math.min(width - 150, Math.max(0, selection.x))}px`;
    $('#dimensions').style.top = `${selection.y > 32 ? selection.y - 30 : selection.y + 8}px`;
    $('#dimensions').hidden = false;
  } else $('#dimensions').hidden = true;
  refreshControls();
}
function resize() {
  if (!image) return;
  const ratio = devicePixelRatio || 1;
  const width = stage.clientWidth, height = stage.clientHeight;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const next = fitImage(image.naturalWidth, image.naturalHeight, width, height);
  if (fit && selection) {
    // Preserve the selected pixels and annotations across window resizing.
    const remap = point => ({x: next.x + (point.x - fit.x) * next.scale / fit.scale,
      y: next.y + (point.y - fit.y) * next.scale / fit.scale});
    const p = remap(selection);
    selection = {...p, width: selection.width * next.scale / fit.scale, height: selection.height * next.scale / fit.scale};
    marks = marks.map(mark => ({...mark, points: mark.points.map(remap)}));
  }
  fit = next; render();
}
async function loadImage(dataUrl) {
  const next = new Image(); next.src = dataUrl; await next.decode();
  image = next; selection = null; marks = []; fit = null;
  $('#intro').hidden = true; canvas.hidden = false;
  $('#instruction').textContent = '拖动框选 · Enter 确认 · Esc 取消';
  await send('EDITOR_STATE', {state: 'maximized'});
  resize();
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return {x: Math.max(fit.x, Math.min(fit.x + fit.width, event.clientX - rect.x)),
    y: Math.max(fit.y, Math.min(fit.y + fit.height, event.clientY - rect.y))};
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !image || delivering) return;
  canvas.focus({preventScroll: true});
  const p = point(event);
  if (tool !== 'select' && (!selection || p.x < selection.x || p.x > selection.x + selection.width || p.y < selection.y || p.y > selection.y + selection.height)) {
    notice('请先框选区域，再在选区内标注。'); return;
  }
  canvas.setPointerCapture(event.pointerId); gesture = p;
  if (tool === 'select') { selection = null; marks = []; }
  else draftMark = {type: tool, color: $('#color').value, points: [p, p]};
  render();
});
canvas.addEventListener('pointermove', event => {
  if (!gesture || delivering) return;
  const p = point(event);
  if (tool === 'select') selection = rectFromPoints(gesture, p, stage.clientWidth, stage.clientHeight);
  else if (draftMark.type === 'pen') draftMark.points.push(p);
  else draftMark.points[1] = p;
  render();
});
function endGesture() {
  if (draftMark) { marks.push(draftMark); draftMark = null; }
  gesture = null; render();
}
canvas.addEventListener('pointerup', endGesture);
canvas.addEventListener('pointercancel', endGesture);
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('#undo').addEventListener('click', () => { marks.pop(); render(); });
$('#whole').addEventListener('click', () => {
  if (!image) return;
  selection = {x: fit.x, y: fit.y, width: fit.width, height: fit.height}; marks = []; setTool('select'); render();
  canvas.focus({preventScroll: true});
});

async function crop() {
  if (!image || !selection || selection.width < 2 || selection.height < 2) throw new Error('请先拖动鼠标框选截图区域。');
  const pixels = toPixels(selection, fit, image.naturalWidth, image.naturalHeight);
  if (!pixels.width || !pixels.height) throw new Error('截图范围太小，请重新框选。');
  const output = document.createElement('canvas'); output.width = pixels.width; output.height = pixels.height;
  const context = output.getContext('2d');
  context.drawImage(image, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, pixels.width, pixels.height);
  context.save(); context.scale(1 / fit.scale, 1 / fit.scale);
  context.translate(-fit.x - pixels.x * fit.scale, -fit.y - pixels.y * fit.scale);
  marks.forEach(mark => drawMark(context, mark)); context.restore();
  const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
  output.width = output.height = 0;
  if (!blob) throw new Error('图片生成失败，请重新截图。');
  return blob;
}
async function deliver() {
  if (delivering || $('#confirm').disabled) return;
  delivering = true; refreshControls(); $('#confirm').textContent = '正在放入…';
  try {
    const blob = await crop();
    if (blob.size > 18 * 1024 * 1024) throw new Error('截图太大，请缩小范围后重试（上限 18 MB）。');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    const result = await send('DELIVER_IMAGE', {image: dataUrl});
    if (!result.confirmed) {
      notice(result.error || '已尝试添加图片，但未检测到新附件。请检查 ChatGPT；若未出现，点击“复制图片”，返回输入框按 Ctrl+V（Mac 为 ⌘V）。', true);
      $('#confirm').textContent = result.attempted ? '再次放入（请先检查附件）' : '重试放入输入框';
    }
  } catch (error) { notice(error.message, true); $('#confirm').textContent = '重试放入输入框'; }
  finally { delivering = false; refreshControls(); }
}
$('#confirm').addEventListener('click', deliver);
$('#copy').addEventListener('click', async () => {
  try {
    // Start clipboard.write within the click gesture; the Blob may resolve asynchronously.
    await navigator.clipboard.write([new ClipboardItem({'image/png': crop()})]);
    notice('已复制图片。点击“取消”回到 ChatGPT，再在输入框按 Ctrl+V（Mac 为 ⌘V）。', true);
  } catch (error) { notice('复制失败：' + error.message, true); }
});
$('#cancel').addEventListener('click', cancel);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  if (event.key === 'Enter' && event.target.tagName !== 'BUTTON' && event.target.tagName !== 'INPUT') { event.preventDefault(); deliver(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !delivering) { event.preventDefault(); marks.pop(); render(); }
});
new ResizeObserver(resize).observe(stage);

refreshControls();
try {
  const result = await send('GET_JOB'); job = result.job;
  $('#mode-label').textContent = job.mode === 'page' ? '当前页面 / 框选截图' : '隐藏本页 / 框选截图';
  await loadImage(result.image);
} catch (error) {
  $('#intro-description').textContent = error.message;
  notice('请按 Esc 关闭后重试。', true);
}
