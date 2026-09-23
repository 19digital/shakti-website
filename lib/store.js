/**
 * Tiny JSON-file database. Zero native dependencies so it installs on any host.
 * Everything lives in memory; writes are debounced and atomic (temp file + rename), with a rolling daily backup.
 * Fine for a business site (hundreds of posts / thousands of edits). Single-process only.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

const DEFAULTS = () => ({
  users: [],
  sessions: {}, // sha256(token) -> { uid, csrf, exp }
  content: {}, // key -> string (text / image url / link href / alt)
  sections: {}, // sectionId -> { hidden: bool }
  order: {}, // page -> [sectionId, ...]
  seo: {}, // page -> { title, description }
  settings: {
    theme: { preset: 'classic', vars: {}, fontHeading: 'Space Grotesk', fontBody: 'Manrope', radiusCard: 18, radiusButton: 10 },
    site: {
      name: 'Shakti Engineering Works',
      url: '',
      phone: '+91 90999 11179',
      whatsapp: '919099911179',
      email: 'info@shaktiew.in',
      address: 'Bardhaman, West Bengal, India',
      facebook: '',
      instagram: '',
      linkedin: '',
      youtube: '',
      ogImage: '',
      favicon: '',
    },
    nav: [
      { label: 'Home', url: 'index.html' },
      { label: 'About', url: 'about.html' },
      { label: 'Process', url: 'process.html' },
      { label: 'Products', url: 'products.html' },
      { label: 'Blog', url: 'blog.html' },
      { label: 'Contact', url: 'contact.html' },
    ],
    smtp: {
      host: '',
      port: 587,
      secure: false, // true = implicit TLS (port 465), false = STARTTLS (port 587) or plain (port 25)
      user: '',
      passEnc: '', // AES-256-GCM encrypted
      passHint: '',
      from: '', // e.g. "Shakti Engineering Works <no-reply@shaktiew.in>" — defaults to site.email if blank
    },
    notifications: {
      emailOnSubmit: true,
      notifyTo: '', // defaults to site.email if blank
    },
    ai: {
      keyEnc: '', // AES-256-GCM encrypted Gemini API key
      keyHint: '', // e.g. "AIza…x9Kq" (safe to show)
      model: 'gemini-2.5-flash',
      chatEnabled: true,
      chatName: 'Ask Shakti',
      greeting: 'Hi! Ask me anything about our rice mill machinery — products, capacity, location or pricing.',
      chatInstructions: '',
      knowledge: '',
      useSiteText: true,
      dailyLimit: 300,
      blogTone: 'professional, practical, friendly',
      blogLanguage: 'English',
    },
  },
  posts: [],
  pages: [],
  media: [],
  submissions: [], // contact-form leads
  activity: [],
  stats: {}, // 'YYYY-MM-DD' -> { chat: n, blog: n }
  version: 1,
});

let data = DEFAULTS();
if (fs.existsSync(FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = deepMerge(DEFAULTS(), loaded);
  } catch (e) {
    const bad = FILE + '.corrupt-' + Date.now();
    fs.copyFileSync(FILE, bad);
    console.error('db.json unreadable — saved a copy to', bad, '(' + e.message + '). Starting empty.');
  }
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      deepMerge(base[k], over[k]);
    } else base[k] = over[k];
  }
  return base;
}

let timer = null;
function flush() {
  timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
  const day = new Date().toISOString().slice(0, 10);
  const bak = path.join(DATA_DIR, 'backups', `db-${day}.json`);
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(FILE, bak);
    const all = fs.readdirSync(path.join(DATA_DIR, 'backups')).sort();
    while (all.length > 14) fs.unlinkSync(path.join(DATA_DIR, 'backups', all.shift()));
  }
}
function save() {
  data.version++;
  if (!timer) timer = setTimeout(flush, 150);
}
function saveNow() {
  if (timer) clearTimeout(timer);
  flush();
}
process.on('exit', () => {
  try {
    if (timer) flush();
  } catch (_) {}
});

function id() {
  return crypto.randomBytes(8).toString('hex');
}
function log(user, text) {
  data.activity.unshift({ at: new Date().toISOString(), by: user ? user.email : 'system', text });
  if (data.activity.length > 100) data.activity.length = 100;
}

module.exports = { get data() { return data; }, save, saveNow, id, log, DATA_DIR };
