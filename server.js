import express from 'express';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { OAuth2Client } from 'google-auth-library';

const {
  GOOGLE_CLIENT_ID = '',
  TEACHER_EMAILS = '',
  SESSION_SECRET = 'dev-secret',
  PORT = 3000,
  WHATSAPP_TOKEN = '',
  WHATSAPP_PHONE_NUMBER_ID = '',
  DEV_LOGIN = '',
  DB_FILE = 'data.db',
} = process.env;

const teachers = TEACHER_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const oauth = new OAuth2Client(GOOGLE_CLIENT_ID);

const db = new DatabaseSync(DB_FILE);
db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,          -- local "YYYY-MM-DDTHH:MM"
  mode TEXT NOT NULL CHECK (mode IN ('physical','zoom')),
  address TEXT,
  zoom_link TEXT
);
PRAGMA foreign_keys = ON;
`);

// ---------- helpers ----------
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
function makeCookie(session) {
  const body = Buffer.from(JSON.stringify({ ...session, exp: Date.now() + 7 * 864e5 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readSession(req) {
  const raw = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!sig || sig.length !== sign(body).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}
function setSession(res, session) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${makeCookie(session)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}${secure}`);
}

// Israeli-friendly normalisation to international digits (e.g. 0501234567 -> 972501234567)
function normalizePhone(p) {
  let d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return '972' + d.slice(1);
  return d;
}
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const formatDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

export function lessonMessage(l) {
  const online = l.mode === 'zoom';
  return [
    '*נקבע שיעור חדש!*',
    `בתאריך ${formatDate(l.starts_at)} בשעה ${l.starts_at.slice(11, 16)}`,
    `השיעור יארך באופן ${online ? 'מקוון' : 'פיזי'}`,
    online ? 'קישור לשיעור ישלח מיד לפני תחילת השיעור' : `בכתובת ${l.address}`,
    'ניפגש בקרוב!',
  ].join('\n');
}

async function sendWhatsApp(phone, text) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return { sent: false, link: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` };
  const r = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }),
  });
  if (!r.ok) {
    console.error('WhatsApp API error', r.status, await r.text());
    return { sent: false, link: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, error: 'שליחה אוטומטית נכשלה' };
  }
  return { sent: true };
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static('public'));

const requireTeacher = (req, res, next) => {
  const s = readSession(req);
  if (s?.role !== 'teacher') return res.status(401).json({ error: 'נדרשת התחברות מורה' });
  req.user = s; next();
};
const requireStudent = (req, res, next) => {
  const s = readSession(req);
  if (s?.role !== 'student') return res.status(401).json({ error: 'נדרשת התחברות תלמיד' });
  req.user = s; next();
};

function loginFor(email) {
  email = email.toLowerCase();
  if (teachers.includes(email)) return { role: 'teacher', email };
  const st = db.prepare('SELECT id, first_name FROM students WHERE email = ? COLLATE NOCASE').get(email);
  if (st) return { role: 'student', email, studentId: st.id };
  return null;
}

app.get('/api/config', (_req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID, devLogin: !!DEV_LOGIN }));

app.post('/api/auth/google', async (req, res) => {
  try {
    const ticket = await oauth.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified) return res.status(403).json({ error: 'המייל לא מאומת' });
    const s = loginFor(p.email);
    if (!s) return res.status(403).json({ error: 'המייל הזה לא רשום במערכת. פנה למורה.' });
    setSession(res, { ...s, name: p.name });
    res.json({ role: s.role });
  } catch (e) {
    res.status(401).json({ error: 'התחברות נכשלה' });
  }
});

if (DEV_LOGIN && process.env.NODE_ENV !== 'production') {
  app.get('/api/dev-login', (req, res) => {
    const s = loginFor(String(req.query.email || ''));
    if (!s) return res.status(403).json({ error: 'unknown' });
    setSession(res, { ...s, name: s.email }); res.redirect('/');
  });
}

app.get('/api/me', (req, res) => {
  const s = readSession(req);
  res.json(s ? { role: s.role, email: s.email, name: s.name } : null);
});
app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ----- students (teacher) -----
app.get('/api/students', requireTeacher, (req, res) => {
  res.json(db.prepare('SELECT * FROM students WHERE teacher_email = ? ORDER BY first_name, last_name').all(req.user.email));
});

app.post('/api/students', requireTeacher, (req, res) => {
  const { first_name = '', last_name = '', phone = '', email = '' } = req.body;
  if (!first_name.trim() || !last_name.trim()) return res.status(400).json({ error: 'יש למלא שם פרטי ושם משפחה' });
  const ph = normalizePhone(phone);
  if (ph.length < 9) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  if (!emailOk(email.trim())) return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
  try {
    const r = db.prepare('INSERT INTO students (teacher_email, first_name, last_name, phone, email) VALUES (?,?,?,?,?)')
      .run(req.user.email, first_name.trim(), last_name.trim(), ph, email.trim().toLowerCase());
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'תלמיד עם המייל הזה כבר קיים' });
    throw e;
  }
});

app.delete('/api/students/:id', requireTeacher, (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ? AND teacher_email = ?').run(req.params.id, req.user.email);
  res.json({ ok: true });
});

// ----- lessons (teacher) -----
const lessonsQuery = `
  SELECT l.*, s.first_name, s.last_name, s.phone FROM lessons l
  JOIN students s ON s.id = l.student_id`;

app.get('/api/lessons', requireTeacher, (req, res) => {
  res.json(db.prepare(`${lessonsQuery} WHERE s.teacher_email = ? ORDER BY l.starts_at`).all(req.user.email));
});

app.post('/api/lessons', requireTeacher, async (req, res) => {
  const { student_id, date, time, mode, address = '', zoom_link = '' } = req.body;
  const st = db.prepare('SELECT * FROM students WHERE id = ? AND teacher_email = ?').get(student_id, req.user.email);
  if (!st) return res.status(404).json({ error: 'תלמיד לא נמצא' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'תאריך או שעה לא תקינים' });
  if (!['physical', 'zoom'].includes(mode)) return res.status(400).json({ error: 'אופן שיעור לא תקין' });
  if (mode === 'physical' && !address.trim()) return res.status(400).json({ error: 'יש להזין כתובת לשיעור פיזי' });
  if (mode === 'zoom' && !/^https?:\/\//i.test(zoom_link.trim())) return res.status(400).json({ error: 'יש להזין קישור זום תקין (https://...)' });

  const lesson = { starts_at: `${date}T${time}`, mode, address: mode === 'physical' ? address.trim() : null, zoom_link: mode === 'zoom' ? zoom_link.trim() : null };
  const r = db.prepare('INSERT INTO lessons (student_id, starts_at, mode, address, zoom_link) VALUES (?,?,?,?,?)')
    .run(st.id, lesson.starts_at, mode, lesson.address, lesson.zoom_link);
  const text = lessonMessage(lesson);
  const wa = await sendWhatsApp(st.phone, text);
  res.status(201).json({ id: Number(r.lastInsertRowid), message: text, whatsapp: wa });
});

app.get('/api/lessons/:id/whatsapp', requireTeacher, (req, res) => {
  const l = db.prepare(`${lessonsQuery} WHERE l.id = ? AND s.teacher_email = ?`).get(req.params.id, req.user.email);
  if (!l) return res.status(404).json({ error: 'לא נמצא' });
  const kind = req.query.kind === 'zoom' && l.zoom_link ? 'zoom' : 'new';
  const text = kind === 'zoom' ? `*השיעור מתחיל!*\nקישור לשיעור: ${l.zoom_link}` : lessonMessage(l);
  res.json({ link: `https://wa.me/${l.phone}?text=${encodeURIComponent(text)}` });
});

app.delete('/api/lessons/:id', requireTeacher, (req, res) => {
  db.prepare('DELETE FROM lessons WHERE id = ? AND student_id IN (SELECT id FROM students WHERE teacher_email = ?)').run(req.params.id, req.user.email);
  res.json({ ok: true });
});

// ----- student view -----
app.get('/api/my-lessons', requireStudent, (req, res) => {
  res.json(db.prepare('SELECT starts_at, mode, address, zoom_link FROM lessons WHERE student_id = ? ORDER BY starts_at').all(req.user.studentId));
});

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'שגיאת שרת' }); });

if (process.argv[1] === new URL(import.meta.url).pathname) {
  app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
}
export default app;
