// 关闭服务后 CLI 必须像普通命令一样返回 0。
// 脚本自己起一个工作台，同时保持一条 SSE 连接，模拟页面还开着的情况。
// 用法：node scripts/e2e/shutdown.mjs [binary]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binary = resolve(root, process.argv[2] || 'bin/intentflow');
const before = join(root, 'scripts/e2e/fixtures/tree/before');
const after = join(root, 'scripts/e2e/fixtures/tree/after');
const timeoutMs = 15000;

if (!existsSync(binary)) throw new Error(`${binary} 不存在，先运行 make build`);

function startServer() {
  const child = spawn(binary, [
    '--before', before,
    '--after', after,
    '--host', '127.0.0.1',
    '--port', '0',
    '--no-open',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exit = new Promise((resolveExit) => child.on('exit', (code, signal) => resolveExit({ code, signal })));
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error(`工作台启动超时:\n${output}`)), timeoutMs);
    const check = () => {
      const match = output.match(/端口:\s*(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveReady(Number(match[1]));
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.on('exit', () => { clearTimeout(timer); rejectReady(new Error(`工作台提前退出:\n${output}`)); });
  });
  return { child, exit, ready, output: () => output };
}

function request(port, path, method = 'GET') {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: { Origin: `http://127.0.0.1:${port}` },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolveRequest({ status: res.statusCode, body }));
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

function openEvents(port) {
  return new Promise((resolveEvents, rejectEvents) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
      assert.equal(res.statusCode, 200);
      res.once('data', () => resolveEvents({ req, res }));
    });
    req.on('error', rejectEvents);
  });
}

(async () => {
  const server = startServer();
  try {
    const port = await server.ready;
    assert.ok(port > 0, '没有读到监听端口');

    const payload = await request(port, '/api/payload.json');
    assert.equal(payload.status, 200);
    assert.match(payload.body, /"shutdown":true/);

    const events = await openEvents(port);
    try {
      const response = await request(port, '/api/shutdown', 'POST');
      assert.equal(response.status, 200);
      assert.match(response.body, /"closing"/);
    } finally {
      events.req.destroy();
    }

    const result = await Promise.race([
      server.exit,
      new Promise((_, rejectExit) => setTimeout(() => rejectExit(new Error(`关闭后 CLI 没有退出:\n${server.output()}`)), timeoutMs)),
    ]);
    assert.equal(result.code, 0, `退出码 ${result.code}：
${server.output()}`);
    console.log('ok shutdown exits 0');
  } finally {
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
