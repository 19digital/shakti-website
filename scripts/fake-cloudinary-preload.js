// --require preload: replaces the real `cloudinary` package with a stub that mimics its API
// (uploader.upload_stream, uploader.destroy) so routes/media.js's Cloudinary-mode code path can be
// exercised through the real HTTP server without a real Cloudinary account.
const Module = require('module');
const crypto = require('crypto');

let uploadCalls = 0, destroyCalls = 0;
const uploaded = new Map(); // public_id -> {bytes, resource_type}

const fake = {
  v2: {
    config() {},
    uploader: {
      upload_stream(opts, cb) {
        const chunks = [];
        const stream = {
          write(chunk) { chunks.push(chunk); },
          end(chunk) {
            if (chunk) chunks.push(chunk);
            uploadCalls++;
            const buf = Buffer.concat(chunks);
            const public_id = 'shakti-cms/' + crypto.randomBytes(6).toString('hex');
            uploaded.set(public_id, { bytes: buf.length, resource_type: opts.resource_type });
            setImmediate(() => cb(null, { secure_url: 'https://res.cloudinary.com/fake-cloud/' + opts.resource_type + '/upload/' + public_id + '.' + opts.format, public_id, resource_type: opts.resource_type, bytes: buf.length }));
          },
        };
        return stream;
      },
      async destroy(publicId, opts) {
        destroyCalls++;
        const existed = uploaded.delete(publicId);
        return { result: existed ? 'ok' : 'not found' };
      },
    },
  },
  __stats: () => ({ uploadCalls, destroyCalls, uploadedCount: uploaded.size }),
};

const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'cloudinary') return 'FAKE_CLOUDINARY';
  return realResolve.call(this, request, ...rest);
};
require.cache['FAKE_CLOUDINARY'] = { id: 'FAKE_CLOUDINARY', filename: 'FAKE_CLOUDINARY', loaded: true, exports: fake };
global.__fakeCloudinaryStats = fake.__stats;
