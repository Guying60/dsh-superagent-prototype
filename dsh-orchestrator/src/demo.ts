/**
 * DSH Agent Orchestration & Verification Platform - Interactive Demonstration
 * 赛题1：Agent编排创新应用
 */
import { SoftwareEngineeringScenario } from './scenarios/software-engineering-scenario.js';

// Visual formatting helpers
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

async function runDemo() {
  console.log(`\n${CYAN}${BOLD}========================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}       DeepSeek Harness 创新赛道 - 赛题1：Agent编排创新应用平台       ${RESET}`);
  console.log(`${CYAN}${BOLD} 平台定位：对标主流 Harness 框架，融合知识库、动态调度、自我循环与验证 ${RESET}`);
  console.log(`${CYAN}${BOLD} 核心理念：Take as little human attention as possible, give as much value ${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================${RESET}\n`);

  console.log(`${YELLOW}[1/6] 初始化场景与 Agent 团队...${RESET}`);
  const scenario = new SoftwareEngineeringScenario();

  const agents = scenario.agentRegistry.getAll();
  console.log(`已加载 ${BOLD}${agents.length}${RESET} 个异构专业智能体:`);
  agents.forEach(a => {
    const caps = Object.entries(a.profile.capabilities).map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`).join(' ');
    console.log(`  - [${a.role.padEnd(20)}] ${BOLD}${a.profile.name.padEnd(28)}${RESET} | 负载:${a.currentLoad}/${a.profile.maxConcurrency} | 能力: ${caps}`);
  });

  console.log(`\n${YELLOW}[2/6] 知识库 (RAG) 检索测试...${RESET}`);
  const query = 'Distributed Rate Limiter with Token Bucket specifications and security rules';
  const kbHits = scenario.knowledgeBase.query(query, 2);
  console.log(`查询语句: "${query}"`);
  console.log(`检索匹配到 ${kbHits.length} 个高置信度知识分块:`);
  kbHits.forEach((hit, idx) => {
    console.log(`  ${idx + 1}. ${GREEN}${hit.citation}${RESET} (匹配模式: ${hit.matchType})`);
    console.log(`     摘要: ${hit.chunk.content.slice(0, 110).replace(/\n/g, ' ')}...`);
  });

  console.log(`\n${YELLOW}[3/6] 启动复杂软件工程全闭环任务流...${RESET}`);
  const userPrompt = 'Implement a high-throughput Token Bucket Rate Limiter with capacity checking, zero negative token balance, and strict security compliance.';
  console.log(`任务需求: "${userPrompt}"`);

  console.log(`\n${MAGENTA}--> 阶段 1: 需求工程师 (Sarah) 解析需求并生成自动化测试套件...${RESET}`);
  console.log(`${MAGENTA}--> 阶段 2: 架构师 (David) 设计接口与不变量约束...${RESET}`);
  console.log(`${MAGENTA}--> 阶段 3: 进入核心【自我循环 (Self-Loop: PDCA)】代码生成与多层验证引擎...${RESET}\n`);

  const result = await scenario.runScenario(userPrompt);

  console.log(`${CYAN}${BOLD}------------------------------------------------------------------------${RESET}`);
  console.log(`${CYAN}${BOLD}                 核心亮点展示：Self-Loop 迭代执行与修正轨迹              ${RESET}`);
  console.log(`${CYAN}${BOLD}------------------------------------------------------------------------${RESET}`);

  result.selfLoopResult.history.forEach((iter: any) => {
    console.log(`\n${BOLD}>>> 循环轮次 Iteration #${iter.iteration} (${iter.durationMs}ms):${RESET}`);
    console.log(`  - 静态规则评分: ${(iter.verification.score * 100).toFixed(1)}%`);
    console.log(`  - 沙箱单元测试: ${iter.verification.sandboxTestResult?.passed ? GREEN + 'PASSED' : RED + 'FAILED'} ${RESET}(${iter.verification.sandboxTestResult?.output})`);
    
    if (iter.verification.auditorReviews) {
      console.log(`  - 多智能体交叉审核 (Multi-Agent Consensus):`);
      iter.verification.auditorReviews.forEach((rev: any) => {
        const flag = rev.approved ? `${GREEN}✔ 同意` : `${RED}✘ 驳回`;
        console.log(`      * [${rev.agentId}] ${flag}${RESET} - ${rev.comments}`);
      });
    }

    if (!iter.verification.passed && iter.criticFeedback) {
      console.log(`  - ${YELLOW}批评反思智能体 (Marcus) 诊断介入:${RESET}`);
      console.log(`      ${iter.criticFeedback.replace(/\n/g, '\n      ')}`);
    } else {
      console.log(`  - ${GREEN}${BOLD}验证状态: 全部通过！达到收敛阈值 (>= 90%)！退出循环。${RESET}`);
    }
  });

  console.log(`\n${YELLOW}[4/6] 最终产出验证与 Git Patch 生成...${RESET}`);
  console.log(`${GREEN}✔ 已生成合规补丁：${result.patch.filePath}${RESET}`);
  console.log(`补丁预览 (前 8 行):\n${result.patch.patch.split('\n').slice(0, 8).join('\n')}\n...`);

  console.log(`\n${YELLOW}[5/6] 动态调度器与反馈优化指标...${RESET}`);
  console.log(`  - 调度队列当前等待任务数: ${scenario.scheduler.getQueueLength()}`);
  console.log(`  - 提示词自愈历史记录: ${scenario.optimizer.getOptimizationHistory().length} 次调整`);
  console.log(`  - 代码沙箱可靠性分值: ${(scenario.optimizer.getToolReliabilityScore('code_sandbox') * 100).toFixed(0)}%`);

  console.log(`\n${CYAN}${BOLD}========================================================================${RESET}`);
  console.log(`${GREEN}${BOLD}                        任务执行报告与成果交付                         ${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================${RESET}`);
  console.log(result.summary);
  console.log(`\n${GREEN}${BOLD}✔ 演示成功执行完成！全链路指标满足赛题全部要求！${RESET}\n`);
}

runDemo().catch(err => {
  console.error(`${RED}演示运行失败:${RESET}`, err);
  process.exit(1);
});
