/* ═══════════════════════════════════════════
   QR ATTENDANCE SYSTEM — SCRIPT v3
   ═══════════════════════════════════════════ */
'use strict';

/* ── PWA ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./service-worker.js').catch(() => {})
  );
}
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstall = e;
  document.getElementById('install-btn').classList.remove('hidden');
});
document.getElementById('install-btn').addEventListener('click', () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  deferredInstall.userChoice.then(() => {
    deferredInstall = null;
    document.getElementById('install-btn').classList.add('hidden');
  });
});

/* ══════════════════════════════════════
   INDEXEDDB
══════════════════════════════════════ */
const DB_NAME = 'qr_attendance_v3', DB_VER = 2;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('students')) {
        d.createObjectStore('students', { keyPath: 'studentId' })
         .createIndex('name', 'name', { unique: false });
      }
      if (!d.objectStoreNames.contains('sessions')) {
        d.createObjectStore('sessions', { keyPath: 'sessionId' });
      }
      if (!d.objectStoreNames.contains('attendance')) {
        const s = d.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
        s.createIndex('sessionId', 'sessionId', { unique: false });
        s.createIndex('studentId', 'studentId', { unique: false });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

const dbGet    = (store, key) => idb(store, 'readonly',  s => s.get(key));
const dbGetAll = store        => idb(store, 'readonly',  s => s.getAll());
const dbPut    = (store, val) => idb(store, 'readwrite', s => s.put(val));
const dbAdd    = (store, val) => idb(store, 'readwrite', s => s.add(val));
const dbDel    = (store, key) => idb(store, 'readwrite', s => s.delete(key));
const dbIdx    = (store, idx, val) => idb(store, 'readonly', s => s.index(idx).getAll(val));

function idb(store, mode, fn) {
  return new Promise((res, rej) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror   = e => rej(e.target.error);
  });
}

/* ══════════════════════════════════════
   NAVIGATION
══════════════════════════════════════ */
const stack = [];

const PAGE_TITLES = {
  'page-dashboard':'QR Attendance','page-add-student':'Add Student',
  'page-students':'Students List','page-profile':'Student Profile',
  'page-edit-student':'Edit Student','page-generate-qr':'Generate QR Codes',
  'page-qr-view':'QR Card','page-start-attendance':'Start Attendance',
  'page-scanner':'Scanning...','page-history':'Attendance History',
  'page-session-detail':'Session Detail','page-export-students':'Export Students',
  'page-export-attendance':'Export Attendance','page-stats':'Statistics',
  'page-restore':'Restore Data'
};

function showPage(id, push = true) {
  // Stop camera if leaving scanner
  const active = document.querySelector('.page.active');
  if (active && active.id === 'page-scanner' && id !== 'page-scanner') stopCamera();

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(id);
  if (page) { page.classList.add('active'); page.scrollTop = 0; }
  if (push) stack.push(id);

  document.getElementById('back-btn').classList.toggle('hidden', id === 'page-dashboard');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[id] || 'QR Attendance';

  // Page loaders
  if (id === 'page-students')          loadStudentsList();
  if (id === 'page-generate-qr')       loadQRStudents();
  if (id === 'page-history')           loadSessions();
  if (id === 'page-stats')             loadStats();
  if (id === 'page-export-attendance') loadSessionsForExport();
  if (id === 'page-dashboard')         updateDashStats();
}

function goBack() {
  stack.pop();
  const prev = stack.length ? stack[stack.length - 1] : 'page-dashboard';
  showPage(prev, false);
}

/* ══════════════════════════════════════
   TOAST & MODAL
══════════════════════════════════════ */
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

let modalCb = null;
function showModal(title, body, cb) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent  = body;
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalCb = cb;
}
function closeModal()       { document.getElementById('modal-overlay').classList.add('hidden'); modalCb = null; }
function modalConfirmAction(){ if (modalCb) modalCb(); closeModal(); }

function showFormMsg(id, msg, type='success') {
  const el = document.getElementById(id);
  el.textContent = msg; el.className = 'form-msg ' + type;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

/* ══════════════════════════════════════
   PHOTO UPLOAD
══════════════════════════════════════ */
let currentPhoto = null, editPhoto = null;

function handlePhotoUpload(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    currentPhoto = ev.target.result;
    const img = document.getElementById('photo-preview');
    img.src = currentPhoto; img.classList.remove('hidden');
    document.getElementById('photo-placeholder').classList.add('hidden');
  };
  r.readAsDataURL(f);
}
function handleEditPhotoUpload(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    editPhoto = ev.target.result;
    const img = document.getElementById('edit-photo-preview');
    img.src = editPhoto; img.classList.remove('hidden');
    document.getElementById('edit-photo-placeholder').classList.add('hidden');
  };
  r.readAsDataURL(f);
}

/* ══════════════════════════════════════
   ADD / EDIT / DELETE STUDENT
══════════════════════════════════════ */
function resetStudentForm() {
  ['f-name','f-id','f-father','f-email','f-phone'].forEach(i => document.getElementById(i).value = '');
  currentPhoto = null;
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-placeholder').classList.remove('hidden');
  document.getElementById('student-photo').value = '';
}

async function saveStudent() {
  const name      = document.getElementById('f-name').value.trim();
  const studentId = document.getElementById('f-id').value.trim();
  const father    = document.getElementById('f-father').value.trim();
  const email     = document.getElementById('f-email').value.trim();
  const phone     = document.getElementById('f-phone').value.trim();

  if (!name || !studentId)
    return showFormMsg('student-form-msg', '⚠ Name and Student ID are required.', 'error');

  if (await dbGet('students', studentId))
    return showFormMsg('student-form-msg', '⚠ Student ID already exists.', 'error');

  await dbPut('students', { studentId, name, father, email, phone, photo: currentPhoto, createdAt: new Date().toISOString() });
  showFormMsg('student-form-msg', '✓ Student saved successfully!', 'success');
  resetStudentForm();
  updateDashStats();
}

async function editStudent(studentId) {
  const s = await dbGet('students', studentId); if (!s) return;
  document.getElementById('edit-original-id').value = s.studentId;
  document.getElementById('ef-name').value   = s.name;
  document.getElementById('ef-id').value     = s.studentId;
  document.getElementById('ef-father').value = s.father || '';
  document.getElementById('ef-email').value  = s.email  || '';
  document.getElementById('ef-phone').value  = s.phone  || '';
  editPhoto = s.photo || null;
  const img = document.getElementById('edit-photo-preview');
  if (s.photo) { img.src = s.photo; img.classList.remove('hidden'); document.getElementById('edit-photo-placeholder').classList.add('hidden'); }
  else         { img.classList.add('hidden'); document.getElementById('edit-photo-placeholder').classList.remove('hidden'); }
  showPage('page-edit-student');
}

async function updateStudent() {
  const origId    = document.getElementById('edit-original-id').value;
  const name      = document.getElementById('ef-name').value.trim();
  const studentId = document.getElementById('ef-id').value.trim();
  const father    = document.getElementById('ef-father').value.trim();
  const email     = document.getElementById('ef-email').value.trim();
  const phone     = document.getElementById('ef-phone').value.trim();

  if (!name || !studentId)
    return showFormMsg('edit-form-msg', '⚠ Name and Student ID are required.', 'error');

  if (studentId !== origId && await dbGet('students', studentId))
    return showFormMsg('edit-form-msg', '⚠ Student ID already exists.', 'error');

  const orig = (await dbGet('students', origId)) || {};
  if (studentId !== origId) await dbDel('students', origId);
  await dbPut('students', {
    studentId, name, father, email, phone,
    photo: editPhoto !== null ? editPhoto : (orig.photo || null),
    createdAt: orig.createdAt || new Date().toISOString()
  });
  showFormMsg('edit-form-msg', '✓ Updated!', 'success');
  setTimeout(() => openProfile(studentId), 1000);
}

function deleteStudentConfirm(studentId) {
  showModal('Delete Student', `Delete student "${studentId}"? This cannot be undone.`, async () => {
    await dbDel('students', studentId);
    showToast('Student deleted', 'success');
    updateDashStats();
    goBack();
  });
}

/* ══════════════════════════════════════
   STUDENTS LIST
══════════════════════════════════════ */
let allStudents = [];

async function loadStudentsList() {
  allStudents = await dbGetAll('students');
  allStudents.sort((a, b) => a.name.localeCompare(b.name));
  renderStudents(allStudents);
}

function filterStudents() {
  const q = document.getElementById('search-input').value.toLowerCase();
  renderStudents(allStudents.filter(s =>
    s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q)
  ));
}

function renderStudents(list) {
  const grid = document.getElementById('students-grid');
  document.getElementById('students-count').textContent = `${list.length} student${list.length !== 1 ? 's' : ''}`;
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span class="es-icon">👥</span>No students found</div>';
    return;
  }
  grid.innerHTML = list.map(s => `
    <div class="student-card" onclick="openProfile('${esc(s.studentId)}')">
      ${s.photo ? `<img class="student-card-photo" src="${s.photo}" alt="${esc(s.name)}"/>`
                : `<div class="student-card-avatar">👤</div>`}
      <div class="student-card-name">${esc(s.name)}</div>
      <div class="student-card-id">${esc(s.studentId)}</div>
    </div>`).join('');
}

/* ── STUDENT PROFILE ── */
async function openProfile(studentId) {
  const s = await dbGet('students', studentId); if (!s) return;

  // Get all attendance records for this student
  const records = await dbIdx('attendance', 'studentId', studentId);
  records.sort((a, b) => b.id - a.id);

  const photoHtml = s.photo
    ? `<img class="profile-photo" src="${s.photo}" alt="${esc(s.name)}"/>`
    : `<div class="profile-avatar">👤</div>`;

  const attHtml = records.length ? records.map(r => `
    <div class="att-record-item">
      <div class="att-record-lecture">📚 ${esc(r.lecture)}</div>
      <div class="att-record-meta">📅 ${r.date} &nbsp;🕐 ${r.time} &nbsp;📍 ${esc(r.venue)} &nbsp;👨‍🏫 ${esc(r.teacher)}</div>
    </div>`).join('')
    : `<p style="color:var(--text-muted);font-size:13px;">No attendance records yet.</p>`;

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-hero">
      ${photoHtml}
      <div class="profile-name">${esc(s.name)}</div>
      <div class="profile-id">${esc(s.studentId)}</div>
    </div>
    <div class="profile-fields">
      <div class="pf-row"><label>Father Name</label><span>${esc(s.father||'—')}</span></div>
      <div class="pf-row"><label>Email</label><span>${esc(s.email||'—')}</span></div>
      <div class="pf-row"><label>Phone</label><span>${esc(s.phone||'—')}</span></div>
      <div class="pf-row"><label>Registered</label><span>${new Date(s.createdAt).toLocaleDateString()}</span></div>
      <div class="pf-row"><label>Total Attendance</label><span style="color:var(--green)">${records.length} sessions</span></div>
    </div>
    <div class="profile-actions">
      <button class="btn-secondary" onclick="editStudent('${esc(s.studentId)}')">✏ Edit</button>
      <button class="btn-danger"    onclick="deleteStudentConfirm('${esc(s.studentId)}')">🗑 Delete</button>
      <button class="btn-primary"   onclick="viewQRCard('${esc(s.studentId)}')">📱 View QR</button>
      <button class="btn-secondary" onclick="downloadStudentQRPNG('${esc(s.studentId)}')">⬇ Download QR</button>
    </div>
    <div class="profile-att-section">
      <h3>Attendance History (${records.length})</h3>
      ${attHtml}
    </div>`;

  showPage('page-profile');
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════
   DASHBOARD STATS
══════════════════════════════════════ */
async function updateDashStats() {
  const [students, sessions, attendance] = await Promise.all([
    dbGetAll('students'), dbGetAll('sessions'), dbGetAll('attendance')
  ]);
  document.getElementById('qs-students').textContent  = students.length;
  document.getElementById('qs-sessions').textContent  = sessions.length;
  document.getElementById('qs-records').textContent   = attendance.length;
}

/* ══════════════════════════════════════
   QR CODE GENERATION
══════════════════════════════════════ */
let allQRStudents = [], currentQRStudent = null;

async function loadQRStudents() {
  allQRStudents = await dbGetAll('students');
  allQRStudents.sort((a, b) => a.name.localeCompare(b.name));
  renderQRStudents(allQRStudents);
}

function filterQRStudents() {
  const q = document.getElementById('qr-search').value.toLowerCase();
  renderQRStudents(allQRStudents.filter(s =>
    s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q)
  ));
}

function renderQRStudents(list) {
  const grid = document.getElementById('qr-students-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span class="es-icon">📱</span>No students found</div>';
    return;
  }
  grid.innerHTML = list.map(s => `
    <div class="student-card" onclick="viewQRCard('${esc(s.studentId)}')">
      ${s.photo ? `<img class="student-card-photo" src="${s.photo}" alt="${esc(s.name)}"/>`
                : `<div class="student-card-avatar">👤</div>`}
      <div class="student-card-name">${esc(s.name)}</div>
      <div class="student-card-id">${esc(s.studentId)}</div>
    </div>`).join('');
}

async function viewQRCard(studentId) {
  currentQRStudent = await dbGet('students', studentId);
  if (!currentQRStudent) return;
  renderQRCardHTML(currentQRStudent);
  showPage('page-qr-view');
}

function renderQRCardHTML(student) {
  const photoHtml = student.photo
    ? `<img class="qr-student-photo" src="${student.photo}" alt="${esc(student.name)}"/>`
    : `<div class="qr-student-avatar">👤</div>`;

  document.getElementById('qr-card-container').innerHTML = `
    <div class="qr-card-outer">
      <div class="qr-card" id="qr-card-el">
        <div class="qr-card-header">
          <div class="qr-univ-logo">🎓</div>
          <div class="qr-univ-name">UNIVERSITY ATTENDANCE CARD</div>
        </div>
        <div class="qr-card-body">
          ${photoHtml}
          <div class="qr-name-badge">${esc(student.name)}</div>
          <div class="qr-student-id">${esc(student.studentId)}</div>
          <div class="qr-code-wrap" id="qr-render-target"></div>
        </div>
        <div class="qr-card-footer">SCAN TO MARK ATTENDANCE • ${new Date().getFullYear()}</div>
      </div>
    </div>`;

  setTimeout(() => {
    const target = document.getElementById('qr-render-target');
    if (!target) return;
    try {
      new QRCode(target, {
        text: student.studentId,
        width: 160, height: 160,
        colorDark: '#0a1628', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch(e) { console.error('QR render error', e); }
  }, 50);
}

/* ── Get QR as data URL (reliable polling) ── */
function getQRDataURL(studentId) {
  return new Promise(resolve => {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:200px;height:200px;background:#fff;';
    document.body.appendChild(tmp);
    try {
      new QRCode(tmp, { text: studentId, width: 200, height: 200, colorDark: '#0a1628', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
      let tries = 0;
      const poll = setInterval(() => {
        tries++;
        const img = tmp.querySelector('img');
        if (img && img.src && img.src.startsWith('data:')) {
          clearInterval(poll);
          const url = img.src;
          try { document.body.removeChild(tmp); } catch {}
          resolve(url);
        } else if (tries > 60) {
          clearInterval(poll);
          try { document.body.removeChild(tmp); } catch {}
          resolve(null);
        }
      }, 50);
    } catch { try { document.body.removeChild(tmp); } catch {} resolve(null); }
  });
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function downloadQRPNG() {
  if (!currentQRStudent) return;
  showToast('Generating PNG...');
  const qrUrl = await getQRDataURL(currentQRStudent.studentId);
  if (!qrUrl) return showToast('QR generation failed', 'error');

  const W = 340, H = 490;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0,0,W,90);
  g.addColorStop(0,'#0a1628'); g.addColorStop(1,'#00c853');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,90);
  ctx.font = '38px serif'; ctx.textAlign = 'center';
  ctx.fillText('🎓', W/2, 44);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial';
  ctx.fillText('UNIVERSITY ATTENDANCE CARD', W/2, 70);

  // Photo circle
  const ps = 76, px = (W-ps)/2, py = 102, cx = W/2, cy = py+ps/2;
  ctx.beginPath(); ctx.arc(cx,cy,ps/2+4,0,Math.PI*2); ctx.fillStyle='#00c853'; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,ps/2,0,Math.PI*2); ctx.clip();
  if (currentQRStudent.photo) {
    try { const pi = await loadImg(currentQRStudent.photo); ctx.drawImage(pi,px,py,ps,ps); }
    catch { ctx.fillStyle='#e8f5e9'; ctx.fillRect(px,py,ps,ps); }
  } else { ctx.fillStyle='#e8f5e9'; ctx.fillRect(px,py,ps,ps); ctx.fillStyle='#aaa'; ctx.font='36px serif'; ctx.fillText('👤',W/2,cy+12); }
  ctx.restore();

  // Name badge
  const ny = py+ps+18;
  ctx.fillStyle='#0a1628'; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(24,ny,W-48,38,19); else ctx.rect(24,ny,W-48,38);
  ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='bold 17px Arial'; ctx.textAlign='center';
  let dn = currentQRStudent.name;
  while (ctx.measureText(dn).width > W-80 && dn.length > 3) dn = dn.slice(0,-1);
  if (dn !== currentQRStudent.name) dn += '…';
  ctx.fillText(dn, W/2, ny+25);
  ctx.fillStyle='#00c853'; ctx.font='bold 13px Arial';
  ctx.fillText(currentQRStudent.studentId, W/2, ny+54);

  // QR
  try {
    const qi = await loadImg(qrUrl);
    const qs=170, qx=(W-qs)/2, qy=ny+66;
    ctx.fillStyle='#fff'; ctx.strokeStyle='#ddd'; ctx.lineWidth=2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(qx-10,qy-10,qs+20,qs+20,10); else ctx.rect(qx-10,qy-10,qs+20,qs+20);
    ctx.fill(); ctx.stroke();
    ctx.drawImage(qi,qx,qy,qs,qs);
  } catch(e) { console.error('QR draw error',e); }

  ctx.fillStyle='#f5f5f5'; ctx.fillRect(0,H-36,W,36);
  ctx.fillStyle='#999'; ctx.font='11px Arial';
  ctx.fillText('SCAN TO MARK ATTENDANCE • '+new Date().getFullYear(), W/2, H-15);

  const a = document.createElement('a');
  a.download = `QR_${currentQRStudent.studentId}_${currentQRStudent.name.replace(/\s+/g,'_')}.png`;
  a.href = cv.toDataURL('image/png');
  a.click();
  showToast('PNG downloaded!', 'success');
}

async function downloadQRPDF() {
  if (!currentQRStudent || !window.jspdf) return showToast('PDF library not loaded','error');
  showToast('Generating PDF...');
  const qrUrl = await getQRDataURL(currentQRStudent.studentId);
  if (!qrUrl) return showToast('QR generation failed','error');
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({unit:'mm',format:[86,124]});
  doc.setFillColor(10,22,40); doc.rect(0,0,86,28,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont(undefined,'bold');
  doc.text('UNIVERSITY ATTENDANCE CARD',43,14,{align:'center'});
  let yo = 32;
  if (currentQRStudent.photo) {
    try { doc.addImage(currentQRStudent.photo,'JPEG',31,30,24,24,undefined,'FAST'); yo=58; } catch {}
  }
  doc.setFillColor(10,22,40);
  doc.roundedRect(8,yo,70,10,2,2,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(8);
  let dn = currentQRStudent.name; if (dn.length>24) dn=dn.slice(0,23)+'…';
  doc.text(dn,43,yo+7,{align:'center'});
  doc.setTextColor(0,200,83); doc.setFontSize(7);
  doc.text(currentQRStudent.studentId,43,yo+16,{align:'center'});
  doc.addImage(qrUrl,'PNG',18,yo+20,50,50);
  doc.setFillColor(245,245,245); doc.rect(0,114,86,10,'F');
  doc.setTextColor(153,153,153); doc.setFontSize(5);
  doc.text('SCAN TO MARK ATTENDANCE',43,120,{align:'center'});
  doc.save(`QR_${currentQRStudent.studentId}.pdf`);
  showToast('PDF downloaded!','success');
}

function printQRCard() {
  const card = document.getElementById('qr-card-el');
  if (!card) return;
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>QR Card</title>
  <style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#fff;}
  @media print{body{height:auto;}}
  .qr-card{background:#fff;border-radius:16px;overflow:hidden;width:320px;font-family:sans-serif;border:1px solid #ddd;}
  .qr-card-header{background:linear-gradient(135deg,#0a1628,#00c853);padding:16px;text-align:center;color:#fff;}
  .qr-univ-logo{font-size:32px;}.qr-univ-name{font-size:13px;font-weight:700;letter-spacing:1px;margin-top:4px;}
  .qr-card-body{padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px;}
  .qr-student-photo,.qr-student-avatar{width:70px;height:70px;border-radius:50%;border:3px solid #00c853;}
  .qr-student-photo{object-fit:cover;}.qr-student-avatar{background:#e8f5e9;display:flex;align-items:center;justify-content:center;font-size:34px;}
  .qr-name-badge{background:#0a1628;color:#fff;padding:6px 14px;border-radius:20px;font-size:17px;font-weight:700;text-align:center;width:100%;}
  .qr-student-id{color:#00c853;font-size:13px;font-weight:700;letter-spacing:1px;}
  .qr-code-wrap{background:#fff;padding:8px;border-radius:8px;border:2px solid #e0e0e0;}
  .qr-code-wrap img{display:block;}
  .qr-card-footer{background:#f5f5f5;padding:8px;text-align:center;font-size:10px;color:#666;}
  </style></head><body>${card.outerHTML}<script>window.onload=()=>{setTimeout(()=>window.print(),500)}<\/script></body></html>`);
  win.document.close();
}

async function downloadStudentQRPNG(studentId) {
  const s = await dbGet('students', studentId); if (!s) return;
  currentQRStudent = s;
  await downloadQRPNG();
}

async function downloadAllQRZip() {
  if (!window.JSZip) return showToast('ZIP library not loaded','error');
  const students = await dbGetAll('students');
  if (!students.length) return showToast('No students found','error');
  showToast('Generating ZIP...');
  const zip = new JSZip();
  for (const s of students) {
    const url = await getQRDataURL(s.studentId);
    if (url) zip.file(`QR_${s.studentId}_${s.name.replace(/\s+/g,'_')}.png`, url.split(',')[1], {base64:true});
  }
  const blob = await zip.generateAsync({type:'blob'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download='All_QR_Codes.zip'; a.click();
  URL.revokeObjectURL(a.href);
  showToast('ZIP downloaded!','success');
}

/* ══════════════════════════════════════
   BEEP + VIBRATION
══════════════════════════════════════ */
let audioCtx = null;
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function beep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'square'; osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.18);
  } catch {}
}
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/* ══════════════════════════════════════
   ATTENDANCE SESSION
══════════════════════════════════════ */
let currentSession   = null;
let sessionMarkedSet = new Set();
let scanAF  = null;
let stream  = null;
let scanning = false;    // pause scanning while popup is open
let lastCode = '';
let lastCodeTime = 0;
let scannedCount = 0;
let presentCount = 0;
let lastEndedSessionId = null;

async function startAttendanceSession() {
  const lecture = document.getElementById('att-lecture').value.trim();
  const teacher = document.getElementById('att-teacher').value.trim();
  const venue   = document.getElementById('att-venue').value.trim();

  if (!lecture || !teacher || !venue)
    return showFormMsg('att-form-msg','⚠ All fields are required.','error');

  const sessionId = Date.now();
  currentSession = {
    sessionId, lecture, teacher, venue,
    date: new Date().toLocaleDateString('en-PK'),
    time: new Date().toLocaleTimeString('en-PK'),
    startedAt: new Date().toISOString()
  };
  sessionMarkedSet = new Set();
  scannedCount = 0; presentCount = 0; scanning = false;
  lastCode = ''; lastCodeTime = 0;

  document.getElementById('scan-lecture').textContent = lecture;
  document.getElementById('scan-teacher').textContent = teacher;
  document.getElementById('scan-venue').textContent   = venue;
  document.getElementById('cnt-scanned').textContent  = '0';
  document.getElementById('cnt-present').textContent  = '0';
  document.getElementById('scan-popup').classList.add('hidden');

  ['att-lecture','att-teacher','att-venue'].forEach(id => document.getElementById(id).value = '');
  showPage('page-scanner');

  // Init audio on user gesture
  initAudio();
  await startCamera();
}

async function startCamera() {
  const video = document.getElementById('qr-video');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    scanning = true;
    scanLoop();
  } catch(err) {
    showToast('Camera error: ' + err.message, 'error');
  }
}

function stopCamera() {
  scanning = false;
  if (scanAF) { cancelAnimationFrame(scanAF); scanAF = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  const v = document.getElementById('qr-video');
  if (v) v.srcObject = null;
}

function scanLoop() {
  const video  = document.getElementById('qr-video');
  const canvas = document.getElementById('scan-canvas');
  const ctx    = canvas.getContext('2d', { willReadFrequently: true });

  const tick = () => {
    if (!stream || !scanning) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const vw = video.videoWidth, vh = video.videoHeight;
      // Scan center crop for speed (80% of frame)
      const cropW = Math.floor(vw * 0.8), cropH = Math.floor(vh * 0.8);
      const cropX = Math.floor((vw - cropW) / 2), cropY = Math.floor((vh - cropH) / 2);
      canvas.width = cropW; canvas.height = cropH;
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      const imgData = ctx.getImageData(0, 0, cropW, cropH);
      const code = jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: 'attemptBoth'  // better detection at distance
      });
      if (code && code.data) {
        const now = Date.now();
        // Cooldown: same code within 2.5s ignored
        if (code.data !== lastCode || now - lastCodeTime > 2500) {
          lastCode = code.data;
          lastCodeTime = now;
          onQRDetected(code.data);
        }
      }
    }
    scanAF = requestAnimationFrame(tick);
  };
  scanAF = requestAnimationFrame(tick);
}

async function onQRDetected(qrData) {
  scanning = false; // pause scanner while showing popup
  scannedCount++;
  document.getElementById('cnt-scanned').textContent = scannedCount;

  beep();
  vibrate([80]);

  const student = await dbGet('students', qrData);
  const popup   = document.getElementById('scan-popup');

  // Reset popup state
  document.getElementById('popup-confirm-btn').classList.remove('hidden');
  document.getElementById('popup-already').classList.add('hidden');
  document.getElementById('popup-notfound').classList.add('hidden');

  if (!student) {
    // Student not found
    vibrate([100, 60, 100]);
    document.getElementById('popup-photo').src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="%23ff3d57"/><text x="40" y="56" font-size="40" text-anchor="middle" fill="white">?</text></svg>';
    document.getElementById('popup-name').textContent = 'Unknown QR Code';
    document.getElementById('popup-id').textContent   = qrData;
    document.getElementById('popup-confirm-btn').classList.add('hidden');
    document.getElementById('popup-notfound').classList.remove('hidden');
    popup.classList.remove('hidden');
    return;
  }

  // Set photo
  const photoEl = document.getElementById('popup-photo');
  photoEl.src = student.photo || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="%23142445"/><text x="40" y="56" font-size="40" text-anchor="middle" fill="%2300c853">👤</text></svg>';
  document.getElementById('popup-name').textContent = student.name;
  document.getElementById('popup-id').textContent   = student.studentId;

  if (sessionMarkedSet.has(student.studentId)) {
    vibrate([60, 40, 60]);
    document.getElementById('popup-confirm-btn').classList.add('hidden');
    document.getElementById('popup-already').classList.remove('hidden');
  }

  // Store for confirm
  window._pendingStudent = student;
  popup.classList.remove('hidden');
}

async function confirmAttendance() {
  const student = window._pendingStudent;
  if (!student || !currentSession) return;
  if (sessionMarkedSet.has(student.studentId)) return;

  sessionMarkedSet.add(student.studentId);
  presentCount++;
  document.getElementById('cnt-present').textContent = presentCount;

  await dbAdd('attendance', {
    sessionId:   currentSession.sessionId,
    studentId:   student.studentId,
    studentName: student.name,
    date:        new Date().toLocaleDateString('en-PK'),
    time:        new Date().toLocaleTimeString('en-PK'),
    lecture:     currentSession.lecture,
    venue:       currentSession.venue,
    teacher:     currentSession.teacher,
    markedAt:    new Date().toISOString()
  });

  beep();
  vibrate([30, 30, 80]);
  showToast(`✓ ${student.name} — Present`, 'success');
  closePopup();
}

function closePopup() {
  document.getElementById('scan-popup').classList.add('hidden');
  window._pendingStudent = null;
  lastCode = '';       // allow same code immediately after popup close
  scanning = true;     // resume scanner
  if (stream && !scanAF) scanLoop();
}

async function endAttendanceSession() {
  if (!currentSession) { showPage('page-dashboard'); return; }
  showModal('End Attendance',
    `End session for "${currentSession.lecture}"?\nTotal present: ${presentCount}`,
    async () => {
      stopCamera();
      const sess = {
        ...currentSession,
        endedAt:      new Date().toISOString(),
        totalPresent: presentCount,
        totalScanned: scannedCount
      };
      await dbPut('sessions', sess);
      lastEndedSessionId = currentSession.sessionId;
      currentSession = null;
      updateDashStats();

      // Show export modal
      document.getElementById('export-modal-summary').textContent =
        `Session saved! Present: ${presentCount} students.\nWould you like to export this session?`;
      document.getElementById('export-modal').classList.remove('hidden');
    }
  );
}

/* ── Export last session ── */
async function exportLastSessionCSV() {
  closeExportModal();
  if (lastEndedSessionId) await exportSessionCSV(lastEndedSessionId);
  showPage('page-dashboard');
}
async function exportLastSessionExcel() {
  closeExportModal();
  if (lastEndedSessionId) await exportSessionExcel(lastEndedSessionId);
  showPage('page-dashboard');
}
function closeExportModal() {
  document.getElementById('export-modal').classList.add('hidden');
  stack.length = 0;
}

/* ══════════════════════════════════════
   ATTENDANCE HISTORY
══════════════════════════════════════ */
async function loadSessions() {
  const sessions = await dbGetAll('sessions');
  sessions.sort((a, b) => b.sessionId - a.sessionId);
  const list = document.getElementById('sessions-list');
  if (!sessions.length) {
    list.innerHTML = '<div class="empty-state"><span class="es-icon">📋</span>No sessions yet</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-card" onclick="openSessionDetail(${s.sessionId})">
      <div class="session-card-top">
        <div class="session-lecture">${esc(s.lecture)}</div>
        <div class="session-badge">${s.totalPresent} Present</div>
      </div>
      <div class="session-meta">
        <span>👨‍🏫 ${esc(s.teacher)}</span>
        <span>📍 ${esc(s.venue)}</span>
        <span>📅 ${s.date}</span>
        <span>🕐 ${s.time}</span>
      </div>
    </div>`).join('');
}

async function openSessionDetail(sessionId) {
  const sessions = await dbGetAll('sessions');
  const session  = sessions.find(s => s.sessionId === sessionId);
  if (!session) return;
  const records = await dbIdx('attendance', 'sessionId', sessionId);

  const rows = records.length
    ? records.map(r => `<tr><td>${esc(r.studentId)}</td><td>${esc(r.studentName)}</td><td>${r.date}</td><td>${r.time}</td></tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No records</td></tr>`;

  document.getElementById('session-detail-content').innerHTML = `
    <div class="session-detail-header">
      <h2>${esc(session.lecture)}</h2>
    </div>
    <div class="session-meta-grid">
      <div class="sm-item"><label>Teacher</label><span>${esc(session.teacher)}</span></div>
      <div class="sm-item"><label>Venue</label><span>${esc(session.venue)}</span></div>
      <div class="sm-item"><label>Date</label><span>${session.date}</span></div>
      <div class="sm-item"><label>Time</label><span>${session.time}</span></div>
      <div class="sm-item"><label>Present</label><span style="color:var(--green)">${session.totalPresent}</span></div>
      <div class="sm-item"><label>Total Scanned</label><span>${session.totalScanned||session.totalPresent}</span></div>
    </div>
    <div style="padding:0 12px 8px;display:flex;gap:8px;">
      <button class="btn-primary" style="flex:1;font-size:13px;" onclick="exportSessionCSV(${sessionId})">📄 Export CSV</button>
      <button class="btn-secondary" style="flex:1;font-size:13px;" onclick="exportSessionExcel(${sessionId})">📊 Excel</button>
    </div>
    <div class="attendance-table-wrap">
      <table><thead><tr><th>Student ID</th><th>Name</th><th>Date</th><th>Time</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  showPage('page-session-detail');
}

/* ══════════════════════════════════════
   EXPORT
══════════════════════════════════════ */
function toggleExportOptions() {
  const t = document.getElementById('exp-type').value;
  document.getElementById('exp-session-wrap').classList.toggle('hidden', t !== 'session');
  document.getElementById('exp-date-wrap').classList.toggle('hidden', t !== 'daterange');
}

async function loadSessionsForExport() {
  const sessions = await dbGetAll('sessions');
  sessions.sort((a,b) => b.sessionId - a.sessionId);
  const sel = document.getElementById('exp-session-id');
  sel.innerHTML = sessions.map(s => `<option value="${s.sessionId}">${s.date} — ${esc(s.lecture)}</option>`).join('');
}

async function getFilteredAttendance() {
  const type = document.getElementById('exp-type').value;
  let records = await dbGetAll('attendance');
  if (type === 'session') {
    const sid = parseInt(document.getElementById('exp-session-id').value);
    records = records.filter(r => r.sessionId === sid);
  } else if (type === 'daterange') {
    const from = document.getElementById('exp-date-from').value;
    const to   = document.getElementById('exp-date-to').value;
    if (from && to) {
      const fd = new Date(from), td = new Date(to + 'T23:59:59');
      records = records.filter(r => { const d = new Date(r.markedAt); return d >= fd && d <= td; });
    }
  }
  return records;
}

async function exportAttendanceCSV() {
  const records = await getFilteredAttendance();
  if (!records.length) return showFormMsg('exp-att-msg','No records found.','error');
  const hdrs = ['Student ID','Student Name','Date','Time','Lecture','Venue','Teacher'];
  const rows = records.map(r => [r.studentId,r.studentName,r.date,r.time,r.lecture,r.venue,r.teacher].map(csvQ));
  dlCSV([hdrs,...rows],'Attendance_Export.csv');
  showToast('CSV exported!','success');
}
async function exportAttendanceExcel() {
  const records = await getFilteredAttendance();
  if (!records.length) return showFormMsg('exp-att-msg','No records found.','error');
  const hdrs = ['Student ID','Student Name','Date','Time','Lecture','Venue','Teacher'];
  const rows = records.map(r => [r.studentId,r.studentName,r.date,r.time,r.lecture,r.venue,r.teacher]);
  dlXLS([hdrs,...rows],'Attendance_Export.xls','Attendance');
  showToast('Excel exported!','success');
}

async function exportStudentsCSV() {
  const students = await dbGetAll('students');
  if (!students.length) return showToast('No students','error');
  const hdrs = ['Student Name','Student ID','Father Name','Email','Phone'];
  const rows = students.map(s => [s.name,s.studentId,s.father||'',s.email||'',s.phone||''].map(csvQ));
  dlCSV([hdrs,...rows],'Students_Export.csv');
  showToast('CSV exported!','success');
}
async function exportStudentsExcel() {
  const students = await dbGetAll('students');
  if (!students.length) return showToast('No students','error');
  const hdrs = ['Student Name','Student ID','Father Name','Email','Phone'];
  const rows = students.map(s => [s.name,s.studentId,s.father||'',s.email||'',s.phone||'']);
  dlXLS([hdrs,...rows],'Students_Export.xls','Students');
  showToast('Excel exported!','success');
}

async function exportSessionCSV(sessionId) {
  const records = await dbIdx('attendance','sessionId',sessionId);
  if (!records.length) return showToast('No records','error');
  const hdrs = ['Student ID','Student Name','Date','Time','Lecture','Venue','Teacher'];
  const rows = records.map(r => [r.studentId,r.studentName,r.date,r.time,r.lecture,r.venue,r.teacher].map(csvQ));
  dlCSV([hdrs,...rows],`Session_${sessionId}.csv`);
  showToast('CSV exported!','success');
}
async function exportSessionExcel(sessionId) {
  const records = await dbIdx('attendance','sessionId',sessionId);
  if (!records.length) return showToast('No records','error');
  const hdrs = ['Student ID','Student Name','Date','Time','Lecture','Venue','Teacher'];
  const rows = records.map(r => [r.studentId,r.studentName,r.date,r.time,r.lecture,r.venue,r.teacher]);
  dlXLS([hdrs,...rows],`Session_${sessionId}.xls`,`Session`);
  showToast('Excel exported!','success');
}

function csvQ(v) {
  const s = String(v||'');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
}
function dlCSV(rows, name) {
  const blob = new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\n')],{type:'text/csv;charset=utf-8;'});
  dlBlob(blob, name);
}
function dlXLS(rows, name, sheet='Sheet1') {
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${sheet}"><Table>
${rows.map((r,i)=>`<Row>${r.map(c=>`<Cell${i===0?' ss:StyleID="h"':''}>
<Data ss:Type="String">${String(c||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Data></Cell>`).join('')}</Row>`).join('')}
</Table></Worksheet></Workbook>`;
  dlBlob(new Blob([xml],{type:'application/vnd.ms-excel'}), name);
}
function dlBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

/* ══════════════════════════════════════
   STATS
══════════════════════════════════════ */
async function loadStats() {
  const [students,sessions,attendance] = await Promise.all([
    dbGetAll('students'), dbGetAll('sessions'), dbGetAll('attendance')
  ]);
  document.getElementById('stats-content').innerHTML = `
    <div class="stat-card"><div class="stat-value">${students.length}</div><div class="stat-label">Total Students</div></div>
    <div class="stat-card"><div class="stat-value">${sessions.length}</div><div class="stat-label">Total Sessions</div></div>
    <div class="stat-card" style="grid-column:1/-1">
      <div class="stat-value">${attendance.length}</div>
      <div class="stat-label">Total Attendance Records</div>
    </div>`;
}

/* ══════════════════════════════════════
   BACKUP & RESTORE
══════════════════════════════════════ */
async function backupData() {
  const [students,sessions,attendance] = await Promise.all([
    dbGetAll('students'), dbGetAll('sessions'), dbGetAll('attendance')
  ]);
  const blob = new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),students,sessions,attendance},null,2)],
    {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `QR_Backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  showToast('Backup downloaded!','success');
}

async function restoreData(e) {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text();
  try {
    const bk = JSON.parse(text);
    if (!bk.students) throw new Error('Invalid backup file');
    let sc=0;
    for (const s of (bk.students||[])) { await dbPut('students',s); sc++; }
    for (const s of (bk.sessions||[])) await dbPut('sessions',s);
    for (const r of (bk.attendance||[])) { try { await dbAdd('attendance',r); } catch {} }
    showFormMsg('restore-msg',`✓ Restored ${sc} students & ${bk.sessions?.length||0} sessions.`,'success');
    updateDashStats();
  } catch(err) {
    showFormMsg('restore-msg','✗ Invalid backup: '+err.message,'error');
  }
  e.target.value = '';
}

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
async function init() {
  await openDB();
  showPage('page-dashboard', false);
  await updateDashStats();
}

init().catch(console.error);
