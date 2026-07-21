const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('./server');

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + port + path, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

test('GET /health responde 200 y status ok', async () => {
  const app = createApp();
  const server = await startServer(app);
  const res = await get(server, '/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(JSON.parse(res.body).status, 'ok');
  server.close();
});

test('GET /version responde con version y color', async () => {
  const app = createApp();
  const server = await startServer(app);
  const res = await get(server, '/version');
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.version);
  assert.ok(body.color);
  server.close();
});

test('GET / responde 200 con HTML', async () => {
  const app = createApp();
  const server = await startServer(app);
  const res = await get(server, '/');
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /Sistemas Distribuidos/);
  server.close();
});
