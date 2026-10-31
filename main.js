import './style.css';

const $ = (id) => document.getElementById(id);
const state = { file: null, url: null, subtitles: [], activeIndex: -1, busy: false };
const video = $('video');

function toast(message, duration = 3500) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => el.classList.remove('show'), duration);
}
function setBusy(on, title = 'กำลังประมวลผล', message = 'กรุณารอสักครู่ อย่าปิดหน้านี้') {
  state.busy = on; $('busyOverlay').hidden = !on; $('busyTitle').textContent = title; $('busyText').textContent = message;
  $('saveState').textContent = on ? 'กำลังทำงาน…' : 'พร้อมใช้งาน';
}
function timeLabel(seconds) {
  const n = Math.max(0, Number(seconds) || 0), m = Math.floor(n / 60), s = Math.floor(n % 60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function enableEditor(enabled) {
  ['transcribeBtn','addSubtitleBtn','exportBtn','exportBtnSide'].forEach(id => $(id).disabled = !enabled);
}
function openPicker() { $('videoInput').click(); }
$('importBtn').addEventListener('click', openPicker);
$('emptyImport').addEventListener('click', openPicker);

$('videoInput').addEventListener('change', (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) { toast('กรุณาเลือกไฟล์วิดีโอ'); return; }
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file; state.url = URL.createObjectURL(file); state.subtitles = [];
  video.src = state.url; video.hidden = false; $('emptyState').hidden = true;
  $('videoName').textContent = file.name; $('subtitlePreview').hidden = true;
  enableEditor(true); renderSubtitles(); $('saveState').textContent = 'นำเข้าวิดีโอแล้ว';
});
video.addEventListener('loadedmetadata', () => $('videoDuration').textContent = timeLabel(video.duration));
video.addEventListener('timeupdate', updatePreview);

function currentSubtitle() {
  const t = video.currentTime || 0;
  return state.subtitles.find(s => t >= Number(s.start) && t <= Number(s.end));
}
function updatePreview() {
  const s = currentSubtitle(), preview = $('subtitlePreview');
  if (!s) { preview.hidden = true; return; }
  preview.hidden = false; $('previewThai').textContent = s.thai || ''; $('previewEnglish').textContent = s.english || '';
  preview.style.color = $('fontColor').value;
  preview.style.fontFamily = `"${$('fontFamily').value}", sans-serif`;
  preview.style.fontSize = `${Math.max(12, Number($('fontSize').value) * (video.clientWidth / 720))}px`;
  preview.style.textShadow = `0 2px ${$('outline').value}px #000, 0 0 5px #000`;
  const opacity = Number($('bgOpacity').value) / 100;
  preview.style.background = opacity ? `rgba(0,0,0,${opacity})` : 'transparent';
  preview.classList.toggle('at-top', $('position').value === 'top');
  preview.classList.toggle('at-middle', $('position').value === 'middle');
}
['fontFamily','fontColor','fontSize','outline','bgOpacity','position'].forEach(id => $(id).addEventListener('input', () => {
  if (id === 'fontSize') $('fontSizeValue').value = $('fontSize').value;
  if (id === 'fontColor') $('colorValue').textContent = $('fontColor').value.toUpperCase();
  if (id === 'outline') $('outlineValue').value = $('outline').value;
  if (id === 'bgOpacity') $('bgOpacityValue').value = `${$('bgOpacity').value}%`;
  updatePreview();
}));

function renderSubtitles() {
  const list = $('subtitleList'); list.innerHTML = '';
  $('subtitleCount').textContent = state.subtitles.length ? `${state.subtitles.length} รายการ` : 'ยังไม่มีซับไตเติ้ล';
  if (!state.subtitles.length) { list.innerHTML = '<div class="list-empty">นำเข้าวิดีโอ แล้วกด “สร้างซับไตเติ้ลด้วย AI”</div>'; return; }
  state.subtitles.forEach((s, i) => {
    const row = document.createElement('article'); row.className = `subtitle-row ${state.activeIndex === i ? 'selected' : ''}`;
    row.innerHTML = `<div class="row-number">${String(i+1).padStart(2,'0')}</div>
      <div class="row-content">
        <div class="time-fields"><label>เริ่ม <input aria-label="เวลาเริ่ม" type="number" min="0" step="0.1" value="${Number(s.start).toFixed(1)}" data-field="start" data-index="${i}"></label><label>จบ <input aria-label="เวลาจบ" type="number" min="0" step="0.1" value="${Number(s.end).toFixed(1)}" data-field="end" data-index="${i}"></label><button class="text-button jump" data-jump="${i}">▶ ดูช่วงนี้</button></div>
        <label class="sr-only" for="th-${i}">ภาษาไทย</label><textarea id="th-${i}" rows="1" placeholder="ข้อความภาษาไทย" data-field="thai" data-index="${i}"></textarea>
        <label class="sr-only" for="en-${i}">English</label><textarea id="en-${i}" rows="1" placeholder="English subtitle" data-field="english" data-index="${i}"></textarea>
      </div><button class="delete-btn" aria-label="ลบซับไตเติ้ล" data-delete="${i}">×</button>`;
    list.appendChild(row);
    row.querySelector(`#th-${i}`).value = s.thai || ''; row.querySelector(`#en-${i}`).value = s.english || '';
  });
  list.querySelectorAll('[data-field]').forEach(el => el.addEventListener('input', () => {
    const i = Number(el.dataset.index), field = el.dataset.field;
    state.subtitles[i][field] = field === 'start' || field === 'end' ? Number(el.value) : el.value;
    updatePreview();
  }));
  list.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => {
    const s = state.subtitles[Number(el.dataset.jump)]; video.currentTime = Number(s.start); video.play().catch(()=>{}); state.activeIndex = Number(el.dataset.jump); renderSubtitles();
  }));
  list.querySelectorAll('[data-delete]').forEach(el => el.addEventListener('click', () => {
    state.subtitles.splice(Number(el.dataset.delete), 1); renderSubtitles(); updatePreview();
  }));
}
$('addSubtitleBtn').addEventListener('click', () => {
  const start = video.currentTime || 0;
  state.subtitles.push({ start, end: start + 2, thai: 'พิมพ์ข้อความภาษาไทย', english: 'Type English subtitle' });
  renderSubtitles();
});
$('transcribeBtn').addEventListener('click', async () => {
  if (!state.file) return;
  if (state.file.size > 250 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน 250 MB สำหรับการประมวลผลครั้งนี้'); return; }
  const form = new FormData(); form.append('video', state.file);
  setBusy(true, 'กำลังแกะเสียงจากวิดีโอ', 'AI กำลังฟังเสียงและสร้างซับไตเติ้ลภาษาไทย');
  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: form });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || 'ไม่สามารถถอดเสียงได้');
    state.subtitles = data.subtitles || []; state.activeIndex = -1; renderSubtitles();
    toast(`สร้างซับไตเติ้ลสำเร็จ ${state.subtitles.length} รายการ`);
  } catch (err) { toast(err.message || 'เกิดข้อผิดพลาด'); }
  finally { setBusy(false); }
});

function stylePayload() {
  return { fontFamily: $('fontFamily').value, fontSize: Number($('fontSize').value), color: $('fontColor').value,
    position: $('position').value, outline: Number($('outline').value), bgOpacity: Number($('bgOpacity').value) };
}
async function exportVideo() {
  if (!state.file) return;
  if (!state.subtitles.length) { toast('กรุณาสร้างหรือเพิ่มซับไตเติ้ลก่อนส่งออก'); return; }
  setBusy(true, 'กำลังเรนเดอร์วิดีโอ', 'กำลังฝังซับไตเติ้ลลงในวิดีโอ อาจใช้เวลาสักครู่');
  const form = new FormData(); form.append('video', state.file);
  form.append('subtitles', JSON.stringify(state.subtitles)); form.append('style', JSON.stringify(stylePayload()));
  form.append('resolution', $('resolution').value);
  try {
    const res = await fetch('/api/export', { method: 'POST', body: form });
    if (!res.ok) { const data = await res.json().catch(()=>({})); throw new Error(data.error || 'ส่งออกไม่สำเร็จ'); }
    const blob = await res.blob(), filename = `${state.file.name.replace(/\.[^.]+$/, '')}-minicut.mp4`;
    const file = new File([blob], filename, { type: 'video/mp4' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'MiniCut Studio video' }); }
      catch (e) { if (e.name !== 'AbortError') downloadBlob(blob, filename); }
    } else downloadBlob(blob, filename);
    toast('เรนเดอร์วิดีโอเสร็จแล้ว');
  } catch (err) { toast(err.message || 'เกิดข้อผิดพลาดในการส่งออก'); }
  finally { setBusy(false); }
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('exportBtn').addEventListener('click', exportVideo); $('exportBtnSide').addEventListener('click', exportVideo);
