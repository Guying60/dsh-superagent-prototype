/**
 * Role-specific LLM prompts and — critically — response validators.
 *
 * Each spec is a contract: what the model must answer, and what the platform will accept.
 * A response that cannot be validated raises, which lets `FallbackBrain` degrade to the
 * offline brain instead of poisoning the run with garbage.
 *
 * Grounding note: the *acceptance test suite* is always the canonical one from the domain
 * module, never model-authored. An LLM writing both the code and its own tests would let
 * the self-loop "converge" against a weakened oracle.
 */
import { BrainContext } from '../brain.js';
import { RuleFailure } from '../../types/index.js';
import { RATE_LIMITER_TESTS, asCode } from '../../scenarios/rate-limiter.js';
import { LlmBrainSpec } from './llm-brain.js';
import {
  bulletList,
  extractFencedCode,
  extractJson,
  formatRuleFailures,
  toStringArray,
  truncateText
} from './prompt.js';

/**
 * The only signal ids an LLM auditor may cite. Each one maps to a repair strategy in the
 * developer's fix space, so an invented id would be noise the self-loop cannot act on.
 */
export const AUDIT_SIGNAL_CATALOG: Record<string, string> = {
  'SEC-001': 'dynamic code execution (eval / new Function)',
  'SEC-002': 'hardcoded credential or API key',
  'SEC-003': 'consume() does not validate Number.isFinite(tokens)',
  'SEC-004': 'sandbox-escape pattern (constructor.constructor / __proto__)',
  'REV-001': 'state invariants are not documented next to the implementation',
  'REV-002': 'unresolved TODO/FIXME marker left behind',
  'REV-003': 'artifact is implausibly small to be a credible implementation'
};

export const DEFAULT_SECURITY_CONSTRAINTS = [
  'no eval() / new Function() anywhere in the artifact',
  'validate Number.isFinite(tokens) before mutating state',
  'no hardcoded credentials'
];

const input = (ctx: BrainContext) => ctx.request.input as Record<string, any>;

const previousArtifact = (ctx: BrainContext): string => {
  const data = input(ctx);
  return asCode(data.lastOutput) || asCode(data.seedSource) || asCode(data.previousAttempt) || '';
};

const testSuite = (ctx: BrainContext): string =>
  String(input(ctx).requirementSpec?.testSuiteCode ?? RATE_LIMITER_TESTS);

// ---------------------------------------------------------------------------
// Requirement analyst
// ---------------------------------------------------------------------------

export function analystSpec(): LlmBrainSpec {
  return {
    kind: 'llm:requirement_analyst',
    name: 'LLM requirement extraction',
    temperature: 0.1,
    maxTokens: 700,
    system: () =>
      [
        'ROLE: analyst',
        'You are Sarah, the requirement analyst on an autonomous software-engineering platform.',
        'Turn a feature request into objective, automatable acceptance criteria.',
        'Answer with ONLY a JSON object:',
        '{"featureName": string, "acceptanceCriteria": string[], "securityConstraints": string[]}',
        'Rules:',
        '- 3 to 6 acceptance criteria, each checkable by an automated assertion.',
        '- Describe observable behaviour or a statically checkable property; never "works well".',
        '- securityConstraints must mention numeric finiteness (NaN / Infinity) and the ban on dynamic code evaluation.',
        '- No prose outside the JSON.'
      ].join('\n'),
    user: ctx => {
      const data = input(ctx);
      const citations: string[] = Array.isArray(data.knowledgeCitations) ? data.knowledgeCitations : [];
      return [
        'Feature request:',
        String(data.goal ?? ctx.request.taskId),
        '',
        `Declared difficulty: ${String(data.difficulty ?? 'normal')}`,
        '',
        'Retrieved standards (grounding):',
        bulletList(citations)
      ].join('\n');
    },
    parse: (content, ctx) => {
      const json = extractJson<Record<string, any>>(content);
      const criteria = toStringArray(json.acceptanceCriteria);
      if (criteria.length === 0) throw new Error('analyst returned no acceptanceCriteria');

      const constraints = toStringArray(json.securityConstraints);

      return {
        output: {
          featureName: String(json.featureName ?? 'Token Bucket RateLimiter'),
          difficulty: input(ctx).difficulty ?? 'normal',
          acceptanceCriteria: criteria,
          securityConstraints: constraints.length > 0 ? constraints : DEFAULT_SECURITY_CONSTRAINTS,
          // grounded oracle: never model-authored
          testSuiteCode: RATE_LIMITER_TESTS,
          seedBytes: previousArtifact(ctx).length
        },
        reasoning: `Extracted ${criteria.length} acceptance criteria and ${constraints.length} security constraint(s).`,
        confidence: 0.9
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Architect
// ---------------------------------------------------------------------------

export function architectSpec(): LlmBrainSpec {
  return {
    kind: 'llm:architect',
    name: 'LLM interface & invariant design',
    temperature: 0.2,
    maxTokens: 500,
    system: () =>
      [
        'ROLE: architect',
        'You are David, the architect on an autonomous software-engineering platform.',
        'Answer with ONLY a JSON object:',
        '{"className": string, "methods": string[], "invariants": string[], "timeResolution": string}',
        'Rules:',
        '- invariants: at least 2 state properties that must always hold (they steer implementation review).',
        '- methods: the exact public signatures required by the acceptance criteria.',
        '- No prose outside the JSON.'
      ].join('\n'),
    user: ctx => {
      const spec = input(ctx).requirementSpec ?? {};
      return [
        'Acceptance criteria:',
        bulletList(toStringArray(spec.acceptanceCriteria)),
        '',
        'Security constraints:',
        bulletList(toStringArray(spec.securityConstraints)),
        '',
        'Design the interface and the invariants for a token bucket rate limiter.'
      ].join('\n');
    },
    parse: content => {
      const json = extractJson<Record<string, any>>(content);
      const invariants = toStringArray(json.invariants);
      if (invariants.length === 0) throw new Error('architect returned no invariants');

      return {
        output: {
          className: String(json.className ?? 'RateLimiter'),
          methods: toStringArray(json.methods),
          invariants,
          timeResolution: String(json.timeResolution ?? 'lazy timestamp-based refill')
        },
        reasoning: `Designed a ${invariants.length}-invariant contract: ${invariants.join(' | ')}`,
        confidence: 0.88
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Developer (the one that actually writes code)
// ---------------------------------------------------------------------------

export function developerSpec(): LlmBrainSpec {
  return {
    kind: 'llm:developer',
    name: 'LLM code generation & repair',
    temperature: 0.1,
    maxTokens: 2200,
    system: () =>
      [
        'ROLE: developer',
        'You are Alex, a senior engineer on an autonomous defect-healing platform.',
        'Your job: rewrite the artifact so that EVERY failing rule is satisfied without regressing the passing ones.',
        'Answer with ONLY a JSON object:',
        '{"code": "<the complete file as a string>", "changes": string[], "notes": string}',
        'Hard constraints on the code you emit:',
        '- valid ES2022 declaring `class RateLimiter` with consume(tokens = 1), getAvailableTokens(), reset()',
        '- no eval(), no new Function(), no dynamic code execution',
        '- no hardcoded credentials',
        '- emit the WHOLE file: never a diff and never a fragment',
        '- document the class invariants in a comment',
        '- if the previous attempt already satisfies every failing rule, return it unchanged: do not refactor working code',
        'No prose outside the JSON.'
      ].join('\n'),
    user: ctx => {
      const data = input(ctx);
      const spec = data.requirementSpec ?? {};
      const design = data.architectureDesign ?? {};
      const sandbox = data.lastVerification?.sandboxTestResult;
      const sandboxDetail =
        sandbox && !sandbox.passed ? String(sandbox.output ?? '') : '(all assertions passed last round, or not run yet)';

      // Tell the model what already works. Without this it rewrites the whole file blind
      // and happily deletes guards that already passed — the classic LLM regression.
      const previousRules = Array.isArray(data.lastVerification?.ruleResults)
        ? (data.lastVerification.ruleResults as Array<{ passed?: boolean; ruleId?: string; ruleName?: string }>)
        : [];
      const passedLines = [
        ...previousRules.filter(r => r.passed === true).map(r => String(r.ruleId ?? r.ruleName)),
        ...(typeof sandbox?.passedCount === 'number'
          ? [`the sandbox already passed ${sandbox.passedCount}/${sandbox.totalCount ?? '?'} assertions`]
          : [])
      ];

      return [
        'Task:',
        String(data.goal ?? 'Implement a token bucket rate limiter.'),
        '',
        'Acceptance criteria:',
        bulletList(toStringArray(spec.acceptanceCriteria)),
        '',
        'Security constraints:',
        bulletList(toStringArray(spec.securityConstraints)),
        '',
        'Architectural contract:',
        `  className: ${String(design.className ?? 'RateLimiter')}`,
        `  methods: ${(Array.isArray(design.methods) ? design.methods : []).join(', ') || '(not specified)'}`,
        `  invariants: ${(Array.isArray(design.invariants) ? design.invariants : []).join(' | ') || '(not specified)'}`,
        '',
        `Currently failing rules (${ctx.failedRules.length}) — fix all of them:`,
        formatRuleFailures(ctx.failedRules),
        '',
        'Already passing — do NOT break these:',
        bulletList(passedLines),
        '',
        'Sandbox assertion errors from the previous attempt:',
        sandboxDetail,
        '',
        'Critic guidance from the previous iteration:',
        ctx.criticGuidance ? truncateText(ctx.criticGuidance, 1200) : '(none — this is the first attempt)',
        ...(data.regressionWarning
          ? ['', 'REGRESSION WARNING:', truncateText(String(data.regressionWarning), 600)]
          : []),
        '',
        'Your previous attempt (complete file):',
        '```js',
        truncateText(previousArtifact(ctx), 4000) || '// (empty)',
        '```',
        '',
        'The acceptance test suite your code must pass verbatim:',
        '```js',
        truncateText(testSuite(ctx), 3000),
        '```',
        '',
        'If a rule genuinely cannot be satisfied, still return the best complete file and explain the gap in `notes`.',
        'Return JSON only.'
      ].join('\n');
    },
    parse: content => {
      let code = '';
      let changes: string[] = [];
      let notes = '';
      let parsed: Record<string, any> | undefined;

      try {
        parsed = extractJson<Record<string, any>>(content);
      } catch {
        parsed = undefined;
      }

      if (parsed) {
        // models rename the field constantly; accept the plausible spellings
        const candidate =
          typeof parsed.code === 'string'
            ? parsed.code
            : typeof parsed.implementation === 'string'
              ? parsed.implementation
              : typeof parsed.source === 'string'
                ? parsed.source
                : typeof parsed.file === 'string'
                  ? parsed.file
                  : typeof parsed.content === 'string'
                    ? parsed.content
                    : '';
        code = candidate;
        changes = toStringArray(parsed.changes);
        notes = typeof parsed.notes === 'string' ? parsed.notes : '';
      }

      if (code.trim().length < 40) {
        // the envelope may be malformed, or the model may have answered with prose + a fence
        const fenced = extractFencedCode(content);
        if (fenced) code = fenced;
      }

      if (code.trim().length < 40) {
        const head = content.replace(/\s+/g, ' ').trim().slice(0, 100);
        throw new Error(
          `developer response contained no usable code (${content.length} chars, starts with "${head}")`
        );
      }

      const reasoningParts = [
        changes.length > 0 ? `changes: ${changes.join(' · ')}` : '',
        notes ? `notes: ${notes}` : ''
      ].filter(Boolean);

      return {
        output: { code: code.trim(), changes, notes },
        reasoning: `LLM rewrite (${code.split('\n').length} lines). ${reasoningParts.join(' | ') || 'no change summary provided.'}`,
        confidence: 0.8
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Critic
// ---------------------------------------------------------------------------

export function criticSpec(): LlmBrainSpec {
  return {
    kind: 'llm:critic',
    name: 'LLM root-cause critic',
    temperature: 0.2,
    maxTokens: 900,
    system: () =>
      [
        'ROLE: critic',
        'You are Marcus, an adversarial root-cause critic on a self-healing pipeline.',
        'You receive the failing rules and the evidence from automated verification. Explain the cause and prescribe a fix.',
        'Answer with ONLY a JSON object:',
        '{"rootCause": string, "directives": string[], "feedback": string}',
        'Rules:',
        '- directives: one concrete instruction per failing rule, quoting its id.',
        '- feedback: 3-6 lines a code generator can act on immediately.',
        '- No praise, no restating the rule text verbatim, no hedging.',
        '- No prose outside the JSON.'
      ].join('\n'),
    user: ctx => {
      const data = input(ctx);
      const failures = (data.failedRules as RuleFailure[] | undefined) ?? ctx.failedRules;
      const blocking = Array.isArray(data.blockingReasons) ? (data.blockingReasons as string[]) : [];

      return [
        `Iteration ${ctx.iteration} — goal: ${String(data.goal ?? 'satisfy the acceptance criteria')}`,
        '',
        `Failing rules (${failures?.length ?? 0}):`,
        formatRuleFailures(failures ?? []),
        '',
        'Blocking reasons reported by the verification engine:',
        bulletList(blocking),
        '',
        'Sandbox output:',
        truncateText(String(data.sandboxOutput ?? '(none)'), 1200),
        '',
        'Auditor findings:',
        truncateText(JSON.stringify(data.auditor ?? [], null, 0), 1200)
      ].join('\n');
    },
    parse: content => {
      const json = extractJson<Record<string, any>>(content);
      const directives = toStringArray(json.directives);
      const feedback = typeof json.feedback === 'string' ? json.feedback.trim() : '';
      const rootCause = typeof json.rootCause === 'string' ? json.rootCause.trim() : '';

      if (feedback.length === 0 && directives.length === 0) {
        throw new Error('critic returned neither feedback nor directives');
      }

      const text = [rootCause ? `ROOT CAUSE: ${rootCause}` : '', feedback, directives.length ? `DIRECTIVES:\n${bulletList(directives)}` : '']
        .filter(Boolean)
        .join('\n');

      return {
        output: { feedback: text, rootCause, directives },
        reasoning: text,
        confidence: 0.86
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Auditors (Tier-3)
// ---------------------------------------------------------------------------

export function auditSpec(role: 'code_reviewer' | 'security_auditor', persona: string): LlmBrainSpec {
  const focus =
    role === 'security_auditor'
      ? 'injection, credentials, dynamic code execution, numeric hardening and sandbox escapes'
      : 'maintainability, documented invariants, dangling markers and structural completeness';

  return {
    kind: `llm:${role}`,
    name: `LLM ${role}`,
    temperature: 0.1,
    maxTokens: 700,
    system: () =>
      [
        'ROLE: auditor',
        `You are ${persona}, a ${role} on a zero-trust review board.`,
        `Your focus: ${focus}.`,
        'Answer with ONLY a JSON object:',
        '{"approved": boolean, "comments": string, "signals": [{"id": "<signal id>", "reason": "<one line>"}]}',
        'You may cite ONLY these signal ids:',
        ...Object.entries(AUDIT_SIGNAL_CATALOG).map(([id, text]) => `  - ${id}: ${text}`),
        'Rules:',
        '- Blocking requires a concrete, citable defect from the list above; approving without evidence is the default.',
        '- If you approve, signals MUST be empty.',
        '- No prose outside the JSON.'
      ].join('\n'),
    user: ctx => {
      const data = input(ctx);
      const artifact = String(data.auditTarget ?? '');
      const spec = data.context?.requirementSpec ?? {};
      return [
        `Artifact under review (iteration ${String(data.iteration ?? ctx.iteration)}):`,
        '```js',
        truncateText(artifact, 5000) || '// (empty artifact)',
        '```',
        '',
        'Acceptance criteria it claims to satisfy:',
        bulletList(toStringArray(spec.acceptanceCriteria)),
        '',
        'Decide whether this may ship.'
      ].join('\n');
    },
    parse: content => {
      const json = extractJson<Record<string, any>>(content);
      const raw = Array.isArray(json.signals) ? (json.signals as any[]) : [];

      const signals: Array<{ ruleId: string; message: string }> = [];
      const unknown: string[] = [];

      for (const item of raw) {
        const id = typeof item === 'string' ? item : String(item?.id ?? item?.ruleId ?? '');
        const reason = typeof item === 'string' ? '' : String(item?.reason ?? item?.message ?? '');
        if (!id) continue;
        if (AUDIT_SIGNAL_CATALOG[id]) {
          signals.push({ ruleId: id, message: reason || AUDIT_SIGNAL_CATALOG[id] });
        } else {
          unknown.push(id);
        }
      }

      let approved = json.approved === true;
      // an answer that approves while citing defects is internally inconsistent: trust the evidence
      if (approved && signals.length > 0) approved = false;

      const baseComments =
        typeof json.comments === 'string' && json.comments.trim().length > 0
          ? json.comments.trim()
          : approved
            ? 'approved — no citable defect found'
            : `rejected — ${signals.map(s => s.ruleId).join(', ') || 'unspecified defect'}`;

      const comments = unknown.length > 0 ? `${baseComments} [ignored unknown signal ids: ${unknown.join(', ')}]` : baseComments;

      return {
        output: { approved, comments, signals, confidence: approved ? 0.85 : 0.82 },
        reasoning: comments,
        confidence: approved ? 0.85 : 0.82
      };
    }
  };
}

export const SPEC_FACTORIES: Record<string, () => LlmBrainSpec> = {
  requirement_analyst: analystSpec,
  architect: architectSpec,
  developer: developerSpec,
  critic: criticSpec,
  code_reviewer: () => auditSpec('code_reviewer', 'Elena'),
  security_auditor: () => auditSpec('security_auditor', 'Cipher')
};
