/**
 * Minimal Google Gemini REST client. The API key is decrypted per call, sent in the x-goog-api-key header,
 * and never leaves the server.
 * GEMINI_BASE_URL can be overridden (used by the test suite to point at a local mock).
 */
const db = require('./store');
const { decrypt } = require('./crypto');
const { HttpError } = require('./util');

const BASE = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

function getKey() {
  return decrypt(db.data.settings.ai.keyEnc);
}
const hasKey = () => !!getKey();

async function call(path, { method = 'GET', body, key, timeoutMs = 30000 } = {}) {
  key = key || getKey();
  if (!key) throw new HttpError(400, 'No Gemini API key is saved yet. Add one in Dashboard → AI Settings.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(BASE() + path, {
      method,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new HttpError(504, 'Gemini took too long to respond. Please try again.');
    throw new HttpError(502, 'Could not reach the Gemini API (' + e.message + ').');
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || res.statusText;
    if (res.status === 400 && /API key/i.test(msg)) throw new HttpError(400, 'Gemini rejected the API key. Check that it was copied correctly.');
    if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Gemini rejected the API key or it lacks permission: ' + msg);
    if (res.status === 404) throw new HttpError(400, 'Model not found. Pick another model in AI Settings. (' + msg + ')');
    if (res.status === 429) throw new HttpError(429, 'Gemini quota/rate limit reached. Try again in a minute, or check your Google AI plan.');
    throw new HttpError(502, 'Gemini error ' + res.status + ': ' + msg);
  }
  return json;
}

/**
 * generate text.
 * @param {{system?:string, messages:{role:'user'|'model',text:string}[], temperature?:number, maxTokens?:number, json?:boolean, model?:string, timeoutMs?:number}} o
 */
async function generate(o) {
  const model = o.model || db.data.settings.ai.model || 'gemini-2.5-flash';
  const body = {
    contents: o.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { temperature: o.temperature ?? 0.7, maxOutputTokens: o.maxTokens || 1024 },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.json) body.generationConfig.responseMimeType = 'application/json';
  // Gemini 2.5 Flash "thinks" by default and thinking tokens eat the output budget; short tasks don't need it.
  if (o.noThinking && /gemini-2\.5-flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const url = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let j;
  try {
    j = await call(url, { method: 'POST', body, key: o.key, timeoutMs: o.timeoutMs || 45000 });
  } catch (e) {
    // some model versions reject thinkingConfig — retry once without it
    if (body.generationConfig.thinkingConfig && /think/i.test(e.message)) {
      delete body.generationConfig.thinkingConfig;
      j = await call(url, { method: 'POST', body, key: o.key, timeoutMs: o.timeoutMs || 45000 });
    } else throw e;
  }
  if (j.promptFeedback && j.promptFeedback.blockReason) throw new HttpError(422, 'Gemini declined this request (' + j.promptFeedback.blockReason + ').');
  const cand = j.candidates && j.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
  if (!text) throw new HttpError(502, 'Gemini returned an empty answer' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.');
  return text.trim();
}

async function listModels(key) {
  const j = await call('/v1beta/models?pageSize=200', { key });
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name }))
    .filter((m) => /gemini/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { generate, listModels, hasKey, getKey };
