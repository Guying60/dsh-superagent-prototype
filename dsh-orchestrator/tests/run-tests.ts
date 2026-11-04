/**
 * Comprehensive Test Suite for DSH Agent Orchestrator Platform
 * Verifies all 6 core modules and competition requirements
 */

import { AgentRegistry } from '../src/agent/agent-registry.js';
import { ToolRegistry } from '../src/tools/tool-registry.js';
import { createBuiltinTools } from '../src/tools/builtin-tools.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { WorkflowEngine } from '../src/workflow/workflow-engine.js';
import { DynamicScheduler } from '../src/scheduler/dynamic-scheduler.js';
import { SelfLoopEngine } from '../src/selfloop/self-loop-engine.js';
import { VerificationEngine } from '../src/verification/verification-engine.js';
import { FeedbackOptimizer } from '../src/optimization/feedback-optimizer.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, desc: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ [PASS] ${desc}`);
  } else {
    console.error(`  ✘ [FAIL] ${desc}`);
    throw new Error(`Assertion failed: ${desc}`);
  }
}

async function runAllTests() {
  console.log('\n=== Starting DSH Agent Orchestrator Platform Unit & Integration Tests ===\n');

  // Test 1: Tool Registry & Sandboxed Execution
  console.log('[Test Suite 1] Tool Registry & Builtin Tools');
  const toolRegistry = new ToolRegistry();
  createBuiltinTools().forEach(t => toolRegistry.register(t));
  assert(toolRegistry.getAll().length >= 4, 'Should register at least 4 built-in tools');

  const sandboxRes = await toolRegistry.invoke('code_sandbox', {
    language: 'javascript',
    code: 'console.log("hello sandbox"); return 10 + 20;'
  });
  assert(sandboxRes.exitCode === 0, 'Sandbox exit code should be 0');
  assert(sandboxRes.result === 30, 'Sandbox return value should be 30');
  assert(sandboxRes.stdout.includes('hello sandbox'), 'Sandbox should capture stdout');

  const secScan = await toolRegistry.invoke('static_analyzer', {
    code: 'const x = eval("1+1");'
  });
  assert(!secScan.clean, 'Static analyzer should flag eval()');
  assert(secScan.issues[0].rule === 'SEC-001', 'Should detect SEC-001 violation');

  // Test 2: MCP Tool Registration & Execution
  console.log('\n[Test Suite 2] MCP Integration Protocol');
  toolRegistry.registerMcpTool({
    name: 'external_fetch',
    description: 'Fetch external resource via MCP',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL' } },
      required: ['url']
    }
  }, async (name, args) => ({ fetched: true, target: args.url }));

  const mcpRes = await toolRegistry.invoke('mcp_external_fetch', { url: 'https://api.deepseek.com' });
  assert(mcpRes.fetched === true, 'MCP tool invocation should succeed');

  // Test 3: Agent Registry & Capability Load Balancing
  console.log('\n[Test Suite 3] Agent Registry & Load Balancing');
  const agentRegistry = new AgentRegistry(toolRegistry);
  agentRegistry.register({
    id: 'coder_a',
    name: 'Coder A',
    role: 'developer',
    description: 'Junior dev',
    capabilities: { python: 0.9, ts: 0.7 },
    systemPrompt: 'You are coder A',
    toolIds: ['code_sandbox'],
    maxConcurrency: 1,
    currentLoad: 1, // Busy!
    totalTokensUsed: 0,
    version: '1.0.0'
  });

  agentRegistry.register({
    id: 'coder_b',
    name: 'Coder B',
    role: 'developer',
    description: 'Senior dev',
    capabilities: { python: 0.85, ts: 0.95 },
    systemPrompt: 'You are coder B',
    toolIds: ['code_sandbox'],
    maxConcurrency: 2,
    currentLoad: 0, // Available!
    totalTokensUsed: 0,
    version: '1.0.0'
  });

  const bestAgent = agentRegistry.findBestAgent('python', 0.8);
  assert(bestAgent?.id === 'coder_b', 'Load-aware matching should select available coder_b over busy coder_a');

  // Test 4: Knowledge Base & Hybrid Search
  console.log('\n[Test Suite 4] Knowledge Base & Hybrid RAG');
  const kb = new KnowledgeBase({ chunkSize: 100, hybridAlpha: 0.5 });
  kb.addDocument('doc1', 'Architecture Guidelines', 'Microservices should use asynchronous message queues for decoupling.');
  kb.addDocument('doc2', 'Database Standard', 'PostgreSQL connection pools must not exceed 50 connections.');

  assert(kb.getChunkCount() >= 2, 'Knowledge base should contain at least 2 chunks');
  const hits = kb.query('asynchronous message queues', 1);
  assert(hits.length === 1, 'Should find relevant chunk');
  assert(hits[0].chunk.docId === 'doc1', 'Top hit should be doc1');
  assert(hits[0].citation.includes('Architecture Guidelines'), 'Citation should include document title');

  // Test 5: Dynamic Scheduler & Priority Aging
  console.log('\n[Test Suite 5] Dynamic Scheduler & Priority Aging');
  const scheduler = new DynamicScheduler(agentRegistry);
  const taskLow = scheduler.enqueue({ id: 'node_low', name: 'Low Priority Node', type: 'agent', agentId: 'coder_b' }, 'wf-1', 2);
  const taskHigh = scheduler.enqueue({ id: 'node_high', name: 'High Priority Node', type: 'agent', agentId: 'coder_b' }, 'wf-1', 8);

  assert(scheduler.getQueueLength() === 2, 'Scheduler queue length should be 2');
  const dispatched1 = scheduler.dispatchNext();
  assert(dispatched1?.task.id === taskHigh.id, 'High priority task should be dispatched first');

  // Test 6: Workflow Engine (DAG, Condition & Rollback)
  console.log('\n[Test Suite 6] Declarative Workflow Engine');
  const wfEngine = new WorkflowEngine({ agentRegistry, toolRegistry });

  const testWorkflow = {
    id: 'test-wf',
    name: 'Test Workflow',
    description: 'Verify conditional execution and context mapping',
    version: '1.0.0',
    entryNodeId: 'node_start',
    nodes: [
      {
        id: 'node_start',
        name: 'Start Node',
        type: 'tool' as const,
        toolId: 'code_sandbox',
        inputTransformer: () => ({ language: 'javascript', code: 'return { score: 85 };' }),
        outputKey: 'calcResult'
      },
      {
        id: 'node_branch',
        name: 'Condition Branch',
        type: 'condition' as const,
        conditionFn: (ctx: any) => ctx.calcResult?.result?.score >= 80 ? 'node_high_path' : 'node_low_path'
      },
      {
        id: 'node_high_path',
        name: 'High Score Path',
        type: 'tool' as const,
        toolId: 'code_sandbox',
        inputTransformer: () => ({ language: 'javascript', code: 'return "HIGH_PATH_TAKEN";' }),
        outputKey: 'branchResult'
      },
      {
        id: 'node_low_path',
        name: 'Low Score Path',
        type: 'tool' as const,
        toolId: 'code_sandbox',
        inputTransformer: () => ({ language: 'javascript', code: 'return "LOW_PATH_TAKEN";' }),
        outputKey: 'branchResult'
      }
    ],
    edges: [
      { from: 'node_start', to: 'node_branch' }
    ]
  };

  const wfState = await wfEngine.execute(testWorkflow);
  assert(wfState.status === 'completed', 'Workflow status should be completed');
  assert(wfState.context.branchResult?.result === 'HIGH_PATH_TAKEN', 'Condition node should route to high score path');

  // Test 7: Multi-Tier Verification Engine
  console.log('\n[Test Suite 7] Multi-Tier Verification Engine');
  const verifier = new VerificationEngine(agentRegistry, toolRegistry);

  const verifySpec = {
    rules: [
      {
        name: 'Check Minimum Length',
        check: (output: any) => ({
          passed: String(output).length > 5,
          message: 'Output length acceptable',
          score: 1.0
        })
      }
    ],
    confidenceThreshold: 0.8,
    executableSandboxCheck: {
      testScriptGenerator: () => `assertEqual(sum(2, 3), 5, '2+3=5');`
    }
  };

  const vResult = await verifier.verify(
    { code: 'function sum(a, b) { return a + b; }' },
    verifySpec,
    {}
  );
  assert(vResult.passed, 'Valid function should pass verification');
  assert(vResult.score >= 0.8, 'Score should exceed threshold');

  // Test 8: Self-Loop (PDCA) Engine & Critic Intervention
  console.log('\n[Test Suite 8] Self-Loop Iterative Optimization Engine');
  agentRegistry.register({
    id: 'critic_test',
    name: 'Test Critic',
    role: 'critic',
    description: 'Critic agent',
    capabilities: { root_cause: 1.0 },
    systemPrompt: 'You are critic',
    toolIds: [],
    maxConcurrency: 2,
    currentLoad: 0,
    totalTokensUsed: 0,
    version: '1.0.0'
  });

  const selfLoopEngine = new SelfLoopEngine(agentRegistry, verifier);
  let attemptCount = 0;

  const loopResult = await selfLoopEngine.runLoop(
    {
      maxIterations: 3,
      targetNodeId: 'target_node',
      criticAgentId: 'critic_test',
      verificationNodeId: 'v_node',
      convergenceThreshold: 0.90
    },
    {
      rules: [
        {
          name: 'Non-empty',
          check: (val: any) => ({ passed: true, message: 'ok', score: 1.0 })
        }
      ],
      confidenceThreshold: 0.90,
      executableSandboxCheck: {
        testScriptGenerator: () => `assertEqual(solution(), 42, 'Must return 42');`
      }
    },
    { goal: 'Compute 42' },
    async (_input, iteration) => {
      attemptCount++;
      if (iteration === 1) {
        return { code: 'function solution() { return 0; }' }; // will fail assertion
      } else {
        return { code: 'function solution() { return 42; }' }; // will pass assertion
      }
    }
  );

  assert(loopResult.converged, 'Self-Loop should converge successfully');
  assert(loopResult.totalIterations === 2, 'Should converge on iteration 2');
  assert(attemptCount === 2, 'Should execute target exactly twice');

  // Test 9: Feedback & Prompt Auto-Optimizer
  console.log('\n[Test Suite 9] Feedback & Self-Optimization');
  const optimizer = new FeedbackOptimizer(agentRegistry);
  const promptRecord = optimizer.autoRefinePrompt('coder_b', {
    passed: false,
    score: 0.5,
    ruleResults: [{ ruleName: 'NO_EVAL', passed: false, message: 'Never use eval', score: 0 }]
  });

  assert(promptRecord !== null, 'Should generate prompt refinement record');
  assert(Boolean(agentRegistry.get('coder_b')?.profile.systemPrompt.includes('CRITICAL REQUIREMENT')), 'Agent system prompt should have guardrail appended');

  console.log(`\n========================================================================`);
  console.log(`  ALL ${passedTests}/${totalTests} TESTS PASSED PERFECTLY!  `);
  console.log(`========================================================================\n`);
}

runAllTests().catch(err => {
  console.error('\nTests failed with error:\n', err);
  process.exit(1);
});
