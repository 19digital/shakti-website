/**
 * Database backend — auto-selects based on environment:
 *  - MongoDB Atlas (when MONGODB_URI is set): for hosts with no persistent disk, e.g. Render's free tier.
 *  - A local JSON file (default): zero external dependencies, for a VPS or any host with a real disk.
 * Either way, the rest of the app only ever touches db.data / db.save() / db.log() / db.id() — no
 * caller needs to know which backend is active.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MONGO_MODE = !!process.env.MONGODB_URI;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
if (!MONGO_MODE) {
  fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true }); // still used for the SECRET_KEY fallback file if one isn't set
}

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

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      deepMerge(base[k], over[k]);
    } else base[k] = over[k];
  }
  return base;
}

let data = DEFAULTS();
let mongoCol = null;

if (!MONGO_MODE && fs.existsSync(FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = deepMerge(DEFAULTS(), loaded);
  } catch (e) {
    const bad = FILE + '.corrupt-' + Date.now();
    fs.copyFileSync(FILE, bad);
    console.error('db.json unreadable — saved a copy to', bad, '(' + e.message + '). Starting empty.');
  }
}

/**
 * Must be awaited once, before the server starts accepting requests.
 * No-op in file mode (data is already loaded above, synchronously).
 */
async function connect() {
  if (!MONGO_MODE) return;
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const dbName = process.env.MONGODB_DB || 'shakti_cms';
  mongoCol = client.db(dbName).collection('store');
  const doc = await mongoCol.findOne({ _id: 'main' });
  if (doc) {
    delete doc._id;
    data = deepMerge(DEFAULTS(), doc);
    console.log('[store] loaded existing data from MongoDB Atlas');
  } else {
    const { _id, ...rest } = data;
    await mongoCol.insertOne({ _id: 'main', ...rest });
    console.log('[store] MongoDB collection was empty — started a fresh site');
  }
}

let timer = null;
function flushFile() {
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
async function flushMongo() {
  timer = null;
  if (!mongoCol) return; // connect() hasn't finished yet — save() will fire again on the next change anyway
  const { _id, ...rest } = data;
  try {
    await mongoCol.updateOne({ _id: 'main' }, { $set: rest }, { upsert: true });
  } catch (e) {
    console.error('[store] MongoDB save failed:', e.message);
  }
}
function save() {
  data.version++;
  if (!timer) timer = setTimeout(() => (MONGO_MODE ? flushMongo() : flushFile()), 150);
}
async function saveNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (MONGO_MODE) await flushMongo();
  else flushFile();
}
if (!MONGO_MODE) {
  process.on('exit', () => {
    try {
      if (timer) flushFile();
    } catch (_) {}
  });
} else {
  // 'exit' can't reliably run async work — flush proactively on the shutdown signals a host sends instead.
  ['SIGTERM', 'SIGINT'].forEach((sig) =>
    process.on(sig, async () => {
      try {
        await saveNow();
      } finally {
        process.exit(0);
      }
    })
  );
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}
function log(user, text) {
  data.activity.unshift({ at: new Date().toISOString(), by: user ? user.email : 'system', text });
  if (data.activity.length > 100) data.activity.length = 100;
}

module.exports = { get data() { return data; }, save, saveNow, connect, id, log, DATA_DIR, MONGO_MODE };
