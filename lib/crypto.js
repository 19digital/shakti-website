/** AES-256-GCM helpers for secrets at rest (the Gemini API key). Master key: env SECRET_KEY or data/secret.key (auto-created). */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./store');

function masterKey() {
  let hex = process.env.SECRET_KEY;
  if (!hex) {
    const f = path.join(DATA_DIR, 'secret.key');
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    hex = fs.readFileSync(f, 'utf8').trim();
  }
  return crypto.createHash('sha256').update(hex).digest(); // 32 bytes whatever the input length
}
const KEY = masterKey();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decrypt(blob) {
  if (!blob) return '';
  try {
    const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (e) {
    return ''; // wrong master key / corrupted — treated as "no key set"
  }
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');

module.exports = { encrypt, decrypt, sha256, token };
