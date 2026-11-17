import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

const JSON_TYPE = 'application/json; charset=utf-8';
const repos = new Map<string, any>();
const issues = new Map<string, any[]>();
let nextId = 1000;

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string,string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': JSON_TYPE,
    'content-length': Buffer.byteLength(text),
    'x-github-request-id': randomUUID().replace(/-/g,'').slice(0,16),
    ...extra
  });
  res.end(text);
}

function pathOf(req: IncomingMessage) {
  try { return new URL(req.url ?? '/', 'http://e').pathname; } catch { return '/'; }
}

function auth(req: IncomingMessage) {
  return (req.headers.authorization || '').startsWith('Bearer ');
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

export function createApp(): Server {
  return createServer(async (req, res) => {
    const path = pathOf(req);
    const method = req.method || 'GET';

    if (method === 'GET' && path === '/healthz') return sendJson(res, 200, { ok: true });
    if (!path.startsWith('/healthz') && !auth(req)) return sendJson(res, 401, { message: 'Requires authentication' });

    if (method === 'GET' && (path === '/api/v3' || path === '/api/v3/'))
      return sendJson(res, 200, { current_user_url: '/api/v3/user' }, { 'x-oauth-scopes': 'repo' });

    if (method === 'GET' && path === '/api/v3/user')
      return sendJson(res, 200, { login: 'agent', id: 1, type: 'User' });

    if (method === 'POST' && path === '/api/v3/user/repos') {
      const b = await body(req);
      const name = b.name || 'repo';
      const full = `agent/${name}`;
      const repo = { id: nextId++, name, full_name: full, owner: { login: 'agent' }, private: false, description: b.description || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      repos.set(full, repo);
      issues.set(full, []);
      return sendJson(res, 201, repo);
    }

    const m = path.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && m) {
      const repo = repos.get(`${m[1]}/${m[2]}`);
      return repo ? sendJson(res, 200, repo) : sendJson(res, 404, { message: 'Not Found' });
    }

    const im = path.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/issues$/);
    if (method === 'GET' && im) return sendJson(res, 200, issues.get(`${im[1]}/${im[2]}`) || []);
    if (method === 'POST' && im) {
      const b = await body(req);
      const full = `${im[1]}/${im[2]}`;
      const list = issues.get(full) || [];
      const issue = { id: nextId++, number: list.length+1, title: b.title||'Untitled', body: b.body||null, state: 'open', user: { login: 'agent' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      list.push(issue);
      issues.set(full, list);
      return sendJson(res, 201, issue);
    }

    if (method === 'POST' && path === '/api/graphql') {
      return sendJson(res, 200, { data: { viewer: { login: 'agent' } } });
    }

    if (method === 'POST' && path === '/mcp') {
      const b = await body(req);
      if (b.method === 'initialize') return sendJson(res, 200, { jsonrpc:'2.0', id:b.id, result: { protocolVersion:'2025-11-25', capabilities:{tools:{}}, serverInfo:{name:'forge',version:'1'} } });
      if (b.method === 'tools/list') return sendJson(res, 200, { jsonrpc:'2.0', id:b.id, result: { tools: [
        {name:'create_repo', description:'Create repo', inputSchema:{type:'object', properties:{name:{type:'string'}}}},
        {name:'get_repo', description:'Get repo', inputSchema:{type:'object'}},
        {name:'create_issue', description:'Create issue', inputSchema:{type:'object'}},
        {name:'list_issues', description:'List issues', inputSchema:{type:'object'}},
        {name:'create_pull_request', description:'Create PR', inputSchema:{type:'object'}},
        {name:'merge_pull_request', description:'Merge PR', inputSchema:{type:'object'}}
      ]}});
      return sendJson(res, 200, { jsonrpc:'2.0', id:b.id, result:{content:[{type:'text', text:'ok'}]} });
    }

    if (method === 'GET' && path.includes('/info/refs')) {
      res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-advertisement' });
      res.end('001e# service=git-upload-pack\n0000');
      return;
    }

    sendJson(res, 404, { message: 'Not Found' });
  });
}
