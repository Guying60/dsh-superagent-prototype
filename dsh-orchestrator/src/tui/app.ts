/**
 * Terminal UI — a live orchestration console.
 *
 * Zero dependencies, pure ANSI. Three screens:
 *   menu  → pick a task (or run the whole catalogue)
 *   run   → agent load / DAG step timeline / three-tier verification / event log
 *   card  → minimal-attention escalation card (the "HITL gateway")
 *
 * It renders from the orchestrator's event stream, so what you see is what the engine did —
 * there is no separate presentation-side simulation.
 */
import { Orchestrator, RunSnapshot } from '../orchestrator.js';
import { LlmConfig } from '../agent/llm/index.js';
import { OrchestratorEvent } from '../types/index.js';
import { RateLimiterTask } from '../scenarios/rate-limiter.js';
import {
  bar,
  box,
  elapsed,
  fit,
  paint,
  sideBySide,
  statusBadge,
  statusGlyph,
  style,
  truncate,
  visibleWidth
} from './ansi.js';
import { Key, KeyReader } from './keys.js';

const LOG_LIMIT = 400;
const TICK_MS = 90;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface NodeUi {
  status: string;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
}

interface RunUi {
  snapshot: RunSnapshot;
  nodes: Map<string, NodeUi>;
  logs: Array<{ at: number; tag: string; message: string; colour: string }>;
  loop: { iteration: number; score: number; passed: boolean } | null;
  nodeOrder: string[];
}

export interface TuiOptions {
  /** render this many frames then exit (preview / CI) */
  frames?: number;
  /** no keyboard: run everything and auto-resolve escalations */
  auto?: boolean;
  /** never use the alternate screen (pipes, logs) */
  plain?: boolean;
  /** run the agent team on a remote model (DeepSeek / OpenAI-compatible) */
  llm?: LlmConfig;
  /** set when --live was requested but the platform stayed offline (shown in the header) */
  llmWarning?: string;
}

const TAG_COLOUR: Record<string, string> = {
  run: style.cyan,
  node: style.blue,
  engine: style.gray,
  sched: style.magenta,
  rag: style.green,
  human: style.bgYellow,
  verify: style.yellow,
  llm: style.cyan
};

export class TuiApp {
  private orchestrator: Orchestrator;
  private screen: 'menu' | 'run' = 'menu';
  private selectedTask = 0;
  private activeRun = 0;
  private runUi: Map<string, RunUi> = new Map();
  private order: string[] = [];
  private phase: 'idle' | 'running' = 'idle';
  private modal: { runId: string; selected: number } | null = null;
  private dirty = true;
  private ticker?: NodeJS.Timeout;
  private reader?: KeyReader;
  private startedAt = Date.now();
  private stopped = false;
  private lastDrawAt = 0;

  private readonly opts: TuiOptions;
  private readonly tty: boolean;

  constructor(opts: TuiOptions = {}) {
    this.opts = opts;
    this.tty = !opts.plain && !!process.stdout.isTTY && opts.frames === undefined;
    this.orchestrator = new Orchestrator({
      onEvent: event => this.handleEvent(event),
      llm: opts.llm
    });
  }

  // ------------------------------------------------------------------ lifecycle

  public async start(): Promise<void> {
    if (this.opts.frames !== undefined) {
      await this.previewFrames();
      return;
    }

    if (this.tty) {
      process.stdout.write('\u001b[?1049h\u001b[?25l\u001b[2J');
      process.on('SIGINT', this.handleSignal);
      process.on('SIGTERM', this.handleSignal);
      process.stdout.on('resize', () => {
        this.dirty = true;
      });
    }

    this.ticker = setInterval(() => {
      if (this.tty) {
        // a live clock needs a steady tick
        this.draw();
        return;
      }
      // piped / plain output: render on change only, throttled
      if (!this.dirty) return;
      const now = Date.now();
      if (now - this.lastDrawAt < 250) return;
      this.draw();
    }, TICK_MS);

    if (this.tty || this.opts.auto) {
      this.reader = new KeyReader(key => this.handleKey(key));
      this.reader.start();
    }

    this.draw();

    if (this.opts.auto) {
      await this.autoPlay();
      await sleep(TICK_MS * 2);
      this.stop();
      return;
    }

    await new Promise<void>(resolve => {
      this.onQuit = resolve;
    });

    this.stop();
  }

  /**
   * Deterministic frame capture for layout review / CI. Prints the menu, a mid-flight
   * frame and the final (or escalation) frame, so the UI can be inspected without a TTY.
   */
  private async previewFrames(): Promise<void> {
    const shots: Array<{ label: string; frame: string }> = [];
    const capture = (label: string) =>
      shots.push({ label, frame: this.screen === 'menu' ? this.renderMenu() : this.renderRun() });

    capture('menu · task selection');

    const running = this.startAll();
    await sleep(220);
    capture('live · mid-flight');

    await running;

    const escalatedId = this.order.find(id => this.runUi.get(id)?.snapshot.escalation);
    if (escalatedId) {
      this.activeRun = this.order.indexOf(escalatedId);
      this.modal = { runId: escalatedId, selected: 1 };
      capture('escalation · minimal-attention card');
    } else {
      this.activeRun = Math.max(0, this.order.length - 1);
      capture('final · all runs delivered');
    }

    const limit = Math.max(1, this.opts.frames ?? 3);
    const body = shots
      .slice(0, limit)
      .map((shot, i) => {
        const rule = '─'.repeat(Math.max(4, 74 - shot.label.length));
        return `\n──── frame ${i + 1}/${Math.min(limit, shots.length)} · ${shot.label} ${rule}\n\n${shot.frame}`;
      })
      .join('\n');

    process.stdout.write(`${body}\n`);
    this.stop();
  }

  private onQuit: () => void = () => {};

  private handleSignal = (): void => {
    this.stop();
    process.exit(0);
  };

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.reader?.stop();
    if (this.tty) {
      process.stdout.write('\u001b[?25h\u001b[?1049l');
      process.off('SIGINT', this.handleSignal);
      process.off('SIGTERM', this.handleSignal);
    }
  }

  private finishPreview(): void {
    // retained for backwards compatibility with older call sites
    this.stop();
  }

  /** no-op marker removed; kept out of the render path */

  // --------------------------------------------------------------------- input

  private tasks(): RateLimiterTask[] {
    return this.orchestrator.getTasks();
  }

  private handleKey(key: Key): void {
    this.dirty = true;

    if (key.name === 'interrupt') {
      this.stop();
      process.exit(0);
    }

    if (this.modal) {
      this.handleModalKey(key);
      return;
    }

    if (this.screen === 'menu') {
      if (key.name === 'up') this.selectedTask = Math.max(0, this.selectedTask - 1);
      else if (key.name === 'down') this.selectedTask = Math.min(this.tasks().length - 1, this.selectedTask + 1);
      else if (key.name === 'enter') void this.startSingle(this.tasks()[this.selectedTask]);
      else if (key.char === 'a') void this.startAll();
      else if (key.char === 'q' || key.name === 'escape') {
        this.stop();
        this.onQuit();
        process.exit(0);
      }
      return;
    }

    // run screen
    if (key.name === 'left' || key.name === 'up') this.activeRun = Math.max(0, this.activeRun - 1);
    else if (key.name === 'right' || key.name === 'down') this.activeRun = Math.min(this.order.length - 1, this.activeRun + 1);
    else if (key.char === 'b' || key.name === 'escape') {
      if (this.phase !== 'running') this.screen = 'menu';
    } else if (key.char === 'q') {
      this.stop();
      this.onQuit();
      process.exit(0);
    } else if (key.char === 'a') {
      void this.startAll();
    } else if (key.char === 'e' && this.currentRun()?.snapshot.escalation) {
      const escalation = this.currentRun()!.snapshot.escalation!;
      this.modal = { runId: this.currentRun()!.snapshot.runId, selected: escalation.recommendedOptionIndex ?? 0 };
    }
  }

  private handleModalKey(key: Key): void {
    if (!this.modal) return;
    const run = this.runUi.get(this.modal.runId);
    const options = run?.snapshot.escalation?.options ?? [];

    if (key.name === 'up') this.modal.selected = Math.max(0, this.modal.selected - 1);
    else if (key.name === 'down') this.modal.selected = Math.min(options.length - 1, this.modal.selected + 1);
    else if (key.name === 'escape') this.modal = null;
    else if (key.name === 'enter') {
      const selected = this.modal.selected;
      const runId = this.modal.runId;
      this.modal = null;
      void this.resolveEscalation(runId, selected);
    }
  }

  // ---------------------------------------------------------------------- runs

  private currentRun(): RunUi | undefined {
    return this.runUi.get(this.order[this.activeRun]);
  }

  private async startSingle(task?: RateLimiterTask): Promise<void> {
    if (!task || this.phase === 'running') return;
    this.phase = 'running';
    this.screen = 'run';
    this.startedAt = Date.now();
    this.prepareRunUi(task);

    const snapshot = await this.orchestrator.runTask(task);
    this.attachSnapshot(snapshot);
    this.phase = 'idle';
    this.dirty = true;
  }

  private async startAll(): Promise<void> {
    if (this.phase === 'running') return;
    this.phase = 'running';
    this.screen = 'run';
    this.startedAt = Date.now();
    this.activeRun = this.order.length;

    const tasks = this.tasks();
    for (const task of tasks) this.prepareRunUi(task);

    const snapshots = await this.orchestrator.runAll(tasks, { concurrency: 3 });
    for (const snapshot of snapshots) this.attachSnapshot(snapshot);
    this.phase = 'idle';
    this.dirty = true;

    // surface the first escalation automatically
    const escalated = snapshots.find(s => s.escalation);
    if (escalated) {
      const index = this.order.indexOf(escalated.runId);
      if (index >= 0) this.activeRun = index;
      this.modal = { runId: escalated.runId, selected: escalated.escalation?.recommendedOptionIndex ?? 0 };
    }
  }

  private prepareRunUi(task: RateLimiterTask): void {
    const workflow = task.buildWorkflow({ verificationSpec: task.verificationSpec });
    const runId = `pending-${task.id}`;
    this.runUi.set(runId, {
      snapshot: {
        runId,
        taskId: task.id,
        title: task.title,
        difficulty: task.difficulty,
        status: 'running',
        workflow,
        startedAt: Date.now()
      },
      nodes: new Map(),
      logs: [],
      loop: null,
      nodeOrder: workflow.nodes.map(n => n.id)
    });
    this.order.push(runId);
    this.activeRun = Math.max(0, this.order.length - 1);
  }

  /** re-key the placeholder run created in prepareRunUi onto the real run id */
  private attachSnapshot(snapshot: RunSnapshot): void {
    const already = this.runUi.get(snapshot.runId);
    if (already) {
      already.snapshot = snapshot;
      this.dirty = true;
      return;
    }

    const pendingId = `pending-${snapshot.taskId}`;
    const pending = this.runUi.get(pendingId);
    if (pending) {
      this.runUi.delete(pendingId);
      const index = this.order.indexOf(pendingId);
      if (index >= 0) this.order[index] = snapshot.runId;
      pending.snapshot = snapshot;
      this.runUi.set(snapshot.runId, pending);
    } else {
      this.runUi.set(snapshot.runId, {
        snapshot,
        nodes: new Map(),
        logs: [],
        loop: null,
        nodeOrder: snapshot.workflow.nodes.map(n => n.id)
      });
      this.order.push(snapshot.runId);
    }
    this.dirty = true;
  }

  private async resolveEscalation(runId: string, option: number): Promise<void> {
    const result = await this.orchestrator.resolveEscalation(runId, option);
    this.dirty = true;

    if (result && result.runId !== runId) {
      // "retry" produced a fresh run — focus it
      this.attachSnapshot(result);
      this.activeRun = this.order.indexOf(result.runId);

      // ...and if that retry escalated too, open its card instead of making the user hunt for it
      if (result.escalation) {
        this.modal = { runId: result.runId, selected: result.escalation.recommendedOptionIndex ?? 0 };
      }
    } else if (result) {
      const ui = this.runUi.get(runId);
      if (ui) ui.snapshot = result;
    }
  }

  private async autoPlay(): Promise<void> {
    await this.startAll();

    if (this.opts.auto && this.modal) {
      // let the minimal-attention card be visible for a moment, then take the
      // recommended action (accept for human review)
      const runId = this.modal.runId;
      await sleep(700);
      if (this.modal?.runId === runId) {
        this.modal = null;
        await this.resolveEscalation(runId, 1);
        await sleep(200);
      }
    }
  }

  // -------------------------------------------------------------------- events

  private handleEvent(event: OrchestratorEvent): void {
    this.dirty = true;

    // route to the run ui (events may arrive before the placeholder is re-keyed)
    let ui = this.runUi.get(event.runId);
    if (!ui && event.runId.startsWith('run-')) {
      const taskId = String(event.data?.taskId ?? '');
      const pendingId = taskId ? `pending-${taskId}` : '';
      const candidate = pendingId ? this.runUi.get(pendingId) : undefined;
      if (candidate && pendingId) {
        this.runUi.delete(pendingId);
        const index = this.order.indexOf(pendingId);
        if (index >= 0) this.order[index] = event.runId;
        candidate.snapshot.runId = event.runId;
        this.runUi.set(event.runId, candidate);
        ui = candidate;
      }
    }

    if (event.kind === 'escalation') {
      const target = this.runUi.get(event.runId) ?? ui;
      if (target && event.data) {
        // the full request is attached when the run settles; the modal is opened there
      }
      return;
    }

    const run = ui ?? this.runUi.get(event.runId);
    if (!run) return;

    if (event.kind === 'node.started') {
      const nodeId = String(event.data?.nodeId ?? '');
      run.nodes.set(nodeId, { status: 'running', startedAt: event.at });
      this.pushLog(run, event);
      return;
    }

    if (event.kind === 'node.finished') {
      const nodeId = String(event.data?.nodeId ?? '');
      const prev = run.nodes.get(nodeId) ?? { status: 'pending' };
      run.nodes.set(nodeId, {
        ...prev,
        status: String(event.data?.status ?? 'completed'),
        endedAt: event.at,
        detail:
          typeof event.data?.iterations === 'number'
            ? `${event.data.iterations}× ${(Number(event.data.score ?? 0) * 100).toFixed(0)}%`
            : prev.detail
      });
      this.pushLog(run, event);
      return;
    }

    if (event.kind === 'log' && event.data) {
      const nodeId = typeof event.data.nodeId === 'string' ? event.data.nodeId : '';
      if (nodeId && typeof event.data.iteration === 'number') {
        const node = run.nodes.get(nodeId) ?? { status: 'running' };
        node.detail = `${event.data.iteration}× ${(Number(event.data.score ?? 0) * 100).toFixed(0)}%`;
        if (!node.status) node.status = 'running';
        run.nodes.set(nodeId, node);
        run.loop = {
          iteration: Number(event.data.iteration),
          score: Number(event.data.score ?? 0),
          passed: Boolean(event.data.passed)
        };
      }
    }

    this.pushLog(run, event);
  }

  private pushLog(run: RunUi, event: OrchestratorEvent): void {
    run.logs.push({
      at: event.at,
      tag: event.tag ?? event.kind,
      message: event.message,
      colour: TAG_COLOUR[event.tag ?? ''] ?? style.gray
    });
    if (run.logs.length > LOG_LIMIT) run.logs.shift();
  }

  // -------------------------------------------------------------------- render

  private dimensions(): { width: number; height: number } {
    const cols = process.stdout.columns || 110;
    const rows = process.stdout.rows || 34;
    return { width: Math.max(76, cols), height: Math.max(20, rows) };
  }

  private draw(): void {
    const frame = this.screen === 'menu' ? this.renderMenu() : this.renderRun();
    this.dirty = false;
    this.lastDrawAt = Date.now();

    if (this.tty) {
      process.stdout.write(`\u001b[H${frame}\u001b[0J`);
    } else {
      process.stdout.write(`${frame}\n`);
    }
  }

  // ------------------------------------------------------------------ menu

  private renderMenu(): string {
    const { width, height } = this.dimensions();
    const lines: string[] = [];
    const tasks = this.tasks();

    lines.push(
      ...box(
        [
          paint(' DSH-Orchestrator · 多智能体自愈编排与可信调度平台', style.bold, style.cyan),
          paint(' Take as little human attention as possible, give as much value as possible.', style.dim)
        ],
        width,
        { title: 'AetherHarness', titleColor: style.cyan }
      )
    );

    // task list
    const taskLines: string[] = [];
    tasks.forEach((task, i) => {
      const selected = i === this.selectedTask;
      const cursor = selected ? paint('▶', style.cyan, style.bold) : ' ';
      const badge =
        task.difficulty === 'hard'
          ? paint('[hard]', style.red)
          : task.difficulty === 'normal'
            ? paint('[normal]', style.yellow)
            : paint('[easy]', style.green);
      taskLines.push(`${cursor} ${badge} ${fit(task.title, width - 20)}`);
      taskLines.push(`    ${paint(truncate(task.description, width - 12), style.dim)}`);
    });
    lines.push(...box(taskLines, width, { title: 'tasks  ↑↓ select · ⏎ run · a run all' }));

    // preview
    const task = tasks[this.selectedTask];
    const preview: string[] = [];
    if (task) {
      preview.push(`${paint('prompt', style.dim)}  ${truncate(task.prompt, width - 12)}`);
      preview.push(
        `${paint('budget', style.dim)}  self-loop max ${task.maxIterations} iterations · ` +
          `seed ${task.seedFeatures.rangeGuard ? 'already hardened' : 'has edge-case defects'}` +
          ` · distributed requirement: ${task.requireCluster ? paint('required (unsatisfiable offline)', style.red) : 'not required'}`
      );
      const hits = this.orchestrator.searchKnowledge(task.prompt, 2);
      for (const hit of hits) {
        preview.push(`${paint('RAG ', style.dim)}  ${truncate(hit.citation, width - 10)}`);
      }
    }
    lines.push(...box(preview, width, { title: 'preview', titleColor: style.green }));

    const snapshot = this.orchestrator.getSnapshot();
    const status: string[] = [
      `${paint('agents', style.dim)} ${snapshot.agents.length}   ` +
        `${paint('tools', style.dim)} ${snapshot.tools.length}   ` +
        `${paint('kb chunks', style.dim)} ${snapshot.knowledgeChunks}   ` +
        `${paint('scheduler queue', style.dim)} ${snapshot.scheduler.queued}   ` +
        `${paint('dispatches', style.dim)} ${snapshot.scheduler.dispatches}`,
      paint('↑↓ select · ⏎ run selected · a run all three (scheduler contention + escalation) · q quit', style.dim)
    ];

    const used = lines.length + status.length + 2;
    const filler = Math.max(0, height - used - 1);
    for (let i = 0; i < filler; i++) lines.push('');

    lines.push(...box(status, width, { title: 'controls', borderColor: style.cyan }));
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ run

  private renderRun(): string {
    const { width, height } = this.dimensions();
    const ui = this.currentRun();
    if (!ui) return this.renderMenu();

    const snapshot = ui.snapshot;
    const badge = statusBadge(snapshot.status);
    const runAge = (snapshot.finishedAt ?? Date.now()) - snapshot.startedAt;

    const tabs = this.order
      .map((id, i) => {
        const run = this.runUi.get(id)!;
        const label = `${i + 1}:${run.snapshot.difficulty}`;
        return i === this.activeRun ? paint(` ${label} `, style.inverse) : paint(` ${label} `, style.dim);
      })
      .join('');

    // The brain label lives in the header on purpose: it must never be clipped away,
    // because "am I actually talking to the model?" is the first question a user asks.
    const llm = this.orchestrator.getLlmInfo();
    const online = llm.telemetry !== undefined;
    const modeText = this.opts.llmWarning
      ? `offline · ${this.opts.llmWarning}`
      : online
        ? llm.label
        : 'offline · deterministic';
    const modeColour = this.opts.llmWarning ? style.yellow : online ? style.cyan : style.gray;
    const modeExtra =
      llm.telemetry && llm.telemetry.calls > 0
        ? paint(
            ` (${llm.telemetry.calls} calls · ${this.compact(llm.telemetry.totalTokens)} tok · ${llm.telemetry.fallbacks} fallback)`,
            style.dim
          )
        : '';

    const header = box(
      [
        `${paint(snapshot.title, style.bold)}  ${paint(badge.text, badge.colour)}  ${paint(
          `⏱ ${elapsed(runAge)}`,
          style.dim
        )}  ${paint('runs:', style.dim)} ${tabs}`,
        `${paint('task', style.dim)} ${snapshot.taskId}  ${paint('workflow', style.dim)} ${snapshot.workflow.id}` +
          `  ${paint('brain', style.dim)} ${paint(modeText, modeColour)}${modeExtra}`
      ],
      width,
      { title: 'AetherHarness · live orchestration', titleColor: style.cyan, badge: snapshot.status }
    );

    // Layout budget. The escalation card is the most important screen in the product,
    // so it gets a guaranteed height instead of inheriting the (smaller) log panel's.
    const headerH = header.length;
    const footerH = 1;
    const escalated = !!snapshot.escalation;
    const verifyH = escalated ? 0 : 6;
    const logH = Math.max(5, Math.min(11, Math.floor(height / 4)));
    const CARD_MAX_H = 14; // banner + 4 fields + 3 options + hints, plus borders
    const cardH = escalated
      ? Math.max(9, Math.min(CARD_MAX_H, height - headerH - 8 - footerH))
      : 0;
    const bottomH = escalated ? cardH : logH;
    const mainH = Math.max(8, height - headerH - verifyH - bottomH - footerH);

    // ---- agents column
    const leftWidth = Math.min(38, Math.max(30, Math.floor(width * 0.32)));
    const agents = this.orchestrator.getAgents();
    const shortRole = (role: string): string =>
      ({
        requirement_analyst: 'analyst',
        architect: 'architect',
        developer: 'engineer',
        critic: 'critic',
        code_reviewer: 'reviewer',
        security_auditor: 'auditor'
      })[role] ?? role.slice(0, 9);

    const agentLines: string[] = [];
    for (const agent of agents) {
      const load = agent.currentLoad;
      const max = agent.profile.maxConcurrency;
      const busy = load > 0;
      agentLines.push(
        `${statusGlyph(busy ? 'running' : 'pending')} ${fit(agent.profile.name, 8)} ` +
          `${paint(fit(shortRole(agent.role), 9), style.dim)} ${bar(load, max, 5, busy ? style.yellow : style.green)} ` +
          `${paint(`${load}/${max}`, style.dim)}`
      );
    }

    const sched = this.orchestrator.scheduler.getStats();
    agentLines.push('');
    agentLines.push(
      `${paint('queue', style.dim)} ${sched.queued}  ${paint('run', style.dim)} ${sched.running}  ` +
        `${paint('done', style.dim)} ${sched.completed}  ${paint('retry', style.dim)} ${sched.retried}`
    );
    agentLines.push(
      `${paint('aging↑', style.dim)} ${sched.agingPromotions}  ${paint('max wait', style.dim)} ${sched.maxObservedWaitMs}ms  ` +
        `${paint('disp', style.dim)} ${sched.dispatches}`
    );
    agentLines.push(
      `${paint('tokens', style.dim)} ${this.totalTokens()}  ${paint('kb', style.dim)} ${this.orchestrator.knowledge.getChunkCount()}` +
        `  ${paint('llm', style.dim)} ${
          llm.telemetry ? `${llm.telemetry.calls}c/${llm.telemetry.fallbacks}fb` : paint('off', style.gray)
        }`
    );

    while (agentLines.length < mainH - 2) agentLines.push('');
    const leftBox = box(agentLines.slice(0, mainH - 2), leftWidth, { title: 'agents · load' });

    // ---- steps column
    const rightWidth = width - leftWidth - 1;
    const stepLines: string[] = [];
    let stepNo = 0;
    for (const nodeId of ui.nodeOrder) {
      const node = snapshot.workflow.nodes.find(n => n.id === nodeId)!;
      const state = ui.nodes.get(nodeId);
      stepNo++;

      const loopCount = snapshot.workflow.nodes.filter(n => n.type === 'self_loop').length;
      const isAlternative =
        loopCount > 1 &&
        node.type === 'self_loop' &&
        // the branch not taken stays pending
        (state === undefined || state.status === 'pending');

      const glyph = statusGlyph(state?.status ?? 'pending');
      const duration =
        state?.startedAt && state?.endedAt
          ? paint(elapsed(state.endedAt - state.startedAt), style.dim)
          : state?.startedAt
            ? paint('…', style.yellow)
            : '';

      const detail = state?.detail ?? '';
      const dim = state ? '' : style.dim;

      stepLines.push(
        `${glyph} ${String(stepNo).padStart(2)}  ${dim}${fit(node.name, 18)}${style.reset} ${paint(fit(node.type, 13), style.gray)} ${fit(duration, 7)} ${paint(truncate(detail, rightWidth - 56), style.dim)}`
      );

      if (node.type === 'self_loop' && state && state.status !== 'pending') {
        const cfg = node.selfLoopConfig!;
        stepLines.push(
          `      ${paint(`↳ ${cfg.maxIterations} max iterations · target ${cfg.targetNodeId} · critic ${cfg.criticAgentId}`, style.gray)}`
        );
      }
      if (isAlternative) {
        stepLines[stepLines.length - 1] = paint(stepLines[stepLines.length - 1], style.dim);
      }
    }

    // verification tiers summary inline
    const verification = snapshot.verification ?? (snapshot.state?.context.lastVerification as any);
    if (verification?.tiers) {
      stepLines.push('');
      for (const tier of verification.tiers) {
        stepLines.push(
          `${tier.passed ? paint('✔', style.green) : paint('✘', style.red)} ${paint(tier.tier, style.bold)} ${fit(truncate(tier.name, 26), 26)} ${paint(`score ${(tier.score * 100).toFixed(0)}%`, style.dim)}`
        );
      }
    }

    while (stepLines.length < mainH - 2) stepLines.push('');
    const rightBox = box(stepLines.slice(0, mainH - 2), rightWidth, {
      title: 'workflow · DAG timeline',
      titleColor: style.blue
    });

    const main = sideBySide(leftBox, rightBox.slice(0, Math.max(leftBox.length, rightBox.length)), leftWidth);

    // ---- verification panel
    const panel: string[] = [];
    if (verifyH > 0) {
      const v = verification;
      if (v) {
        const blocking = (v.blockingReasons ?? []).slice(0, 3);
        panel.push(
          `${paint('score', style.dim)} ${paint(`${(v.score * 100).toFixed(1)}%`, v.passed ? style.green : style.yellow)}  ` +
            `${paint('threshold', style.dim)} ${((v.ruleResults.length || 1) ? 0.9 : 0.9).toFixed(2)}  ` +
            `${paint('verdict', style.dim)} ${v.passed ? paint('PASSED', style.green, style.bold) : paint('BLOCKED', style.red, style.bold)}  ` +
            `${paint('failed rules', style.dim)} ${(v.failedRuleIds ?? []).join(', ') || 'none'}`
        );
        panel.push(
          blocking.length > 0
            ? `${paint('blocking', style.dim)} ${truncate(blocking.join(' | '), width - 12)}`
            : `${paint('blocking', style.dim)} none — the artifact satisfied every tier`
        );
      } else {
        panel.push(paint('waiting for the first verification round…', style.dim));
        if (ui.loop) {
          panel.push(
            `iteration ${ui.loop.iteration} · score ${(ui.loop.score * 100).toFixed(1)}% · ${ui.loop.passed ? 'converged' : 'retrying'}`
          );
        }
      }

      if (snapshot.patch?.patch) {
        const stats = snapshot.patch.stats;
        panel.push(
          `${paint('patch', style.dim)} ${snapshot.patch.filePath} ${paint(`+${stats?.added ?? '?'} / -${stats?.removed ?? '?'}`, style.green)} ` +
            `${paint('· real unified diff (LCS)', style.dim)}`
        );
      }
      if (snapshot.summary && snapshot.status !== 'running') {
        panel.push(paint(truncate(snapshot.summary.split('\n').slice(-1)[0], width - 4), style.dim));
      }
    }

    // ---- log panel or escalation card
    let bottom: string[];
    if (snapshot.escalation) {
      bottom = this.renderEscalationCard(snapshot, ui, width, cardH);
    } else {
      const logLines = ui.logs
        .slice(-(logH - 2))
        .map(l => {
          const time = new Date(l.at).toLocaleTimeString('en-GB', { hour12: false });
          return `${paint(time, style.gray)} ${paint(fit(l.tag, 7), l.colour)} ${truncate(l.message, width - 20)}`;
        });
      while (logLines.length < logH - 2) logLines.push('');
      bottom = box(logLines, width, { title: 'event stream', titleColor: style.magenta });
    }

    const footer = paint(
      'q quit · ←→ switch run · a run all · b back · e escalation card · the engine reports what it actually did',
      style.dim
    );

    const all = [...header, ...main, ...(panel.length ? box(panel, width, { title: 'verification · three tiers', titleColor: style.yellow }) : []), ...bottom, footer];

    // keep the frame inside the terminal height
    return all.slice(0, height).join('\n');
  }

  private renderEscalationCard(snapshot: RunSnapshot, ui: RunUi, width: number, height: number): string[] {
    const esc = snapshot.escalation!;
    const selected = this.modal?.runId === snapshot.runId ? this.modal.selected : -1;

    const lines: string[] = [];
    lines.push(`${paint('! DSH ATTENTION REQUIRED', style.bold, style.bgYellow)}  ${paint('one question, one decision — nothing else', style.dim)}`);
    lines.push('');
    lines.push(`${paint('node    ', style.dim)} ${esc.nodeId}   ${paint('run', style.dim)} ${snapshot.runId}`);
    lines.push(`${paint('reason  ', style.dim)} ${truncate(esc.reason, width - 12)}`);
    lines.push(`${paint('question', style.dim)} ${truncate(esc.question, width - 12)}`);
    lines.push(`${paint('suggest ', style.dim)} ${paint(truncate(esc.recommendedAction, width - 12), style.green)}`);
    lines.push('');
    esc.options.forEach((option, i) => {
      const recommended = i === esc.recommendedOptionIndex;
      const marker = i === selected ? paint('▶', style.cyan, style.bold) : recommended ? paint('▷', style.cyan) : ' ';
      const label = `[${i + 1}] ${option}${recommended ? paint('  ← recommended', style.green) : ''}`;
      lines.push(`${marker} ${i === selected ? paint(label, style.inverse) : label}`);
    });
    lines.push('');
    lines.push(
      paint(
        this.modal
          ? '↑↓ choose · ⏎ apply · esc dismiss'
          : 'press e to focus this card (auto-resolving in auto mode)',
        style.dim
      )
    );

    // On a short terminal the card must degrade by dropping blank rows, never by
    // hiding one of the three decisions.
    while (lines.length > height - 2) {
      const blank = lines.lastIndexOf('');
      if (blank < 0) break;
      lines.splice(blank, 1);
    }

    return box(lines.slice(0, height - 2), width, {
      title: 'human-in-the-loop gateway',
      titleColor: style.yellow,
      borderColor: style.yellow,
      badge: 'needs_human',
      badgeColor: style.bgYellow
    });
  }

  private totalTokens(): string {
    const total = this.orchestrator.getAgents().reduce((s, a) => s + a.profile.totalTokensUsed, 0);
    return total > 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
  }

  private compact(value: number): string {
    return value > 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
  }
}

export function frameWidth(line: string): number {
  return visibleWidth(line);
}
