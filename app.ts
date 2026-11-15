// Minimal GitHub-compatible forge implementation for make.fun bounty.
// Implements health, REST v3 basics, simple GraphQL, MCP, and git smart HTTP stubs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

const JSON_TYPE = 'application/json; charset=utf-8';

interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface Issue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  repository_url: string;
}

const repos = new Map<string, Repo>();
const issues = new Map<string, Issue[]>();
let nextId = 1;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  res.writeHead(status, {
    'content-type': JSON_TYPE,
    'content-length': Buffer.byteLength(text),
    'x-github-request-id': id,
    ...headers,
  });
  res.end(text);
}

function pathOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://entry').pathname;
  } catch {
    return '/';
  }
}

function authOk(req: IncomingMessage): boolean {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ');
}

function now(): string {
  return new Date().toISOString();
}

export function createApp(): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = pathOf(req);
    const method = req.method ?? 'GET';

    // Health
    if (method === 'GET' && path === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    // Auth check for most routes
    if (!path.startsWith('/healthz') && !authOk(req)) {
      sendJson(res, 401, { message: 'Requires authentication' });
      return;
    }

    // API root
    if (method === 'GET' && (path === '/api/v3' || path === '/api/v3/')) {
      sendJson(res, 200, {
        current_user_url: '/api/v3/user',
        rate_limit_url: '/api/v3/rate_limit',
      }, { 'x-oauth-scopes': 'repo, read:org' });
      return;
    }

    // User
    if (method === 'GET' && path === '/api/v3/user') {
      sendJson(res, 200, { login: 'agent', id: 1, type: 'User' });
      return;
    }

    // Create repo
    if (method === 'POST' && path === '/api/v3/user/repos') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const name = body.name || 'repo';
      const full = `agent/${name}`;
      const repo: Repo = {
        id: nextId++,
        name,
        full_name: full,
        owner: { login: 'agent' },
        private: false,
        description: body.description || null,
        created_at: now(),
        updated_at: now(),
      };
      repos.set(full, repo);
      issues.set(full, []);
      sendJson(res, 201, repo);
      return;
    }

    // Get repo
    const repoMatch = path.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && repoMatch) {
      const full = `${repoMatch[1]}/${repoMatch[2]}`;
      const repo = repos.get(full);
      if (!repo) {
        sendJson(res, 404, { message: 'Not Found' });
        return;
      }
      sendJson(res, 200, repo);
      return;
    }

    // List issues
    const issuesMatch = path.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/issues$/);
    if (method === 'GET' && issuesMatch) {
      const full = `${issuesMatch[1]}/${issuesMatch[2]}`;
      sendJson(res, 200, issues.get(full) || []);
      return;
    }

    // Create issue
    if (method === 'POST' && issuesMatch) {
      const full = `${issuesMatch[1]}/${issuesMatch[2]}`;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const list = issues.get(full) || [];
      const issue: Issue = {
        id: nextId++,
        number: list.length + 1,
        title: body.title || 'Untitled',
        body: body.body || null,
        state: 'open',
        user: { login: 'agent' },
        created_at: now(),
        updated_at: now(),
        repository_url: `/api/v3/repos/${full}`,
      };
      list.push(issue);
      issues.set(full, list);
      sendJson(res, 201, issue);
      return;
    }

    // GraphQL stub
    if (method === 'POST' && path === '/api/graphql') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      sendJson(res, 200, { data: { viewer: { login: 'agent' } }, errors: null });
      return;
    }

    // MCP stub
    if (method === 'POST' && path === '/mcp') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (body.method === 'initialize') {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'forge', version: '0.1' },
          },
        });
        return;
      }
      if (body.method === 'tools/list') {
        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: 'create_repo', description: 'Create a repository', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
              { name: 'get_repo', description: 'Get a repository', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } } } },
              { name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object' } },
              { name: 'list_issues', description: 'List issues', inputSchema: { type: 'object' } },
              { name: 'create_pull_request', description: 'Create PR', inputSchema: { type: 'object' } },
              { name: 'merge_pull_request', description: 'Merge PR', inputSchema: { type: 'object' } },
            ],
          },
        });
        return;
      }
      sendJson(res, 200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } });
      return;
    }

    // Git smart HTTP stub (info/refs)
    if (method === 'GET' && path.includes('/info/refs')) {
      res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-advertisement' });
      res.end('001e# service=git-upload-pack\n0000');
      return;
    }

    sendJson(res, 404, { message: 'Not Found' });
  });
}
