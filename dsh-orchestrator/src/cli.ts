#!/usr/bin/env node
/**
 * CLI entry point.
 *
 *   aether                 interactive terminal UI (offline deterministic brains)
 *   aether --live          run the team on the DeepSeek API (needs DEEPSEEK_API_KEY)
 *   aether --auto          auto-play (no keyboard needed)
 *   aether --plain         same UI, but printed without the alternate screen
 *   aether --frames 4      render 4 frames and exit (layout preview / CI)
 *   aether --headless      plain-text end-to-end report (screen recording)
 *   aether --help
 */
import { TuiApp } from './tui/app.js';
import { runHeadless } from './demo.js';
import { WebServer } from './web/server.js';
import { style } from './tui/ansi.js';
import { LlmConfig, isLlmConfigured, resolveLlmConfig } from './agent/llm/index.js';

interface Args {
  auto: boolean;
  plain: boolean;
  headless: boolean;
  web: boolean;
  port?: number;
  frames?: number;
  help: boolean;
  live: boolean;
  model?: string;
  baseUrl?: string;
  noFallback: boolean;
  temperature?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    auto: false,
    plain: false,
    headless: false,
    web: false,
    help: false,
    live: false,
    noFallback: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-w':
      case '--web':
        args.web = true;
        break;
      case '--port': {
        const next = Number(argv[++i]);
        if (Number.isFinite(next) && next > 0) args.port = next;
        break;
      }
      case '-a':
      case '--auto':
        args.auto = true;
        break;
      case '-p':
      case '--plain':
        args.plain = true;
        break;
      case '--headless':
      case '--demo':
        args.headless = true;
        break;
      case '-f':
      case '--frames': {
        const next = Number(argv[++i]);
        args.frames = Number.isFinite(next) && next > 0 ? Math.floor(next) : 3;
        break;
      }
      case '--live':
      case '--llm':
        args.live = true;
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--base-url':
        args.baseUrl = argv[++i];
        break;
      case '--temperature': {
        const next = Number(argv[++i]);
        if (Number.isFinite(next)) args.temperature = next;
        break;
      }
      case '--no-fallback':
        args.noFallback = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

const HELP = `
${style.bold}${style.cyan}AetherHarness / DSH-Orchestrator${style.reset}
Multi-agent self-healing orchestration & trustworthy scheduling — terminal UI.

${style.bold}Usage${style.reset}
  node dist/src/cli.js [options]

${style.bold}Run modes${style.reset}
  (none)          interactive TUI (alternate screen)
  -w, --web       start web dashboard (HTTP + Server-Sent Events, default: 3300)
      --port N    specify port for web server
  -a, --auto      auto-play: run every task, auto-resolve the escalation card
  -p, --plain     render the UI without the alternate screen (pipe-friendly)
  -f, --frames N  render N frames to stdout and exit (layout preview)
      --headless  plain-text end-to-end report (same engine, no TUI)

${style.bold}Model${style.reset}
      --live              run the agent team on the DeepSeek API
      --model NAME        default deepseek-chat (or DEEPSEEK_MODEL)
      --base-url URL      default https://api.deepseek.com (or DEEPSEEK_BASE_URL)
      --temperature T     default 0.2
      --no-fallback       fail the turn instead of degrading to the offline brain

  Requires DEEPSEEK_API_KEY. Without it the platform stays fully offline and
  deterministic — the same engine, just with scripted brains.

${style.bold}Keys${style.reset}
  ↑ / ↓           move in a list
  ⏎               run the selected task
  a               run all tasks concurrently (scheduler contention + escalation)
  ← / →           switch between runs
  e               focus the escalation card
  b / esc         back to the task menu
  q               quit
`;

function buildLlmConfig(args: Args): LlmConfig | undefined {
  if (!args.live) return undefined;

  const config = resolveLlmConfig({
    model: args.model,
    baseUrl: args.baseUrl,
    temperature: args.temperature,
    fallbackToOffline: !args.noFallback
  });

  if (!isLlmConfigured(config)) {
    process.stderr.write(
      `${style.yellow}--live was requested but DEEPSEEK_API_KEY is not set.${style.reset}\n` +
        `  Falling back to the offline deterministic brains.\n` +
        `  PowerShell:  $env:DEEPSEEK_API_KEY="sk-..."\n` +
        `  bash:        export DEEPSEEK_API_KEY=sk-...\n\n`
    );
    return undefined;
  }

  return config;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const llm = buildLlmConfig(args);
  const llmWarning = args.live && !llm ? 'DEEPSEEK_API_KEY not set' : undefined;

  if (llm) {
    const config = resolveLlmConfig(llm);
    process.stdout.write(
      `${style.cyan}model${style.reset} ${config.model ?? 'deepseek-chat'} · ` +
        `${style.dim}${config.baseUrl ?? 'https://api.deepseek.com'}${style.reset}` +
        `${config.fallbackToOffline === false ? ` · ${style.yellow}no fallback${style.reset}` : ''}\n`
    );
  }

  if (args.headless) {
    process.exit(await runHeadless({ llm }));
    return;
  }

  if (args.web) {
    const server = new WebServer({ port: args.port, llm });
    const info = await server.start();
    process.stdout.write(
      `\n${style.cyan}⚡ AetherHarness Web Dashboard listening at ${style.bold}${info.url}${style.reset}\n` +
        `   Interactive multi-agent orchestration, dynamic scheduling & self-loop UI\n` +
        `   Press Ctrl+C to stop.\n\n`
    );

    const shutdown = async () => {
      process.stdout.write('\nShutting down web server...\n');
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const app = new TuiApp({ auto: args.auto, plain: args.plain, frames: args.frames, llm, llmWarning });
  await app.start();
}

main().catch(err => {
  process.stderr.write(`\nstartup failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
