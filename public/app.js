const $ = (s) => document.querySelector(s);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body && JSON.stringify(opts.body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'שגיאה');
  return data;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} בשעה ${iso.slice(11, 16)}`;
const modeText = (l) => (l.mode === 'zoom' ? 'זום' : `פיזי · ${esc(l.address)}`);

function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 4000);
}
const show = (id) => ['login', 'teacher', 'student'].forEach((s) => ($('#' + s).hidden = s !== id));

async function init() {
  const me = await api('/api/me');
  if (!me) return showLogin();
  $('#userbar').hidden = false; $('#who').textContent = me.name || me.email;
  if (me.role === 'teacher') { show('teacher'); loadTeacher(); } else { show('student'); loadStudent(); }
}

async function showLogin() {
  show('login'); $('#userbar').hidden = true;
  const cfg = await api('/api/config');
  if (!cfg.googleClientId) { $('#loginerr').textContent = 'חסר GOOGLE_CLIENT_ID בהגדרות השרת'; return; }
  const start = () => {
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: async ({ credential }) => {
        try { await api('/api/auth/google', { method: 'POST', body: { credential } }); init(); }
        catch (e) { $('#loginerr').textContent = e.message; }
      },
    });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', locale: 'he' });
  };
  if (window.google?.accounts) start(); else window.addEventListener('load', start);
}

$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); init(); };

// ---------- teacher ----------
async function loadTeacher() {
  const [students, lessons] = await Promise.all([api('/api/students'), api('/api/lessons')]);
  $('#studentSelect').innerHTML = students.map((s) => `<option value="${s.id}">${esc(s.first_name)} ${esc(s.last_name)}</option>`).join('');
  $('#students').innerHTML = students.length ? students.map((s) => `
    <div class="row"><div>${esc(s.first_name)} ${esc(s.last_name)}<small dir="ltr">+${esc(s.phone)} · ${esc(s.email)}</small></div>
    <button class="danger" data-del-student="${s.id}">מחק</button></div>`).join('') : '<p class="empty">עוד אין תלמידים</p>';
  $('#lessons').innerHTML = lessons.length ? lessons.map((l) => `
    <div class="row"><div>${esc(l.first_name)} ${esc(l.last_name)}<small>${fmt(l.starts_at)} · ${modeText(l)}</small></div>
    <div class="actions">
      <button data-wa="${l.id}">שלח שוב בוואצפ</button>
      ${l.mode === 'zoom' ? `<button data-wa="${l.id}" data-kind="zoom">שלח קישור זום</button>` : ''}
      <button class="danger" data-del-lesson="${l.id}">בטל</button>
    </div></div>`).join('') : '<p class="empty">אין שיעורים</p>';
}

function syncMode() {
  const z = $('#modeSelect').value === 'zoom';
  $('#addrField').hidden = z; $('#zoomField').hidden = !z;
  $('#addrField input').required = !z; $('#zoomField input').required = z;
}
$('#modeSelect').onchange = syncMode; syncMode();

$('#studentForm').onsubmit = async (e) => {
  e.preventDefault();
  try { await api('/api/students', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('התלמיד נוסף'); loadTeacher(); }
  catch (err) { toast(err.message, true); }
};

$('#lessonForm').onsubmit = async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const popup = window.open('', '_blank'); // opened synchronously so popup blockers allow it
  try {
    const r = await api('/api/lessons', { method: 'POST', body });
    if (r.whatsapp.sent) { popup?.close(); toast('השיעור נקבע וההודעה נשלחה בוואצפ ✅'); }
    else if (popup) { popup.location = r.whatsapp.link; toast(r.whatsapp.error || 'השיעור נקבע — לחץ "שלח" בוואצפ שנפתח'); }
    else toast('השיעור נקבע. לחץ "שלח שוב בוואצפ" ברשימת השיעורים');
    loadTeacher();
  } catch (err) { popup?.close(); toast(err.message, true); }
};

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.wa) {
      const popup = window.open('', '_blank');
      const { link } = await api(`/api/lessons/${b.dataset.wa}/whatsapp?kind=${b.dataset.kind || 'new'}`);
      popup ? (popup.location = link) : (location.href = link);
    } else if (b.dataset.delLesson && confirm('לבטל את השיעור?')) { await api('/api/lessons/' + b.dataset.delLesson, { method: 'DELETE' }); loadTeacher(); }
    else if (b.dataset.delStudent && confirm('למחוק את התלמיד וכל השיעורים שלו?')) { await api('/api/students/' + b.dataset.delStudent, { method: 'DELETE' }); loadTeacher(); }
  } catch (err) { toast(err.message, true); }
});

// ---------- student ----------
async function loadStudent() {
  const ls = await api('/api/my-lessons');
  $('#myLessons').innerHTML = ls.length ? ls.map((l) => `
    <div class="row"><div>${fmt(l.starts_at)}<small>${modeText(l)}</small></div>
    ${l.mode === 'zoom' && l.zoom_link ? `<a href="${esc(l.zoom_link)}" target="_blank" rel="noopener">קישור לזום</a>` : ''}</div>`).join('') : '<p class="empty">אין שיעורים קבועים</p>';
}

init();
