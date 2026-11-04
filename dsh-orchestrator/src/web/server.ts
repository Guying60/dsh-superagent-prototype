/**
 * AetherHarness / DSH-Orchestrator — Web Server.
 *
 * Lightweight, zero-dependency HTTP + Server-Sent Events (SSE) server
 * serving the SPA dashboard and providing live control REST endpoints.
 */
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { Orchestrator, RunSnapshot } from '../orchestrator.js';
import { DASHBOARD_HTML } from './client.js';
import { LlmConfig } from '../agent/llm/index.js';
import { OrchestratorEvent } from '../types/index.js';

export interface WebServerOptions {
  port?: number;
  host?: string;
  orchestrator?: Orchestrator;
  llm?: LlmConfig;
}

export class WebServer {
  public readonly orchestrator: Orchestrator;
  public readonly port: number;
  public readonly host: string;
  private server?: Server;
  private sseClients: Set<ServerResponse> = new Set();
  private unsubscribe?: () => void;

  constructor(options: WebServerOptions = {}) {
    this.port = options.port ?? (Number(process.env.AETHER_PORT) || 3300);
    this.host = options.host ?? '127.0.0.1';
    this.orchestrator = options.orchestrator ?? new Orchestrator({ llm: options.llm });

    // Hook into orchestrator events to broadcast via SSE
    this.unsubscribe = this.orchestrator.subscribe(event => {
      this.broadcastSse(event);
    });
  }

  public async start(): Promise<{ port: number; host: string; url: string }> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        const actualPort = typeof address === 'object' && address ? address.port : this.port;
        const url = `http://${this.host}:${actualPort}`;
        resolve({ port: actualPort, host: this.host, url });
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.unsubscribe) this.unsubscribe();
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close(err => (err ? reject(err) : resolve()));
      });
      this.server = undefined;
    }
  }

  private broadcastSse(event: OrchestratorEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(data);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // CORS headers for development flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 1. Dashboard UI
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        res.end(DASHBOARD_HTML);
        return;
      }

      // 2. Server-Sent Events (SSE) stream
      if (pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write('retry: 3000\n\n');
        this.sseClients.add(res);

        req.on('close', () => {
          this.sseClients.delete(res);
        });
        return;
      }

      // 3. API: Status & Overview
      if (method === 'GET' && pathname === '/api/status') {
        const runs = this.orchestrator.getRuns();
        const agents = this.orchestrator.getAgents();
        const llm = this.orchestrator.getLlmInfo();
        const tools = this.orchestrator.getToolReliability();
        this.json(res, 200, {
          status: 'ok',
          runs,
          agents,
          llm,
          tools
        });
        return;
      }

      // 4. API: Agents List
      if (method === 'GET' && pathname === '/api/agents') {
        this.json(res, 200, this.orchestrator.getAgents());
        return;
      }

      // 5. API: Runs List
      if (method === 'GET' && pathname === '/api/runs') {
        this.json(res, 200, this.orchestrator.getRuns());
        return;
      }

      // 6. API: Specific Run
      if (method === 'GET' && pathname?.startsWith('/api/runs/')) {
        const runId = pathname.replace('/api/runs/', '').trim();
        const run = this.orchestrator.getRun(runId);
        if (!run) {
          this.json(res, 404, { error: `Run '${runId}' not found` });
          return;
        }
        this.json(res, 200, run);
        return;
      }

      // 7. API: Trigger Run Task
      if (method === 'POST' && pathname === '/api/tasks/run') {
        const body = await this.readJsonBody(req);
        const taskId = body?.taskId ?? 'all';

        const allTasks = this.orchestrator.getTasks();

        if (taskId === 'all') {
          // Trigger all tasks asynchronously so the client gets an immediate response
          this.orchestrator.runAll(allTasks).catch(err => {
            console.error('Task runAll error:', err);
          });
          this.json(res, 200, { success: true, message: 'All tasks dispatched in background' });
          return;
        }

        const task = allTasks.find(t => t.id === taskId);
        if (!task) {
          this.json(res, 400, {
            error: `Unknown task '${taskId}'. Available: all, ${allTasks.map(t => t.id).join(', ')}`
          });
          return;
        }

        this.orchestrator.runTask(task).catch(err => {
          console.error(`Task ${taskId} error:`, err);
        });
        this.json(res, 200, { success: true, taskId: task.id, message: `Task ${task.id} started` });
        return;
      }

      // 8. API: Resolve Escalation
      if (method === 'POST' && pathname?.match(/^\/api\/runs\/([^/]+)\/escalate$/)) {
        const match = pathname.match(/^\/api\/runs\/([^/]+)\/escalate$/);
        const runId = match![1];
        const body = await this.readJsonBody(req);
        const optionIndex = Number(body?.optionIndex ?? 1);

        const run = this.orchestrator.getRun(runId);
        if (!run) {
          this.json(res, 404, { error: `Run '${runId}' not found` });
          return;
        }

        const updated = await this.orchestrator.resolveEscalation(runId, optionIndex);
        this.json(res, 200, { success: true, run: updated });
        return;
      }

      // Fallback 404
      this.json(res, 404, { error: 'Not Found', path: pathname });
    } catch (err: any) {
      this.json(res, 500, { error: err?.message ?? 'Internal Server Error' });
    }
  }

  private json(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  private readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1e6) {
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body.trim()) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }
}

/** Standalone runner */
async function main(): Promise<void> {
  const port = Number(process.env.AETHER_PORT) || 3300;
  const server = new WebServer({ port });
  const info = await server.start();
  console.log(`\n\x1b[36m⚡ AetherHarness Web Dashboard listening at \x1b[1m${info.url}\x1b[0m\n`);
  console.log(`   Interactive multi-agent orchestration, dynamic scheduling & self-loop UI`);
  console.log(`   Press Ctrl+C to stop.\n`);

  const shutdown = async () => {
    console.log('\nShutting down server...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run main if invoked directly
const isDirectRun = process.argv[1]?.includes('server') || process.argv[1]?.endsWith('server.js');
if (isDirectRun) {
  main().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
