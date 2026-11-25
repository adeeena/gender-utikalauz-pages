const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');
const test = require('node:test');

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server did not start at ${url}`);
}

test('search returns matching Hungarian entries', {timeout: 15_000}, async (t) => {
  const port = 31000 + (process.pid % 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {...process.env, PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';

  server.stdout.on('data', (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk;
  });
  t.after(() => {
    if (server.exitCode === null) {
      server.kill();
    }
  });

  await waitForServer(baseUrl);

  const response = await fetch(`${baseUrl}/search?query=tesztoszteron&languageCode=hu`);
  const body = await response.text();

  assert.equal(response.status, 200, `${body}\n${serverOutput}`);

  const results = JSON.parse(body);
  assert.ok(results.some((result) => result.fileName === 'tesztoszteron'));
});
