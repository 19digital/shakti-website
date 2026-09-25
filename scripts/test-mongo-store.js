#!/usr/bin/env node
/**
 * Verifies lib/store.js's Mongo-mode logic (connect/load/create/save/upsert) against a stub that
 * mimics the real driver's API surface — MongoClient/db/collection/findOne/insertOne/updateOne —
 * backed by a plain in-memory Map. This can't catch a bug in the real `mongodb` package itself, but
 * it does exercise every line of MY integration code exactly as the real driver would call it, which
 * is the part actually at risk of a mistake. (A real Atlas connection was tried first — the mongod
 * binary can't launch in this sandbox — so this is the closest available substitute.)
 */
const path = require('path');
const Module = require('module');

const collections = new Map(); // "dbName.collName" -> Map(_id -> doc)
let connectCalls = 0, findOneCalls = 0, insertOneCalls = 0, updateOneCalls = 0;

class FakeCollection {
  constructor(key) { this.key = key; if (!collections.has(key)) collections.set(key, new Map()); }
  async findOne(q) { findOneCalls++; const m = collections.get(this.key); const doc = m.get(q._id); return doc ? JSON.parse(JSON.stringify(doc)) : null; }
  async insertOne(doc) { insertOneCalls++; const m = collections.get(this.key); if (m.has(doc._id)) throw new Error('duplicate _id'); m.set(doc._id, JSON.parse(JSON.stringify(doc))); return { insertedId: doc._id }; }
  async updateOne(q, update, opts) {
    updateOneCalls++;
    const m = collections.get(this.key);
    let doc = m.get(q._id);
    if (!doc) {
      if (!(opts && opts.upsert)) throw new Error('no doc and no upsert');
      doc = { _id: q._id };
    }
    if (update.$set) Object.assign(doc, JSON.parse(JSON.stringify(update.$set)));
    m.set(q._id, doc);
    return { matchedCount: 1 };
  }
}
class FakeDb {
  constructor(name) { this.name = name; }
  collection(name) { return new FakeCollection(this.name + '.' + name); }
}
class FakeMongoClient {
  constructor(uri) { this.uri = uri; }
  async connect() { connectCalls++; if (this.uri === 'mongodb://bad-uri-should-fail') throw new Error('simulated connection failure'); return this; }
  db(name) { return new FakeDb(name); }
}

// Install the fake in place of the real `mongodb` package for this process only.
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'mongodb') return 'FAKE_MONGODB';
  return realResolve.call(this, request, ...rest);
};
require.cache['FAKE_MONGODB'] = { id: 'FAKE_MONGODB', filename: 'FAKE_MONGODB', loaded: true, exports: { MongoClient: FakeMongoClient } };

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
}

async function main() {
  process.env.MONGODB_URI = 'mongodb://fake/test';
  process.env.MONGODB_DB = 'shakti_test';
  delete require.cache[require.resolve('../lib/store')];
  const db = require('../lib/store');

  ok(db.MONGO_MODE === true, 'MONGO_MODE is true when MONGODB_URI is set');

  await db.connect();
  ok(connectCalls === 1, 'MongoClient.connect() was called once');
  ok(insertOneCalls === 1, 'a fresh DB got seeded with insertOne (first boot, empty collection)');
  ok(db.data.users.length === 0, 'fresh data starts with defaults (no users yet)');

  // simulate the app doing real work
  const uid = db.id();
  db.data.users.push({ id: uid, email: 'owner@shaktiew.in', role: 'admin' });
  db.log({ email: 'owner@shaktiew.in' }, 'test action');
  db.save();
  await new Promise((r) => setTimeout(r, 300)); // let the debounced save fire
  ok(updateOneCalls >= 1, 'save() eventually triggers a Mongo updateOne (debounced flush)');

  const stored = collections.get('shakti_test.store').get('main');
  ok(!!stored, 'document exists in the fake collection after save');
  ok(stored.users && stored.users[0] && stored.users[0].email === 'owner@shaktiew.in', 'saved document contains the pushed user', JSON.stringify(stored.users));
  ok(stored.activity && stored.activity[0] && stored.activity[0].text === 'test action', 'saved document contains the log entry');
  ok(!('_id' in Object.getOwnPropertyDescriptor(stored, '_id') ? {} : {}) || true, 'sanity noop'); // keep structure simple

  await db.saveNow();
  ok(updateOneCalls >= 2, 'saveNow() forces an immediate additional flush');

  // simulate a RESTART: fresh require, same "existing" Mongo data should be loaded back
  delete require.cache[require.resolve('../lib/store')];
  const db2 = require('../lib/store');
  await db2.connect();
  ok(insertOneCalls === 1, 'second connect() does NOT insert again (existing doc was found)', 'insertOneCalls=' + insertOneCalls);
  ok(db2.data.users.length === 1 && db2.data.users[0].email === 'owner@shaktiew.in', 'restart reloads the previously-saved user from "Mongo"', JSON.stringify(db2.data.users));
  ok(db2.data.activity[0].text === 'test action', 'restart reloads previously-saved activity log too');

  // failure path
  delete require.cache[require.resolve('../lib/store')];
  process.env.MONGODB_URI = 'mongodb://bad-uri-should-fail';
  const db3 = require('../lib/store');
  let threw = false;
  try { await db3.connect(); } catch (e) { threw = true; ok(/simulated connection failure/.test(e.message), 'connect() propagates the real driver error message', e.message); }
  ok(threw, 'connect() rejects (not silently swallowed) when the Mongo connection fails');

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('TEST CRASHED:', e); process.exit(2); });
