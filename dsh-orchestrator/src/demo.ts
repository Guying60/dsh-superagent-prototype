/**
 * Headless runner — plain-text end-to-end execution.
 *
 * This is the CI / screen-recording mode. It drives the same Orchestrator as the TUI, so
 * the numbers printed here are the numbers the engine produced, not a script.
 */
import { Orchestrator } from './orchestrator.js';
import { RunSnapshot } from './orchestrator.js';
import { LlmConfig } from './agent/llm/index.js';
import { paint, style, truncate } from './tui/ansi.js';

function line(char = '─', width = 78): string {
  return paint(char.repeat(width), style.gray);
}

function heading(text: string): string {
  return `\n${paint('▶ ' + text, style.bold, style.cyan)}`;
}

function renderVerification(run: RunSnapshot): string[] {
  const out: string[] = [];
  const v = run.verification;
  if (!v) return [paint('  (no verification result)', style.dim)];

  out.push(
    `  ${paint('final score', style.dim)} ${paint(`${(v.score * 100).toFixed(1)}%`, v.passed ? style.green : style.yellow)}` +
      `   ${paint('verdict', style.dim)} ${v.passed ? paint('PASSED', style.green, style.bold) : paint('BLOCKED', style.red, style.bold)}` +
      `   ${paint('iterations', style.dim)} ${run.iterations ?? '-'}`
  );

  for (const tier of v.tiers ?? []) {
    const mark = tier.passed ? paint('✔', style.green) : paint('✘', style.red);
    out.push(`  ${mark} ${tier.tier}  ${truncate(tier.name, 34)}  ${paint(`score ${(tier.score * 100).toFixed(0)}%`, style.dim)}`);
    out.push(`      ${paint(truncate(tier.detail, 100), style.gray)}`);
  }

  if (v.blockingReasons?.length) {
    out.push(`  ${paint('blocking reasons:', style.dim)}`);
    for (const reason of v.blockingReasons.slice(0, 4)) out.push(`    ${paint('•', style.red)} ${truncate(reason, 96)}`);
  }
  if (v.failedRuleIds?.length) {
    out.push(`  ${paint('failed rule ids:', style.dim)} ${v.failedRuleIds.join(', ')}`);
  }
  return out;
}

export interface HeadlessOptions {
  /** run the team on a remote model; omit for the offline deterministic brains */
  llm?: LlmConfig;
}

export async function runHeadless(options: HeadlessOptions = {}): Promise<number> {
  const orchestrator = new Orchestrator({
    llm: options.llm,
    onEvent: event => {
      if (event.kind === 'node.started') return;
      const tag = (event.tag ?? event.kind).padEnd(7);
      process.stdout.write(`  ${paint(tag, style.gray)} ${event.message}\n`);
    }
  });

  process.stdout.write(
    `\n${paint('='.repeat(78), style.cyan)}\n` +
      `${paint('  AetherHarness / DSH-Orchestrator', style.bold, style.cyan)}  ${paint('· self-healing orchestration & trustworthy scheduling', style.dim)}\n` +
      `${paint('  Take as little human attention as possible, give as much value as possible.', style.dim)}\n` +
      `${paint('='.repeat(78), style.cyan)}\n`
  );

  // ------------------------------------------------------------------ team
  const llmInfo = orchestrator.getLlmInfo();
  process.stdout.write(heading('1/5  agent team'));
  process.stdout.write(`  ${paint('brain', style.dim)}  ${paint(llmInfo.label, llmInfo.telemetry ? style.cyan : style.gray)}\n`);
  for (const agent of orchestrator.getAgents()) {
    const caps = Object.entries(agent.profile.capabilities)
      .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
      .join(' · ');
    process.stdout.write(
      `  ${paint(agent.profile.name.padEnd(9), style.bold)} ${paint(agent.role.padEnd(20), style.dim)} ` +
        `${paint(`slots ${agent.profile.maxConcurrency}`, style.gray)}  ${paint(caps, style.gray)}\n`
    );
    process.stdout.write(`  ${' '.repeat(9)} ${paint(`↳ ${agent.brainName}`, style.gray)}\n`);
  }

  // ------------------------------------------------------------------- rag
  process.stdout.write(heading('2/5  hybrid retrieval (CJK-aware bigram + hashed vector)'));
  const probe = '分布式限流器 token bucket 容量校验 安全规范';
  for (const hit of orchestrator.searchKnowledge(probe, 3)) {
    process.stdout.write(`  ${paint('•', style.green)} ${truncate(hit.citation, 104)}\n`);
    process.stdout.write(`    ${paint(truncate(hit.chunk.content.replace(/\s+/g, ' '), 104), style.dim)}\n`);
  }

  // ------------------------------------------------------------------ runs
  process.stdout.write(heading('3/5  running the catalogue concurrently (3 tasks, 3 runs)'));
  const tasks = orchestrator.getTasks();
  const runs = await orchestrator.runAll(tasks, { concurrency: 3 });

  // ---------------------------------------------------------- escalation
  const escalated = runs.find(r => r.escalation);
  if (escalated) {
    process.stdout.write(heading('4/5  human-in-the-loop gateway'));
    const esc = escalated.escalation!;
    process.stdout.write(
      `  ${paint('┌─[DSH ATTENTION REQUIRED]', style.bgYellow, style.bold)} ${paint(escalated.title, style.bold)}\n`
    );
    process.stdout.write(`  ${paint('│ node    ', style.dim)} ${esc.nodeId}\n`);
    process.stdout.write(`  ${paint('│ reason  ', style.dim)} ${truncate(esc.reason, 100)}\n`);
    process.stdout.write(`  ${paint('│ question', style.dim)} ${truncate(esc.question, 100)}\n`);
    process.stdout.write(`  ${paint('│ suggest ', style.dim)} ${paint(truncate(esc.recommendedAction, 100), style.green)}\n`);
    esc.options.forEach((option, i) => {
      process.stdout.write(`  ${paint('│', style.dim)} [${i + 1}] ${option}\n`);
    });
    const reviewPatch = await orchestrator.resolveEscalation(escalated.runId, 1);
    process.stdout.write(
      `  ${paint('└─ resolved:', style.dim)} option [2] accepted for human review ` +
        `${paint(reviewPatch?.status ?? '', style.green)}\n`
    );
  } else {
    process.stdout.write(heading('4/5  human-in-the-loop gateway'));
    process.stdout.write(`  ${paint('no escalation raised — zero human interruptions', style.green)}\n`);
  }

  // ---------------------------------------------------------------- report
  process.stdout.write(heading('5/5  delivery report\n'));
  for (const run of runs) {
    const statusColour =
      run.status === 'completed' ? style.green : run.status === 'needs_human' ? style.yellow : style.red;
    process.stdout.write(
      `  ${paint('●', statusColour)} ${paint(run.title.padEnd(38), style.bold)} ` +
        `${paint(run.status.padEnd(12), statusColour)} ${paint(`score ${((run.verification?.score ?? 0) * 100).toFixed(1)}%`, style.dim)}\n`
    );
    for (const l of renderVerification(run)) process.stdout.write(l + '\n');
    if (run.patch?.patch) {
      const stats = run.patch.stats;
      process.stdout.write(
        `  ${paint('patch', style.dim)} ${run.patch.filePath} ${paint(`(+${stats?.added} / -${stats?.removed})`, style.green)}\n`
      );
      const preview = run.patch.patch.split('\n').slice(0, 8).join('\n');
      process.stdout.write(preview.replace(/^/gm, '    ') + '\n');
      process.stdout.write(`    ${paint('…', style.dim)}\n`);
    }
    process.stdout.write(line() + '\n');
  }

  // ------------------------------------------------------------- telemetry
  const snap = orchestrator.getSnapshot();
  process.stdout.write(heading('platform telemetry'));
  process.stdout.write(
    `  ${paint('scheduler', style.dim)}  dispatches ${snap.scheduler.dispatches} · completed ${snap.scheduler.completed} · ` +
      `retried ${snap.scheduler.retried} · aging promotions ${snap.scheduler.agingPromotions}` +
      `${snap.scheduler.agingPromotions === 0 ? ` (τ=5000ms — no task waited that long in this ~2s run)` : ''} · ` +
      `max wait ${snap.scheduler.maxObservedWaitMs}ms\n`
  );
  process.stdout.write(`  ${paint('tools', style.dim)}      ` +
    snap.tools.map(t => `${t.toolId} ${(t.reliability * 100).toFixed(0)}%/${t.calls}`).join(' · ') + '\n');
  process.stdout.write(
    `  ${paint('optimizer', style.dim)}  ${snap.promptOptimizations} prompt guardrail adjustment(s) applied to live agents\n`
  );
  process.stdout.write(
    `  ${paint('tokens', style.dim)}     ${snap.agents.reduce((s, a) => s + a.tokens, 0)} ` +
      `${snap.llm.telemetry ? 'accumulated (API usage + estimates for fallback turns)' : 'estimated'} across ${snap.agents.length} agents\n`
  );

  if (snap.llm.telemetry) {
    const t = snap.llm.telemetry;
    process.stdout.write(
      `  ${paint('llm', style.dim)}        ${snap.llm.label} · ${t.calls} call(s) · ` +
        `${t.promptTokens} prompt + ${t.completionTokens} completion = ${t.totalTokens} tokens · ` +
        `${t.fallbacks} fallback(s)` +
        `${t.lastError ? ` · last error: ${truncate(t.lastError, 70)}` : ''}\n`
    );
  } else {
    process.stdout.write(
      `  ${paint('llm', style.dim)}        offline · deterministic brains (add --live to run on DeepSeek)\n`
    );
  }
  process.stdout.write(
    `  ${paint('human', style.dim)}      ${
      snap.escalationsRaised > 0
        ? `${snap.escalationsRaised} structured card(s) raised for ${runs.length} tasks, all resolved`
        : `0 interruptions for ${runs.length} tasks`
    }\n\n`
  );

  const failed = runs.filter(r => r.status === 'failed').length;
  process.stdout.write(
    `${paint('='.repeat(78), style.cyan)}\n` +
      `${paint(`  ${runs.length - failed}/${runs.length} runs delivered · ${failed} failed`, style.bold, failed ? style.red : style.green)}\n` +
      `${paint('='.repeat(78), style.cyan)}\n\n`
  );

  return failed === 0 ? 0 : 1;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('demo.js') ?? false;
if (isMain) {
  runHeadless()
    .then(code => process.exit(code))
    .catch(err => {
      process.stderr.write(`headless run failed: ${err?.stack ?? err}\n`);
      process.exit(1);
    });
}
