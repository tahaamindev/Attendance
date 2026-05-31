/* ═══════════════════════════════════════════════
   QR ATTENDANCE SYSTEM — SCRIPT.JS
   ═══════════════════════════════════════════════ */

'use strict';

// ── PWA REGISTRATION ──────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ── INSTALL PROMPT ────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('install-btn-wrap').classList.remove('hidden');
});
document.getElementById('install-btn').addEventListener('click', () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => {
      deferredInstallPrompt = null;
      document.getElementById('install-btn-wrap').classList.add('hidden');
    });
  }
});

// ── INDEXEDDB SETUP ───────────────────────────
const DB_NAME = 'qr_attendance_db';
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('students')) {
        const ss = d.createObjectStore('students', { keyPath: 'studentId' });
        ss.createIndex('name', 'name', { unique: false });
      }
      if (!d.objectStoreNames.contains('sessions')) {
        d.createObjectStore('sessions', { keyPath: 'sessionId', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('attendance')) {
        const as = d.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
        as.createIndex('sessionId', 'sessionId', { unique: false });
        as.createIndex('studentId', 'studentId', { unique: false });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function dbGet(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

function dbPut(store, data) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(data);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

function dbAdd(store, data) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').add(data);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

function dbDelete(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').delete(key);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

function dbGetByIndex(store, indexName, value) {
  return new Promise((res, rej) => {
    const r = tx(store).index(indexName).getAll(value);
    r.onsuccess = () => res(r.result);
    r.onerror = e => rej(e.target.error);
  });
}

// ── NAVIGATION ────────────────────────────────
const pageStack = [];

function showPage(pageId, push = true) {
  // Stop camera if navigating away from scanner
  const currentActive = document.querySelector('.page.active');
  if (currentActive && currentActive.id === 'page-scanner' && pageId !== 'page-scanner') {
    stopCamera();
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) {
    page.classList.add('active');
    document.getElementById('pages').scrollTop = 0;
  }
  if (push) pageStack.push(pageId);

  const backBtn = document.getElementById('back-btn');
  const isDash = pageId === 'page-dashboard';
  backBtn.classList.toggle('hidden', isDash);

  const titles = {
    'page-dashboard': 'QR Attendance',
    'page-add-student': 'Add Student',
    'page-students': 'Students List',
    'page-profile': 'Student Profile',
    'page-edit-student': 'Edit Student',
    'page-generate-qr': 'Generate QR',
    'page-qr-view': 'QR Card',
    'page-start-attendance': 'Start Attendance',
    'page-scanner': 'Scanning...',
    'page-history': 'Attendance History',
    'page-session-detail': 'Session Detail',
    'page-export-students': 'Export Students',
    'page-export-attendance': 'Export Attendance',
    'page-stats': 'Statistics',
    'page-restore': 'Restore Data'
  };
  document.getElementById('topbar-title').textContent = titles[pageId] || 'QR Attendance';

  // Page-specific loaders
  if (pageId === 'page-students') loadStudentsList();
  if (pageId === 'page-generate-qr') loadQRStudents();
  if (pageId === 'page-history') loadSessions();
  if (pageId === 'page-stats') loadStats();
  if (pageId === 'page-export-attendance') loadSessionsForExport();
  if (pageId === 'page-dashboard') updateDashStats();
}

function goBack() {
  pageStack.pop();
  if (pageStack.length === 0) {
    showPage('page-dashboard', false);
    return;
  }
  const prev = pageStack[pageStack.length - 1];
  showPage(prev, false);
}

// ── TOAST ─────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ── MODAL ─────────────────────────────────────
let modalCallback = null;
function showModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalCallback = onConfirm;
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalCallback = null;
}
function modalConfirmAction() {
  if (modalCallback) modalCallback();
  closeModal();
}

// ── FORM MSG ──────────────────────────────────
function showFormMsg(id, msg, type = 'success') {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'form-msg ' + type;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── PHOTO UPLOAD ──────────────────────────────
let currentPhotoData = null;
let editPhotoData = null;

function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    currentPhotoData = e.target.result;
    const img = document.getElementById('photo-preview');
    img.src = currentPhotoData;
    img.classList.remove('hidden');
    document.getElementById('photo-placeholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

function handleEditPhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    editPhotoData = e.target.result;
    const img = document.getElementById('edit-photo-preview');
    img.src = editPhotoData;
    img.classList.remove('hidden');
    document.getElementById('edit-photo-placeholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

// ── ADD STUDENT ───────────────────────────────
function resetStudentForm() {
  ['f-name','f-id','f-father','f-email','f-phone'].forEach(id => document.getElementById(id).value = '');
  currentPhotoData = null;
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('photo-placeholder').classList.remove('hidden');
  document.getElementById('student-photo').value = '';
}

async function saveStudent() {
  const name = document.getElementById('f-name').value.trim();
  const studentId = document.getElementById('f-id').value.trim();
  const father = document.getElementById('f-father').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const phone = document.getElementById('f-phone').value.trim();

  if (!name || !studentId) return showFormMsg('student-form-msg', '⚠ Name and Student ID are required.', 'error');

  const existing = await dbGet('students', studentId);
  if (existing) return showFormMsg('student-form-msg', '⚠ Student ID already exists.', 'error');

  const student = {
    studentId,
    name,
    father,
    email,
    phone,
    photo: currentPhotoData || null,
    createdAt: new Date().toISOString()
  };
  await dbPut('students', student);
  showFormMsg('student-form-msg', '✓ Student saved successfully!', 'success');
  resetStudentForm();
  updateDashStats();
}

// ── STUDENTS LIST ─────────────────────────────
let allStudents = [];

async function loadStudentsList() {
  allStudents = await dbGetAll('students');
  allStudents.sort((a, b) => a.name.localeCompare(b.name));
  renderStudents(allStudents);
}

function filterStudents() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = allStudents.filter(s =>
    s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q)
  );
  renderStudents(filtered);
}

function renderStudents(list) {
  const grid = document.getElementById('students-grid');
  const count = document.getElementById('students-count');
  count.textContent = `${list.length} student${list.length !== 1 ? 's' : ''}`;
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><span class="es-icon">👥</span>No students found</div>';
    return;
  }
  grid.innerHTML = list.map(s => `
    <div class="student-card" onclick="openProfile('${s.studentId}')">
      ${s.photo
        ? `<img class="student-card-photo" src="${s.photo}" alt="${s.name}"/>`
        : `<div class="student-card-avatar">👤</div>`}
      <div class="student-card-name">${s.name}</div>
      <div class="student-card-id">${s.studentId}</div>
    </div>
  `).join('');
}

// ── STUDENT PROFILE ───────────────────────────
async function openProfile(studentId) {
  const s = await dbGet('students', studentId);
  if (!s) return;

  const photoHtml = s.photo
    ? `<img class="profile-photo" src="${s.photo}" alt="${s.name}"/>`
    : `<div class="profile-avatar">👤</div>`;

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-hero">
      ${photoHtml}
      <div class="profile-name">${s.name}</div>
      <div class="profile-id">${s.studentId}</div>
    </div>
    <div class="profile-fields">
      <div class="pf-row"><label>Father Name</label><span>${s.father || '—'}</span></div>
      <div class="pf-row"><label>Email</label><span>${s.email || '—'}</span></div>
      <div class="pf-row"><label>Phone</label><span>${s.phone || '—'}</span></div>
      <div class="pf-row"><label>Registered</label><span>${new Date(s.createdAt).toLocaleDateString()}</span></div>
    </div>
    <div class="profile-actions">
      <button class="btn-secondary" onclick="editStudent('${s.studentId}')">✏ Edit</button>
      <button class="btn-danger" onclick="deleteStudentConfirm('${s.studentId}')">🗑 Delete</button>
      <button class="btn-primary" onclick="viewQRCard('${s.studentId}')">📱 View QR</button>
      <button class="btn-secondary" onclick="downloadStudentQRPNG('${s.studentId}')">⬇ QR PNG</button>
    </div>
  `;
  showPage('page-profile');
}

async function editStudent(studentId) {
  const s = await dbGet('students', studentId);
  if (!s) return;
  document.getElementById('edit-original-id').value = s.studentId;
  document.getElementById('ef-name').value = s.name;
  document.getElementById('ef-id').value = s.studentId;
  document.getElementById('ef-father').value = s.father || '';
  document.getElementById('ef-email').value = s.email || '';
  document.getElementById('ef-phone').value = s.phone || '';
  editPhotoData = s.photo || null;
  const img = document.getElementById('edit-photo-preview');
  if (s.photo) {
    img.src = s.photo;
    img.classList.remove('hidden');
    document.getElementById('edit-photo-placeholder').classList.add('hidden');
  } else {
    img.classList.add('hidden');
    document.getElementById('edit-photo-placeholder').classList.remove('hidden');
  }
  showPage('page-edit-student');
}

async function updateStudent() {
  const originalId = document.getElementById('edit-original-id').value;
  const name = document.getElementById('ef-name').value.trim();
  const studentId = document.getElementById('ef-id').value.trim();
  const father = document.getElementById('ef-father').value.trim();
  const email = document.getElementById('ef-email').value.trim();
  const phone = document.getElementById('ef-phone').value.trim();

  if (!name || !studentId) return showFormMsg('edit-form-msg', '⚠ Name and Student ID are required.', 'error');

  if (studentId !== originalId) {
    const existing = await dbGet('students', studentId);
    if (existing) return showFormMsg('edit-form-msg', '⚠ Student ID already exists.', 'error');
    await dbDelete('students', originalId);
  }

  const original = await dbGet('students', originalId) || {};
  await dbPut('students', {
    studentId, name, father, email, phone,
    photo: editPhotoData !== null ? editPhotoData : (original.photo || null),
    createdAt: original.createdAt || new Date().toISOString()
  });
  showFormMsg('edit-form-msg', '✓ Student updated!', 'success');
  setTimeout(() => openProfile(studentId), 1200);
}

function deleteStudentConfirm(studentId) {
  showModal('Delete Student', `Are you sure you want to delete student "${studentId}"? This cannot be undone.`, async () => {
    await dbDelete('students', studentId);
    showToast('Student deleted', 'success');
    goBack();
  });
}

// ── DASHBOARD STATS ───────────────────────────
async function updateDashStats() {
  const students = await dbGetAll('students');
  const sessions = await dbGetAll('sessions');
  const attendance = await dbGetAll('attendance');
  document.getElementById('qs-students').textContent = students.length;
  document.getElementById('qs-sessions').textContent = sessions.length;
  document.getElementById('qs-records').textContent = attendance.length;
}

// ── QR CODE GENERATION ────────────────────────
let allQRStudents = [];

async function loadQRStudents() {
  allQRStudents = await dbGetAll('students');
  allQRStudents.sort((a, b) => a.name.localeCompare(b.name));
  renderQRStudents(allQRStudents);
}

function filterQRStudents() {
  const q = document.getElementById('qr-search').value.toLowerCase();
  const filtered = allQRStudents.filter(s =>
    s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q)
  );
  renderQRStudents(filtered);
}

function renderQRStudents(list) {
  const grid = document.getElementById('qr-students-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><span class="es-icon">📱</span>No students found</div>';
    return;
  }
  grid.innerHTML = list.map(s => `
    <div class="student-card" onclick="viewQRCard('${s.studentId}')">
      ${s.photo
        ? `<img class="student-card-photo" src="${s.photo}" alt="${s.name}"/>`
        : `<div class="student-card-avatar">👤</div>`}
      <div class="student-card-name">${s.name}</div>
      <div class="student-card-id">${s.studentId}</div>
    </div>
  `).join('');
}

let currentQRStudent = null;

async function viewQRCard(studentId) {
  currentQRStudent = await dbGet('students', studentId);
  if (!currentQRStudent) return;
  renderQRCard(currentQRStudent);
  showPage('page-qr-view');
}

function buildQRCardHTML(student, qrDataUrl) {
  const photoHtml = student.photo
    ? `<img class="qr-student-photo" src="${student.photo}" alt="${student.name}"/>`
    : `<div class="qr-student-avatar">👤</div>`;
  return `
    <div class="qr-card" id="qr-card-el">
      <div class="qr-card-header">
        <div class="qr-univ-logo">🎓</div>
        <div class="qr-univ-name">UNIVERSITY ATTENDANCE CARD</div>
      </div>
      <div class="qr-card-body">
        ${photoHtml}
        <div class="qr-name-badge">${student.name}</div>
        <div class="qr-student-id">${student.studentId}</div>
        <div class="qr-code-wrap">
          ${qrDataUrl ? `<img src="${qrDataUrl}" width="160" height="160" alt="QR Code"/>` : `<div id="qr-render-target" style="width:160px;height:160px;"></div>`}
        </div>
      </div>
      <div class="qr-card-footer">SCAN TO MARK ATTENDANCE • ${new Date().getFullYear()}</div>
    </div>
  `;
}

function renderQRCard(student) {
  const container = document.getElementById('qr-card-container');
  container.innerHTML = '<div class="qr-card-outer">' + buildQRCardHTML(student, null) + '</div>';
  const target = document.getElementById('qr-render-target');
  try {
    new QRCode(target, {
      text: student.studentId,
      width: 160,
      height: 160,
      colorDark: '#0a1628',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  } catch (e) { console.error('QR generation error', e); }
}

async function getQRDataURL(studentId) {
  return new Promise(resolve => {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:200px;height:200px;background:white;';
    document.body.appendChild(tmp);
    try {
      const qr = new QRCode(tmp, {
        text: studentId,
        width: 200,
        height: 200,
        colorDark: '#0a1628',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
      // Poll until the img src is populated (QRCode.js renders async)
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        const img = tmp.querySelector('img');
        if (img && img.src && img.src.startsWith('data:')) {
          clearInterval(poll);
          const url = img.src;
          document.body.removeChild(tmp);
          resolve(url);
        } else if (attempts > 40) { // 2 second timeout
          clearInterval(poll);
          try { document.body.removeChild(tmp); } catch {}
          resolve(null);
        }
      }, 50);
    } catch (e) {
      try { document.body.removeChild(tmp); } catch {}
      resolve(null);
    }
  });
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

async function downloadQRPNG() {
  if (!currentQRStudent) return;
  showToast('Generating PNG...');

  const qrUrl = await getQRDataURL(currentQRStudent.studentId);
  if (!qrUrl) { showToast('QR generation failed', 'error'); return; }

  const W = 340, H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // White background with rounded feel (fill full rect)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ── Header gradient ──
  const grad = ctx.createLinearGradient(0, 0, W, 90);
  grad.addColorStop(0, '#0a1628');
  grad.addColorStop(1, '#00c853');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 90);

  // University logo emoji
  ctx.font = '38px serif';
  ctx.textAlign = 'center';
  ctx.fillText('🎓', W / 2, 44);

  // University label
  ctx.fillStyle = 'white';
  ctx.font = 'bold 13px Arial';
  ctx.fillText('UNIVERSITY ATTENDANCE CARD', W / 2, 72);

  // ── Student photo (circle) ──
  const photoSize = 76;
  const photoX = (W - photoSize) / 2;
  const photoY = 102;
  const photoCX = W / 2;
  const photoCY = photoY + photoSize / 2;

  // Green ring
  ctx.beginPath();
  ctx.arc(photoCX, photoCY, photoSize / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = '#00c853';
  ctx.fill();

  // Clip for circular photo
  ctx.save();
  ctx.beginPath();
  ctx.arc(photoCX, photoCY, photoSize / 2, 0, Math.PI * 2);
  ctx.clip();

  if (currentQRStudent.photo) {
    try {
      const photoImg = await loadImage(currentQRStudent.photo);
      ctx.drawImage(photoImg, photoX, photoY, photoSize, photoSize);
    } catch {
      ctx.fillStyle = '#e8f5e9';
      ctx.fillRect(photoX, photoY, photoSize, photoSize);
      ctx.fillStyle = '#aaa';
      ctx.font = '36px serif';
      ctx.fillText('👤', W / 2, photoCY + 12);
    }
  } else {
    ctx.fillStyle = '#e8f5e9';
    ctx.fillRect(photoX, photoY, photoSize, photoSize);
    ctx.fillStyle = '#aaa';
    ctx.font = '36px serif';
    ctx.fillText('👤', W / 2, photoCY + 12);
  }
  ctx.restore();

  // ── Name badge ──
  const nameY = photoY + photoSize + 18;
  ctx.fillStyle = '#0a1628';
  ctx.beginPath();
  ctx.roundRect(24, nameY, W - 48, 38, 19);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px Arial';
  ctx.textAlign = 'center';
  // Truncate long names
  let displayName = currentQRStudent.name;
  while (ctx.measureText(displayName).width > W - 80 && displayName.length > 3) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== currentQRStudent.name) displayName += '…';
  ctx.fillText(displayName, W / 2, nameY + 25);

  // ── Student ID ──
  ctx.fillStyle = '#00c853';
  ctx.font = 'bold 14px Arial';
  ctx.letterSpacing = '1px';
  ctx.fillText(currentQRStudent.studentId, W / 2, nameY + 56);
  ctx.letterSpacing = '0px';

  // ── QR Code image ──
  try {
    const qrImg = await loadImage(qrUrl);
    const qrSize = 170;
    const qrX = (W - qrSize) / 2;
    const qrY = nameY + 68;

    // White box border for QR
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 10);
    ctx.fill();
    ctx.stroke();

    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  } catch (e) {
    ctx.fillStyle = '#ff3d57';
    ctx.font = '13px Arial';
    ctx.fillText('QR generation error', W / 2, nameY + 140);
  }

  // ── Footer ──
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, H - 36, W, 36);
  ctx.fillStyle = '#999999';
  ctx.font = '11px Arial';
  ctx.fillText('SCAN TO MARK ATTENDANCE • ' + new Date().getFullYear(), W / 2, H - 15);

  // ── Download ──
  const link = document.createElement('a');
  link.download = `QR_${currentQRStudent.studentId}_${currentQRStudent.name.replace(/\s+/g, '_')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('PNG downloaded!', 'success');
}

async function downloadQRPDF() {
  if (!currentQRStudent || !window.jspdf) return showToast('PDF library not loaded', 'error');
  showToast('Generating PDF...');
  const qrUrl = await getQRDataURL(currentQRStudent.studentId);
  if (!qrUrl) return showToast('QR generation failed', 'error');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: [86, 124] });

  // Header
  doc.setFillColor(10, 22, 40);
  doc.rect(0, 0, 86, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text('UNIVERSITY ATTENDANCE CARD', 43, 12, { align: 'center' });
  doc.setFontSize(18);
  doc.text('🎓', 43, 24, { align: 'center' });

  // Student photo (if available)
  let photoYOffset = 32;
  if (currentQRStudent.photo) {
    try {
      doc.addImage(currentQRStudent.photo, 'JPEG', 31, 30, 24, 24, undefined, 'FAST');
      photoYOffset = 56;
    } catch {}
  }

  // Name badge
  doc.setFillColor(10, 22, 40);
  doc.roundedRect(8, photoYOffset + 2, 70, 10, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  const displayName = currentQRStudent.name.length > 22
    ? currentQRStudent.name.slice(0, 21) + '…'
    : currentQRStudent.name;
  doc.text(displayName, 43, photoYOffset + 9, { align: 'center' });

  // Student ID
  doc.setTextColor(0, 200, 83);
  doc.setFontSize(8);
  doc.text(currentQRStudent.studentId, 43, photoYOffset + 18, { align: 'center' });

  // QR Code
  doc.addImage(qrUrl, 'PNG', 18, photoYOffset + 22, 50, 50);

  // Footer
  doc.setFillColor(245, 245, 245);
  doc.rect(0, 114, 86, 10, 'F');
  doc.setTextColor(153, 153, 153);
  doc.setFontSize(6);
  doc.text('SCAN TO MARK ATTENDANCE', 43, 120, { align: 'center' });

  doc.save(`QR_${currentQRStudent.studentId}.pdf`);
  showToast('PDF downloaded!', 'success');
}

function printQRCard() {
  const card = document.getElementById('qr-card-el');
  if (!card) return;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>QR Card</title>
    <style>body{margin:0;background:white;display:flex;align-items:center;justify-content:center;height:100vh;}
    @media print{body{height:auto;}}
    .qr-card{background:white;border-radius:16px;overflow:hidden;width:340px;font-family:sans-serif;color:#1a1a2e;border:1px solid #ddd;}
    .qr-card-header{background:linear-gradient(135deg,#0a1628,#00c853);padding:16px;text-align:center;color:white;}
    .qr-univ-logo{font-size:36px;}.qr-univ-name{font-size:14px;font-weight:700;letter-spacing:1px;margin-top:4px;}
    .qr-card-body{padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px;}
    .qr-student-photo,.qr-student-avatar{width:72px;height:72px;border-radius:50%;border:3px solid #00c853;}
    .qr-student-photo{object-fit:cover;}.qr-student-avatar{background:#e8f5e9;display:flex;align-items:center;justify-content:center;font-size:36px;}
    .qr-name-badge{background:#0a1628;color:white;padding:6px 18px;border-radius:20px;font-size:18px;font-weight:700;text-align:center;width:100%;}
    .qr-student-id{color:#00c853;font-size:14px;font-weight:700;letter-spacing:1px;}
    .qr-code-wrap{background:white;padding:8px;border-radius:8px;border:2px solid #e0e0e0;}
    .qr-card-footer{background:#f5f5f5;padding:8px 16px;text-align:center;font-size:11px;color:#666;letter-spacing:0.5px;}
    </style></head><body>${card.outerHTML}<script>window.onload=()=>window.print();<\/script></body></html>`);
  win.document.close();
}

async function downloadStudentQRPNG(studentId) {
  const s = await dbGet('students', studentId);
  if (!s) return;
  currentQRStudent = s;
  await downloadQRPNG();
}

async function downloadAllQRZip() {
  if (!window.JSZip) return showToast('ZIP library not loaded', 'error');
  const students = await dbGetAll('students');
  if (!students.length) return showToast('No students found', 'error');
  showToast('Generating ZIP... please wait');

  const zip = new JSZip();
  for (const s of students) {
    const qrUrl = await getQRDataURL(s.studentId);
    if (!qrUrl) continue;
    const base64 = qrUrl.split(',')[1];
    zip.file(`QR_${s.studentId}_${s.name.replace(/\s+/g,'_')}.png`, base64, { base64: true });
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'All_QR_Codes.zip';
  a.click();
  URL.revokeObjectURL(url);
  showToast('ZIP downloaded!', 'success');
}

// ── ATTENDANCE SESSION ────────────────────────
let currentSession = null;
let sessionAttendanceSet = new Set(); // studentIds already marked
let scanAnimFrame = null;
let videoStream = null;
let scannedCount = 0;
let presentCount = 0;
let lastScannedCode = null;
let lastScannedTime = 0;
let pendingStudent = null;

async function startAttendanceSession() {
  const lecture = document.getElementById('att-lecture').value.trim();
  const teacher = document.getElementById('att-teacher').value.trim();
  const venue = document.getElementById('att-venue').value.trim();

  if (!lecture || !teacher || !venue)
    return showFormMsg('att-form-msg', '⚠ All fields are required.', 'error');

  currentSession = {
    lecture, teacher, venue,
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString(),
    startedAt: new Date().toISOString(),
    sessionId: Date.now()
  };
  sessionAttendanceSet = new Set();
  scannedCount = 0;
  presentCount = 0;
  pendingStudent = null;

  // Clear form
  ['att-lecture','att-teacher','att-venue'].forEach(id => document.getElementById(id).value = '');

  document.getElementById('scan-lecture').textContent = lecture;
  document.getElementById('scan-teacher').textContent = teacher;
  document.getElementById('scan-venue').textContent = venue;
  document.getElementById('cnt-scanned').textContent = '0';
  document.getElementById('cnt-present').textContent = '0';
  document.getElementById('scan-result-panel').classList.add('hidden');

  showPage('page-scanner');
  await startCamera();
}

async function startCamera() {
  const video = document.getElementById('qr-video');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = videoStream;
    video.play();
    video.addEventListener('loadedmetadata', () => {
      scanLoop();
    }, { once: true });
  } catch (err) {
    showToast('Camera error: ' + err.message, 'error');
  }
}

function stopCamera() {
  if (scanAnimFrame) { cancelAnimationFrame(scanAnimFrame); scanAnimFrame = null; }
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  const video = document.getElementById('qr-video');
  if (video) { video.srcObject = null; }
}

function scanLoop() {
  const video = document.getElementById('qr-video');
  if (!video || !videoStream) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function tick() {
    if (!videoStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });
      if (code) {
        const now = Date.now();
        if (code.data !== lastScannedCode || now - lastScannedTime > 3000) {
          lastScannedCode = code.data;
          lastScannedTime = now;
          handleQRDetected(code.data);
        }
      }
    }
    scanAnimFrame = requestAnimationFrame(tick);
  }
  scanAnimFrame = requestAnimationFrame(tick);
}

async function handleQRDetected(qrData) {
  const student = await dbGet('students', qrData);
  if (!student) {
    showToast('Student not found: ' + qrData, 'error');
    return;
  }
  pendingStudent = student;
  scannedCount++;
  document.getElementById('cnt-scanned').textContent = scannedCount;

  const panel = document.getElementById('scan-result-panel');
  panel.classList.remove('hidden');

  const photoEl = document.getElementById('srp-photo');
  if (student.photo) {
    photoEl.src = student.photo;
  } else {
    photoEl.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="25" fill="%23142445"/><text x="25" y="35" font-size="24" text-anchor="middle" fill="%237a9cc0">👤</text></svg>';
  }
  document.getElementById('srp-name').textContent = student.name;
  document.getElementById('srp-id').textContent = student.studentId;

  const alreadyMarked = sessionAttendanceSet.has(student.studentId);
  document.getElementById('srp-confirm-btn').classList.toggle('hidden', alreadyMarked);
  document.getElementById('srp-warning').classList.toggle('hidden', !alreadyMarked);
}

async function confirmAttendance() {
  if (!pendingStudent || !currentSession) return;
  if (sessionAttendanceSet.has(pendingStudent.studentId)) return;

  sessionAttendanceSet.add(pendingStudent.studentId);
  presentCount++;
  document.getElementById('cnt-present').textContent = presentCount;

  await dbAdd('attendance', {
    sessionId: currentSession.sessionId,
    studentId: pendingStudent.studentId,
    studentName: pendingStudent.name,
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString(),
    lecture: currentSession.lecture,
    venue: currentSession.venue,
    teacher: currentSession.teacher,
    markedAt: new Date().toISOString()
  });

  showToast(`✓ ${pendingStudent.name} marked present`, 'success');
  pendingStudent = null;
  lastScannedCode = null;
  document.getElementById('scan-result-panel').classList.add('hidden');
}

async function endAttendanceSession() {
  showModal('End Attendance', `End session for "${currentSession?.lecture}"? Total present: ${presentCount}`, async () => {
    stopCamera();
    if (currentSession) {
      await dbAdd('sessions', {
        sessionId: currentSession.sessionId,
        lecture: currentSession.lecture,
        teacher: currentSession.teacher,
        venue: currentSession.venue,
        date: currentSession.date,
        time: currentSession.time,
        startedAt: currentSession.startedAt,
        endedAt: new Date().toISOString(),
        totalPresent: presentCount,
        totalScanned: scannedCount
      });
    }
    currentSession = null;
    showToast('Session saved successfully!', 'success');
    updateDashStats();
    pageStack.length = 0;
    showPage('page-dashboard', false);
  });
}

// ── ATTENDANCE HISTORY ────────────────────────
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
        <div class="session-lecture">${s.lecture}</div>
        <div class="session-badge">${s.totalPresent} Present</div>
      </div>
      <div class="session-meta">
        <span>👨‍🏫 ${s.teacher}</span>
        <span>📍 ${s.venue}</span>
        <span>📅 ${s.date}</span>
        <span>🕐 ${s.time}</span>
      </div>
    </div>
  `).join('');
}

async function openSessionDetail(sessionId) {
  const sessions = await dbGetAll('sessions');
  const session = sessions.find(s => s.sessionId === sessionId);
  if (!session) return;
  const records = await dbGetByIndex('attendance', 'sessionId', sessionId);

  const rows = records.map(r => `
    <tr>
      <td>${r.studentId}</td>
      <td>${r.studentName}</td>
      <td>${r.date}</td>
      <td>${r.time}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No records</td></tr>';

  document.getElementById('session-detail-content').innerHTML = `
    <div class="session-detail-header">
      <h2>${session.lecture}</h2>
    </div>
    <div class="session-meta-grid">
      <div class="sm-item"><label>Teacher</label><span>${session.teacher}</span></div>
      <div class="sm-item"><label>Venue</label><span>${session.venue}</span></div>
      <div class="sm-item"><label>Date</label><span>${session.date}</span></div>
      <div class="sm-item"><label>Time</label><span>${session.time}</span></div>
      <div class="sm-item"><label>Present</label><span style="color:var(--green)">${session.totalPresent}</span></div>
      <div class="sm-item"><label>Scanned</label><span>${session.totalScanned || session.totalPresent}</span></div>
    </div>
    <div style="padding:0 12px 8px;display:flex;gap:8px;">
      <button class="btn-primary" style="flex:1;font-size:13px;" onclick="exportSessionCSV(${sessionId})">📄 Export CSV</button>
    </div>
    <div class="attendance-table-wrap">
      <table>
        <thead><tr><th>Student ID</th><th>Name</th><th>Date</th><th>Time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  showPage('page-session-detail');
}

// ── EXPORT ────────────────────────────────────
async function exportStudentsCSV() {
  const students = await dbGetAll('students');
  const headers = ['Student Name','Student ID','Father Name','Email','Phone'];
  const rows = students.map(s => [s.name, s.studentId, s.father||'', s.email||'', s.phone||''].map(csvEsc));
  downloadCSV([headers, ...rows], 'Students_Export.csv');
  showToast('Students CSV exported!', 'success');
}

async function exportStudentsExcel() {
  const students = await dbGetAll('students');
  const headers = ['Student Name','Student ID','Father Name','Email','Phone'];
  const rows = students.map(s => [s.name, s.studentId, s.father||'', s.email||'', s.phone||'']);
  downloadXLS([headers, ...rows], 'Students_Export.xls', 'Students');
  showToast('Students Excel exported!', 'success');
}

async function loadSessionsForExport() {
  const sessions = await dbGetAll('sessions');
  sessions.sort((a, b) => b.sessionId - a.sessionId);
  const sel = document.getElementById('exp-session-id');
  sel.innerHTML = sessions.map(s => `<option value="${s.sessionId}">${s.date} — ${s.lecture}</option>`).join('');

  document.getElementById('exp-type').addEventListener('change', function() {
    document.getElementById('exp-session-wrap').classList.toggle('hidden', this.value !== 'session');
    document.getElementById('exp-date-wrap').classList.toggle('hidden', this.value !== 'daterange');
  });
}

async function getFilteredAttendance() {
  const type = document.getElementById('exp-type').value;
  let records = await dbGetAll('attendance');
  if (type === 'session') {
    const sid = parseInt(document.getElementById('exp-session-id').value);
    records = records.filter(r => r.sessionId === sid);
  } else if (type === 'daterange') {
    const from = document.getElementById('exp-date-from').value;
    const to = document.getElementById('exp-date-to').value;
    if (from && to) {
      records = records.filter(r => {
        const d = new Date(r.markedAt || r.date);
        return d >= new Date(from) && d <= new Date(to + 'T23:59:59');
      });
    }
  }
  return records;
}

async function exportAttendanceCSV() {
  const records = await getFilteredAttendance();
  if (!records.length) return showFormMsg('exp-att-msg', 'No records found.', 'error');
  const headers = ['Student ID','Student Name','Date','Time','Lecture','Venue','Teacher'];
  const rows = records.map(r => [r.studentId, r.studentName, r.date, r.time, r.lecture, r.venue, r.teacher].map(csvEsc));
  downloadCSV([headers, ...rows], 'Attendance_Export.csv');
  showToast('Attendance CSV exported!', 'success');
}

async function exportAttendanceExcel() {
  const records = await getFilteredAttendance();
  if (!records.length) return showFormMsg('exp-att-msg', 'No records found.', 'error');
  const headers = ['Student ID','Student Name','Date','Time','Lecture','Venue','Teacher'];
  const rows = records.map(r => [r.studentId, r.studentName, r.date, r.time, r.lecture, r.venue, r.teacher]);
  downloadXLS([headers, ...rows], 'Attendance_Export.xls', 'Attendance');
  showToast('Attendance Excel exported!', 'success');
}

async function exportSessionCSV(sessionId) {
  const records = await dbGetByIndex('attendance', 'sessionId', sessionId);
  if (!records.length) return showToast('No records', 'error');
  const headers = ['Student ID','Student Name','Date','Time','Lecture','Venue','Teacher'];
  const rows = records.map(r => [r.studentId, r.studentName, r.date, r.time, r.lecture, r.venue, r.teacher].map(csvEsc));
  downloadCSV([headers, ...rows], `Session_${sessionId}_Attendance.csv`);
  showToast('CSV exported!', 'success');
}

function csvEsc(v) {
  const s = String(v || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadXLS(rows, filename, sheetName) {
  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${sheetName}">
  <Table>
   ${rows.map((r,i) => `<Row>${r.map(c => `<Cell${i===0?' ss:StyleID="header"':''}><Data ss:Type="String">${String(c||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Data></Cell>`).join('')}</Row>`).join('\n   ')}
  </Table>
 </Worksheet>
</Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── STATISTICS ────────────────────────────────
async function loadStats() {
  const students = await dbGetAll('students');
  const sessions = await dbGetAll('sessions');
  const attendance = await dbGetAll('attendance');
  document.getElementById('stats-content').innerHTML = `
    <div class="stat-card"><div class="stat-value">${students.length}</div><div class="stat-label">Total Students</div></div>
    <div class="stat-card"><div class="stat-value">${sessions.length}</div><div class="stat-label">Total Sessions</div></div>
    <div class="stat-card" style="grid-column:1/-1"><div class="stat-value">${attendance.length}</div><div class="stat-label">Total Attendance Records</div></div>
  `;
}

// ── BACKUP ────────────────────────────────────
async function backupData() {
  const students = await dbGetAll('students');
  const sessions = await dbGetAll('sessions');
  const attendance = await dbGetAll('attendance');
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    students, sessions, attendance
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `QR_Attendance_Backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded!', 'success');
}

// ── RESTORE ───────────────────────────────────
async function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const backup = JSON.parse(e.target.result);
      if (!backup.version || !backup.students) throw new Error('Invalid backup file');
      let added = 0;
      for (const s of (backup.students || [])) { await dbPut('students', s); added++; }
      for (const s of (backup.sessions || [])) { await dbPut('sessions', s); }
      for (const r of (backup.attendance || [])) {
        try { await dbAdd('attendance', r); } catch {}
      }
      showFormMsg('restore-msg', `✓ Restored ${added} students and ${backup.sessions?.length||0} sessions.`, 'success');
      updateDashStats();
    } catch (err) {
      showFormMsg('restore-msg', '✗ Invalid backup file: ' + err.message, 'error');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// ── INIT ──────────────────────────────────────
async function init() {
  await openDB();
  showPage('page-dashboard', false);
  updateDashStats();
}

init().catch(console.error);
