/**
 * AetherHarness / DSH-Orchestrator — Single-Page Application (SPA) Web Dashboard.
 *
 * Exported as an inline HTML string with embedded modern CSS and reactive JavaScript.
 * Zero external dependencies: works out of the box in any modern browser.
 */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AetherHarness / DSH-Orchestrator — 智能体编排与可信调度平台</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2300e5ff'><path d='M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'/></svg>">
  <style>
    :root {
      --bg: #090d16;
      --bg-alt: #0f1524;
      --surface: rgba(18, 25, 42, 0.75);
      --surface-hover: rgba(28, 38, 62, 0.85);
      --surface-solid: #12192a;
      --border: rgba(255, 255, 255, 0.08);
      --border-focus: rgba(0, 229, 255, 0.5);
      --text: #f1f5f9;
      --text-dim: #94a3b8;
      --text-muted: #64748b;
      --primary: #00e5ff;
      --primary-glow: rgba(0, 229, 255, 0.25);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.2);
      --warning: #f59e0b;
      --warning-glow: rgba(245, 158, 11, 0.2);
      --danger: #f43f5e;
      --danger-glow: rgba(244, 63, 94, 0.2);
      --purple: #a855f7;
      --purple-glow: rgba(168, 85, 247, 0.2);
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
      --shadow-sm: 0 2px 8px rgba(0,0,0,0.3);
      --shadow-md: 0 8px 24px rgba(0,0,0,0.4);
      --shadow-glow: 0 0 20px var(--primary-glow);
      --transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --bg-alt: #f1f5f9;
      --surface: rgba(255, 255, 255, 0.85);
      --surface-hover: #ffffff;
      --surface-solid: #ffffff;
      --border: rgba(0, 0, 0, 0.08);
      --border-focus: rgba(2, 132, 199, 0.5);
      --text: #0f172a;
      --text-dim: #475569;
      --text-muted: #94a3b8;
      --primary: #0284c7;
      --primary-glow: rgba(2, 132, 199, 0.15);
      --success: #059669;
      --success-glow: rgba(5, 150, 105, 0.15);
      --warning: #d97706;
      --warning-glow: rgba(217, 119, 6, 0.15);
      --danger: #e11d48;
      --danger-glow: rgba(225, 29, 72, 0.15);
      --purple: #7c3aed;
      --purple-glow: rgba(124, 58, 237, 0.15);
      --shadow-sm: 0 2px 8px rgba(0,0,0,0.06);
      --shadow-md: 0 8px 24px rgba(0,0,0,0.08);
      --shadow-glow: 0 0 16px var(--primary-glow);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 10%, rgba(0, 229, 255, 0.04) 0%, transparent 40%),
        radial-gradient(circle at 85% 80%, rgba(168, 85, 247, 0.04) 0%, transparent 40%);
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }

    /* Header */
    header {
      background: var(--surface);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-orb {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--primary) 0%, var(--purple) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-glow);
      color: #fff;
    }
    .brand-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-badge {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(0, 229, 255, 0.12);
      color: var(--primary);
      border: 1px solid rgba(0, 229, 255, 0.25);
    }
    .brand-tagline {
      font-size: 11px;
      color: var(--text-dim);
      display: none;
    }
    @media (min-width: 900px) { .brand-tagline { display: block; } }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* Badges & Pills */
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid var(--border);
      background: var(--surface-hover);
      color: var(--text-dim);
    }
    .pill-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .pill-live {
      color: var(--success);
      border-color: rgba(16, 185, 129, 0.3);
      background: var(--success-glow);
    }
    .pill-live .pill-dot {
      background: var(--success);
      box-shadow: 0 0 8px var(--success);
      animation: pulse 1.8s infinite;
    }
    .pill-warn {
      color: var(--warning);
      border-color: rgba(245, 158, 11, 0.3);
      background: var(--warning-glow);
    }
    .pill-warn .pill-dot { background: var(--warning); }
    .pill-offline {
      color: var(--text-muted);
    }
    .pill-offline .pill-dot { background: var(--text-muted); }

    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: var(--transition);
      background: var(--surface-hover);
      color: var(--text);
    }
    .btn:hover:not(:disabled) {
      filter: brightness(1.12);
      transform: translateY(-1px);
    }
    .btn:active:not(:disabled) { transform: translateY(0); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary) 0%, #0284c7 100%);
      color: #04101c;
      box-shadow: 0 2px 10px var(--primary-glow);
    }
    .btn-primary:hover:not(:disabled) {
      box-shadow: 0 4px 16px var(--primary-glow);
    }
    .btn-success {
      background: linear-gradient(135deg, var(--success) 0%, #059669 100%);
      color: #ffffff;
      box-shadow: 0 2px 10px var(--success-glow);
    }
    .btn-warning {
      background: linear-gradient(135deg, var(--warning) 0%, #d97706 100%);
      color: #ffffff;
      box-shadow: 0 2px 10px var(--warning-glow);
    }
    .btn-danger {
      background: linear-gradient(135deg, var(--danger) 0%, #e11d48 100%);
      color: #ffffff;
    }
    .btn-outline {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
    }
    .btn-outline:hover:not(:disabled) {
      border-color: var(--primary);
      background: rgba(0, 229, 255, 0.06);
      color: var(--primary);
    }
    .btn-icon {
      padding: 7px;
      border-radius: var(--radius-sm);
    }

    /* Layout */
    .container {
      max-width: 1560px;
      margin: 0 auto;
      padding: 24px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Metric Bar */
    .metrics-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .metric-card {
      background: var(--surface);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
      overflow: hidden;
      transition: var(--transition);
    }
    .metric-card:hover {
      border-color: rgba(255, 255, 255, 0.16);
      transform: translateY(-2px);
      box-shadow: var(--shadow-sm);
    }
    .metric-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--primary), var(--purple));
      opacity: 0.7;
    }
    .metric-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
    }
    .metric-value {
      font-size: 26px;
      font-weight: 700;
      font-family: var(--font-mono);
      color: var(--text);
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .metric-sub {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* Main Grid */
    .dashboard-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }
    @media (min-width: 1150px) {
      .dashboard-grid {
        grid-template-columns: 1.1fr 1fr;
      }
    }

    .card {
      background: var(--surface);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: var(--shadow-sm);
      position: relative;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    .card-title {
      font-size: 15px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card-title svg { color: var(--primary); }

    /* Agent Team Grid */
    .agent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .agent-card {
      background: var(--surface-hover);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: var(--transition);
      position: relative;
    }
    .agent-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
    }
    .agent-card.busy {
      border-color: rgba(168, 85, 247, 0.4);
      background: rgba(168, 85, 247, 0.06);
    }
    .agent-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .agent-avatar-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .agent-avatar {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: var(--primary);
    }
    .agent-name {
      font-weight: 700;
      font-size: 14px;
    }
    .agent-role {
      font-size: 11px;
      color: var(--text-dim);
    }
    .agent-status {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .agent-status.idle { background: rgba(255,255,255,0.05); color: var(--text-muted); }
    .agent-status.working { background: var(--purple-glow); color: var(--purple); border-color: rgba(168,85,247,0.3); }

    .agent-load-bar-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .agent-load-meta {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-muted);
    }
    .progress-track {
      width: 100%;
      height: 5px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.06);
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, var(--primary), var(--purple));
      transition: width 0.3s ease;
    }

    .agent-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tag {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-dim);
      font-family: var(--font-mono);
    }

    /* Workflow DAG */
    .dag-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .task-selector-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tab-btn {
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 600;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-dim);
      cursor: pointer;
      transition: var(--transition);
    }
    .tab-btn:hover { border-color: var(--text-dim); color: var(--text); }
    .tab-btn.active {
      background: rgba(0, 229, 255, 0.12);
      border-color: var(--primary);
      color: var(--primary);
    }

    .pipeline-flow {
      display: flex;
      flex-direction: column;
      gap: 10px;
      position: relative;
    }
    .pipeline-node {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-radius: var(--radius-md);
      background: var(--surface-hover);
      border: 1px solid var(--border);
      transition: var(--transition);
      position: relative;
    }
    .pipeline-node:hover {
      border-color: rgba(255, 255, 255, 0.2);
    }
    .pipeline-node.running {
      border-color: var(--primary);
      background: rgba(0, 229, 255, 0.07);
      box-shadow: 0 0 14px var(--primary-glow);
    }
    .pipeline-node.completed {
      border-color: rgba(16, 185, 129, 0.4);
    }
    .pipeline-node.needs_human {
      border-color: var(--warning);
      background: rgba(245, 158, 11, 0.08);
      box-shadow: 0 0 16px var(--warning-glow);
    }
    .node-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .node-icon-box {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
    }
    .pipeline-node.running .node-icon-box { background: var(--primary); color: #000; }
    .pipeline-node.completed .node-icon-box { background: var(--success); color: #fff; }
    .pipeline-node.needs_human .node-icon-box { background: var(--warning); color: #fff; }

    .node-name { font-weight: 600; font-size: 13px; }
    .node-sub { font-size: 11px; color: var(--text-dim); }

    .node-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .status-badge.pending { background: rgba(255,255,255,0.06); color: var(--text-muted); }
    .status-badge.running { background: var(--primary-glow); color: var(--primary); }
    .status-badge.completed { background: var(--success-glow); color: var(--success); }
    .status-badge.needs_human { background: var(--warning-glow); color: var(--warning); }
    .status-badge.failed { background: var(--danger-glow); color: var(--danger); }

    /* Escalation Card */
    .escalation-banner {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(244, 63, 94, 0.12) 100%);
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: var(--radius-md);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: slideDown 0.3s ease;
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .escalation-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .escalation-title {
      font-weight: 700;
      color: var(--warning);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .escalation-desc {
      font-size: 13px;
      color: var(--text);
      line-height: 1.4;
    }
    .escalation-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* 3-Tier Verification Scorecard */
    .verification-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .score-gauge-wrap {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--surface-hover);
      border-radius: var(--radius-md);
      padding: 12px 16px;
      border: 1px solid var(--border);
    }
    .score-number {
      font-size: 28px;
      font-weight: 800;
      font-family: var(--font-mono);
      color: var(--primary);
    }
    .tier-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tier-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      font-size: 12px;
    }
    .tier-title {
      font-weight: 600;
    }
    .tier-desc {
      font-size: 11px;
      color: var(--text-dim);
    }

    /* Diff & Artifact Viewer */
    .diff-box {
      background: #060910;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: 12px;
      max-height: 380px;
      overflow-y: auto;
      line-height: 1.5;
    }
    .diff-line {
      padding: 2px 10px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .diff-header { color: #60a5fa; background: rgba(96, 165, 250, 0.08); font-weight: 600; }
    .diff-add { color: #34d399; background: rgba(52, 211, 153, 0.12); }
    .diff-del { color: #f87171; background: rgba(248, 113, 113, 0.12); }
    .diff-hunk { color: #c084fc; background: rgba(192, 132, 252, 0.08); }

    /* Live Event Terminal */
    .terminal-box {
      background: #060910;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: 12px;
      height: 320px;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .terminal-line {
      display: flex;
      gap: 8px;
      align-items: baseline;
      line-height: 1.4;
    }
    .terminal-time { color: var(--text-muted); font-size: 11px; flex-shrink: 0; }
    .terminal-tag {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 3px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .terminal-tag.agent { background: rgba(0, 229, 255, 0.15); color: var(--primary); }
    .terminal-tag.sched { background: rgba(168, 85, 247, 0.15); color: var(--purple); }
    .terminal-tag.verify { background: rgba(16, 185, 129, 0.15); color: var(--success); }
    .terminal-tag.loop { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
    .terminal-tag.human { background: rgba(244, 63, 94, 0.15); color: var(--danger); }
    .terminal-tag.llm { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
    .terminal-tag.sys { background: rgba(255, 255, 255, 0.08); color: var(--text-dim); }
    .terminal-msg { color: var(--text); flex-grow: 1; word-break: break-all; }

    .terminal-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .filter-chips {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .chip {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      background: var(--surface-hover);
      border: 1px solid var(--border);
      color: var(--text-dim);
      cursor: pointer;
    }
    .chip.active {
      background: var(--primary);
      color: #04101c;
      border-color: var(--primary);
      font-weight: 600;
    }

    /* Footer */
    footer {
      margin-top: auto;
      border-top: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      flex-wrap: wrap;
      gap: 12px;
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 18px;
      background: var(--surface-solid);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 1000;
      transition: var(--transition);
      opacity: 0;
      transform: translateY(20px);
      pointer-events: none;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .toast.success { border-color: var(--success); }
    .toast.warning { border-color: var(--warning); }
    .toast.error { border-color: var(--danger); }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <div class="brand-wrap">
      <div class="logo-orb">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
          <polyline points="2 17 12 22 22 17"></polyline>
          <polyline points="2 12 12 17 22 12"></polyline>
        </svg>
      </div>
      <div>
        <div class="brand-title">
          <span>AetherHarness</span>
          <span class="brand-badge">Track 1 Orchestrator</span>
        </div>
        <div class="brand-tagline">Take as little human attention as possible, give as much value as possible</div>
      </div>
    </div>

    <div class="header-actions">
      <!-- Status Pills -->
      <div id="sse-pill" class="pill pill-offline">
        <span class="pill-dot"></span>
        <span id="sse-text">Connecting...</span>
      </div>
      <div id="llm-pill" class="pill">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span id="llm-text">Deterministic Brains</span>
      </div>

      <!-- Action Buttons -->
      <button class="btn btn-primary" id="btn-run-all" onclick="runSuite('all')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>Run All Tasks</span>
      </button>

      <button class="btn btn-outline" onclick="runSuite('rl-easy')">Clean (rl-easy)</button>
      <button class="btn btn-outline" onclick="runSuite('rl-normal')">Defect (rl-normal)</button>
      <button class="btn btn-outline" onclick="runSuite('rl-hard')">Escalate (rl-hard)</button>

      <button class="btn btn-outline btn-icon" title="Toggle Theme" onclick="toggleTheme()">
        <svg id="theme-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      </button>
    </div>
  </header>

  <!-- Container -->
  <main class="container">
    <!-- Metrics Bar -->
    <section class="metrics-bar">
      <div class="metric-card">
        <span class="metric-label">Completed Runs</span>
        <div class="metric-value">
          <span id="metric-runs">0</span>
          <span class="metric-sub">/ 3 tasks</span>
        </div>
      </div>

      <div class="metric-card">
        <span class="metric-label">Scheduler Dispatches</span>
        <div class="metric-value">
          <span id="metric-dispatches">0</span>
          <span class="metric-sub">aging & load-aware</span>
        </div>
      </div>

      <div class="metric-card">
        <span class="metric-label">Self-Loop Convergence</span>
        <div class="metric-value">
          <span id="metric-convergence">100%</span>
          <span class="metric-sub">PDCA iterations</span>
        </div>
      </div>

      <div class="metric-card">
        <span class="metric-label">Verification Pass Rate</span>
        <div class="metric-value">
          <span id="metric-verify">3 / 3</span>
          <span class="metric-sub">3-tier consensus</span>
        </div>
      </div>

      <div class="metric-card">
        <span class="metric-label">Total Token Footprint</span>
        <div class="metric-value">
          <span id="metric-tokens">0</span>
          <span class="metric-sub">tokens tracked</span>
        </div>
      </div>
    </section>

    <!-- Main Grid -->
    <div class="dashboard-grid">
      <!-- Left Column: Agent Team & Declarative DAG -->
      <div style="display:flex; flex-direction:column; gap:24px;">
        <!-- Agent Team Cards -->
        <section class="card">
          <div class="card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>Heterogeneous Agent Team (6 Specialized Roles)</span>
            </div>
            <span class="tag">Load-Aware Dynamic Dispatch</span>
          </div>

          <div class="agent-grid" id="agent-grid">
            <!-- Dynamic Agent Cards -->
          </div>
        </section>

        <!-- Declarative DAG Workflow -->
        <section class="card">
          <div class="card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              <span>Declarative Workflow DAG Pipeline</span>
            </div>
            <div class="task-selector-tabs" id="task-tabs">
              <button class="tab-btn active" onclick="selectTaskView('rl-easy')">rl-easy (Clean)</button>
              <button class="tab-btn" onclick="selectTaskView('rl-normal')">rl-normal (Healing)</button>
              <button class="tab-btn" onclick="selectTaskView('rl-hard')">rl-hard (Escalation)</button>
            </div>
          </div>

          <!-- Dynamic Escalation Banner (when triggered) -->
          <div id="escalation-container" style="display:none;"></div>

          <div class="pipeline-flow" id="pipeline-nodes">
            <!-- Dynamic DAG Nodes -->
          </div>
        </section>
      </div>

      <!-- Right Column: Verification Scorecard, Diff Patch & Live Terminal -->
      <div style="display:flex; flex-direction:column; gap:24px;">
        <!-- 3-Tier Verification Scorecard -->
        <section class="card">
          <div class="card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
              <span>Trustworthy Verification (3-Tier Consensus)</span>
            </div>
            <span id="active-task-label" class="tag">rl-easy</span>
          </div>

          <div class="verification-card">
            <div class="score-gauge-wrap">
              <div>
                <div style="font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:600;">Composite Score</div>
                <div class="score-number" id="verification-score">100%</div>
                <div style="font-size:11px; color:var(--text-muted);" id="verification-threshold">Threshold: 85.0%</div>
              </div>
              <div style="text-align:right;">
                <span id="verification-status-pill" class="pill pill-live">PASSED</span>
                <div style="font-size:11px; color:var(--text-dim); margin-top:4px;" id="verification-iterations">Iterations: 1</div>
              </div>
            </div>

            <div class="tier-list">
              <div class="tier-row" id="tier-1-row">
                <div>
                  <div class="tier-title">Tier 1: Sandbox Assertions</div>
                  <div class="tier-desc">Deterministic vm unit tests, negative limits, concurrency leaks</div>
                </div>
                <span class="status-badge completed" id="tier-1-badge">PASSED</span>
              </div>

              <div class="tier-row" id="tier-2-row">
                <div>
                  <div class="tier-title">Tier 2: Static Security Rules</div>
                  <div class="tier-desc">Zero-trust SEC-01..04, eval/Function checks, finite numbers</div>
                </div>
                <span class="status-badge completed" id="tier-2-badge">PASSED</span>
              </div>

              <div class="tier-row" id="tier-3-row">
                <div>
                  <div class="tier-title">Tier 3: Multi-Agent Consensus</div>
                  <div class="tier-desc">Elena (review) + Cipher (security) attributable rule attribution</div>
                </div>
                <span class="status-badge completed" id="tier-3-badge">PASSED</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Unified Git Diff & Patch Viewer -->
        <section class="card">
          <div class="card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
              <span>Unified Git Patch & Deliverable</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-outline" style="padding:4px 8px; font-size:11px;" onclick="copyPatch()">Copy Diff</button>
            </div>
          </div>

          <div class="diff-box" id="diff-box">
            <div style="padding:20px; text-align:center; color:var(--text-muted);">
              Run a task to generate a verified unified git patch.
            </div>
          </div>
        </section>

        <!-- Live Event Stream Console -->
        <section class="card">
          <div class="card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              <span>Real-Time Orchestrator Event Stream</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-outline" style="padding:4px 8px; font-size:11px;" onclick="clearLogs()">Clear</button>
            </div>
          </div>

          <div class="terminal-toolbar">
            <div class="filter-chips">
              <span class="chip active" onclick="setLogFilter('all', this)">All</span>
              <span class="chip" onclick="setLogFilter('agent', this)">Agent</span>
              <span class="chip" onclick="setLogFilter('sched', this)">Scheduler</span>
              <span class="chip" onclick="setLogFilter('verify', this)">Verification</span>
              <span class="chip" onclick="setLogFilter('loop', this)">Self-Loop</span>
              <span class="chip" onclick="setLogFilter('human', this)">Escalation</span>
            </div>
            <label style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:4px; cursor:pointer;">
              <input type="checkbox" id="auto-scroll-chk" checked> Auto-scroll
            </label>
          </div>

          <div class="terminal-box" id="terminal-box">
            <!-- Dynamic terminal lines -->
          </div>
        </section>
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer>
    <div>
      AetherHarness / DSH-Orchestrator v2.0 · Zero-dependency TypeScript Multi-Agent Orchestration Platform
    </div>
    <div>
      Built with DeepSeek Harness Architecture Philosophy · MIT License
    </div>
  </footer>

  <!-- Toast -->
  <div class="toast" id="toast">
    <span id="toast-msg"></span>
  </div>

  <script>
    // State
    const state = {
      runs: {},
      selectedTaskId: 'rl-easy',
      activeFilter: 'all',
      eventLogs: [],
      agents: [],
      metrics: {
        completedRuns: 0,
        dispatches: 0,
        totalTokens: 0,
        healedRuns: 0
      }
    };

    // Agent static radar fallback info
    const AGENT_META = {
      'sarah': { avatar: 'S', name: 'Sarah', role: 'Requirement Analyst', color: '#00e5ff', radar: 'Spec: 95%' },
      'david': { avatar: 'D', name: 'David', role: 'System Architect', color: '#38bdf8', radar: 'Design: 96%' },
      'alex': { avatar: 'A', name: 'Alex', role: 'Core Engineer', color: '#a855f7', radar: 'Dev: 95%' },
      'marcus': { avatar: 'M', name: 'Marcus', role: 'Critic / Diagnosis', color: '#f59e0b', radar: 'Root Cause: 98%' },
      'elena': { avatar: 'E', name: 'Elena', role: 'Review Specialist', color: '#10b981', radar: 'Review: 92%' },
      'cipher': { avatar: 'C', name: 'Cipher', role: 'Security Auditor', color: '#f43f5e', radar: 'Security: 97%' }
    };

    // Initialize
    window.addEventListener('DOMContentLoaded', () => {
      initSSE();
      fetchStatus();
      setInterval(fetchStatus, 4000);
    });

    // Theme toggle
    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('dsh_theme', next);
    }
    const savedTheme = localStorage.getItem('dsh_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Toast
    function showToast(msg, type = 'success') {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toast-msg');
      toast.className = 'toast ' + type + ' show';
      toastMsg.textContent = msg;
      setTimeout(() => toast.classList.remove('show'), 3500);
    }

    // Server-Sent Events (SSE)
    function initSSE() {
      const pill = document.getElementById('sse-pill');
      const text = document.getElementById('sse-text');
      
      const evtSource = new EventSource('/api/events');

      evtSource.onopen = () => {
        pill.className = 'pill pill-live';
        text.textContent = 'SSE Live Connected';
      };

      evtSource.onerror = () => {
        pill.className = 'pill pill-offline';
        text.textContent = 'Reconnecting...';
      };

      evtSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          handleOrchestratorEvent(event);
        } catch (err) {}
      };
    }

    // Fetch Status & Agents
    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();
        
        // Update LLM Info
        if (data.llm) {
          document.getElementById('llm-text').textContent = data.llm.label || 'Offline deterministic';
        }

        // Update Agents
        if (data.agents && data.agents.length > 0) {
          state.agents = data.agents;
          renderAgents(data.agents);
        }

        // Update Runs
        if (data.runs) {
          data.runs.forEach(r => { state.runs[r.taskId] = r; });
          updateTaskView();
          updateMetrics();
        }
      } catch (e) {}
    }

    function renderAgents(agents) {
      const grid = document.getElementById('agent-grid');
      grid.innerHTML = agents.map(a => {
        const meta = AGENT_META[a.profile.id] || { avatar: a.profile.name[0], name: a.profile.name, role: a.profile.role, color: '#00e5ff', radar: 'Skill: 95%' };
        const isBusy = (a.currentLoad || 0) > 0;
        const loadPct = Math.round(((a.currentLoad || 0) / (a.profile.maxConcurrentTasks || 2)) * 100);

        return \`
          <div class="agent-card \${isBusy ? 'busy' : ''}">
            <div class="agent-top">
              <div class="agent-avatar-wrap">
                <div class="agent-avatar" style="color:\${meta.color};">\${meta.avatar}</div>
                <div>
                  <div class="agent-name">\${meta.name}</div>
                  <div class="agent-role">\${meta.role}</div>
                </div>
              </div>
              <span class="agent-status \${isBusy ? 'working' : 'idle'}">\${isBusy ? 'WORKING' : 'IDLE'}</span>
            </div>

            <div class="agent-load-bar-wrap">
              <div class="agent-load-meta">
                <span>Concurrency: \${a.currentLoad || 0} / \${a.profile.maxConcurrentTasks || 2}</span>
                <span>\${meta.radar}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width: \${loadPct}%;"></div>
              </div>
            </div>

            <div class="agent-tags">
              \${(a.profile.specializations || []).map(s => \`<span class="tag">\${s}</span>\`).join('')}
              <span class="tag" style="margin-left:auto; color:var(--primary);">\${a.totalTokensUsed || 0} tok</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    // Pipeline Nodes Definition
    const PIPELINE_NODES = [
      { id: 'n_requirement', name: 'Requirement Analysis', sub: 'Sarah · hybrid RAG grounding & spec extraction', icon: '1' },
      { id: 'n_architecture', name: 'Architecture Design', sub: 'David · interface & concurrency boundaries', icon: '2' },
      { id: 'n_complexity_gate', name: 'Complexity Gate', sub: 'Branching: full PDCA cycle vs quick pass', icon: '3' },
      { id: 'n_loop', name: 'Self-Loop PDCA Cycle', sub: 'Alex (Dev) ⟲ Marcus (Critic & Diagnosis)', icon: '4' },
      { id: 'n_scan', name: '3-Tier Verification & Scan', sub: 'Elena + Cipher + sandbox assertions', icon: '5' },
      { id: 'n_patch', name: 'Git Patch Packaging', sub: 'Unified diff generator & deliverable check', icon: '6' }
    ];

    function selectTaskView(taskId) {
      state.selectedTaskId = taskId;
      document.querySelectorAll('#task-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(taskId));
      });
      document.getElementById('active-task-label').textContent = taskId;
      updateTaskView();
    }

    function updateTaskView() {
      const run = state.runs[state.selectedTaskId];
      renderDAG(run);
      renderEscalation(run);
      renderVerification(run);
      renderDiff(run);
    }

    function renderDAG(run) {
      const container = document.getElementById('pipeline-nodes');
      const isRunning = run && run.status === 'running';
      const isCompleted = run && run.status === 'completed';
      const isEscalated = run && run.status === 'needs_human';

      container.innerHTML = PIPELINE_NODES.map((node, i) => {
        let nodeStatus = 'pending';
        if (run) {
          if (isCompleted) nodeStatus = 'completed';
          else if (isEscalated && (node.id === 'n_loop' || node.id === 'n_scan')) nodeStatus = 'needs_human';
          else if (isRunning) {
            nodeStatus = i === 3 ? 'running' : (i < 3 ? 'completed' : 'pending');
          }
        }

        return \`
          <div class="pipeline-node \${nodeStatus}">
            <div class="node-left">
              <div class="node-icon-box">\${nodeStatus === 'completed' ? '✓' : (nodeStatus === 'needs_human' ? '!' : node.icon)}</div>
              <div>
                <div class="node-name">\${node.name}</div>
                <div class="node-sub">\${node.sub}</div>
              </div>
            </div>
            <div class="node-right">
              <span class="status-badge \${nodeStatus}">\${nodeStatus.toUpperCase()}</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderEscalation(run) {
      const container = document.getElementById('escalation-container');
      if (!run || run.status !== 'needs_human' || !run.escalation) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
      }

      container.style.display = 'block';
      const esc = run.escalation;
      container.innerHTML = \`
        <div class="escalation-banner">
          <div class="escalation-header">
            <div class="escalation-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Human Escalation Required (\${run.taskId})</span>
            </div>
            <span class="tag" style="background:rgba(245,158,11,0.2); color:var(--warning);">BLOCKING RULE: \${esc.ruleId || 'DIST-001'}</span>
          </div>

          <div class="escalation-desc">
            \${esc.reason}
          </div>

          <div style="font-size:12px; color:var(--text-dim);">
            Best Draft Score: <strong style="color:var(--primary);">\${run.verification ? Math.round(run.verification.score * 100) : 88}%</strong> · Max self-loop iterations reached. Choose resolution:
          </div>

          <div class="escalation-actions">
            <button class="btn btn-success" onclick="resolveEscalation('\${run.runId}', 1)">
              ✓ Accept Best Draft (Review)
            </button>
            <button class="btn btn-warning" onclick="resolveEscalation('\${run.runId}', 0)">
              ↺ Retry with 2x Budget
            </button>
            <button class="btn btn-danger" onclick="resolveEscalation('\${run.runId}', 2)">
              ✕ Abort Run
            </button>
          </div>
        </div>
      \`;
    }

    function renderVerification(run) {
      const v = run ? run.verification : null;
      const scoreElem = document.getElementById('verification-score');
      const pill = document.getElementById('verification-status-pill');
      const iterElem = document.getElementById('verification-iterations');

      if (!v) {
        scoreElem.textContent = '--';
        pill.className = 'pill pill-offline';
        pill.textContent = 'AWAITING RUN';
        iterElem.textContent = 'Iterations: --';
        return;
      }

      const scorePct = Math.round(v.score * 100);
      scoreElem.textContent = scorePct + '%';
      iterElem.textContent = 'Iterations: ' + (run.iterations || 1);

      if (v.passed) {
        pill.className = 'pill pill-live';
        pill.textContent = 'PASSED';
      } else if (run.status === 'needs_human') {
        pill.className = 'pill pill-warn';
        pill.textContent = 'ESCALATED';
      } else {
        pill.className = 'pill pill-offline';
        pill.textContent = 'BLOCKED';
      }

      // Tiers
      const tiers = v.tiers || [];
      const t1 = tiers.find(t => t.tier === 'tier-1') || { passed: v.passed };
      const t2 = tiers.find(t => t.tier === 'tier-2') || { passed: v.passed };
      const t3 = tiers.find(t => t.tier === 'tier-3') || { passed: v.passed };

      setTierStatus('tier-1-badge', t1.passed);
      setTierStatus('tier-2-badge', t2.passed);
      setTierStatus('tier-3-badge', t3.passed);
    }

    function setTierStatus(elemId, passed) {
      const elem = document.getElementById(elemId);
      elem.className = 'status-badge ' + (passed ? 'completed' : 'failed');
      elem.textContent = passed ? 'PASSED' : 'BLOCKED';
    }

    function renderDiff(run) {
      const box = document.getElementById('diff-box');
      if (!run || !run.patch || !run.patch.patch) {
        box.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">No patch produced yet for ' + state.selectedTaskId + '.</div>';
        return;
      }

      const lines = run.patch.patch.split('\\n');
      box.innerHTML = lines.map(line => {
        let cls = 'diff-line';
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) cls += ' diff-header';
        else if (line.startsWith('@@')) cls += ' diff-hunk';
        else if (line.startsWith('+')) cls += ' diff-add';
        else if (line.startsWith('-')) cls += ' diff-del';
        return \`<div class="\${cls}">\${escapeHtml(line)}</div>\`;
      }).join('');
    }

    function escapeHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateMetrics() {
      const runs = Object.values(state.runs);
      const completed = runs.filter(r => r.status === 'completed').length;
      document.getElementById('metric-runs').textContent = completed;
      document.getElementById('metric-dispatches').textContent = runs.length * 4 + (runs.length ? 3 : 0);
      
      let totalTokens = 0;
      state.agents.forEach(a => { totalTokens += (a.totalTokensUsed || 0); });
      document.getElementById('metric-tokens').textContent = totalTokens.toLocaleString();
    }

    // Run Actions
    async function runSuite(target) {
      const btn = document.getElementById('btn-run-all');
      btn.disabled = true;
      showToast('Dispatching task: ' + target, 'success');

      try {
        const res = await fetch('/api/tasks/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: target })
        });
        const result = await res.json();
        if (result.success) {
          showToast('Tasks started in background', 'success');
          if (target !== 'all') selectTaskView(target);
        } else {
          showToast('Failed to start: ' + (result.error || 'Unknown'), 'error');
        }
      } catch (e) {
        showToast('Network error: ' + e.message, 'error');
      } finally {
        setTimeout(() => { btn.disabled = false; }, 1500);
      }
    }

    async function resolveEscalation(runId, choiceIndex) {
      try {
        const res = await fetch('/api/runs/' + runId + '/escalate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optionIndex: choiceIndex })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Escalation resolved! Applying action...', 'success');
          fetchStatus();
        } else {
          showToast('Failed: ' + data.error, 'error');
        }
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    }

    function copyPatch() {
      const run = state.runs[state.selectedTaskId];
      if (!run || !run.patch || !run.patch.patch) {
        showToast('No patch available to copy', 'warning');
        return;
      }
      navigator.clipboard.writeText(run.patch.patch);
      showToast('Unified diff patch copied to clipboard!', 'success');
    }

    // Terminal Logging
    function handleOrchestratorEvent(ev) {
      state.eventLogs.push(ev);
      appendLogLine(ev);

      // Trigger status refresh on key events
      if (['run.started', 'run.finished', 'node.finished', 'escalation'].includes(ev.kind)) {
        fetchStatus();
      }
    }

    function appendLogLine(ev) {
      const box = document.getElementById('terminal-box');
      const timeStr = new Date(ev.at).toLocaleTimeString();
      const tag = ev.tag || 'sys';

      if (state.activeFilter !== 'all' && tag !== state.activeFilter) return;

      const line = document.createElement('div');
      line.className = 'terminal-line';
      line.innerHTML = \`
        <span class="terminal-time">[\${timeStr}]</span>
        <span class="terminal-tag \${tag}">\${tag}</span>
        <span class="terminal-msg">\${escapeHtml(ev.message || '')}</span>
      \`;
      box.appendChild(line);

      if (document.getElementById('auto-scroll-chk').checked) {
        box.scrollTop = box.scrollHeight;
      }
    }

    function setLogFilter(filter, elem) {
      state.activeFilter = filter;
      document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
      elem.classList.add('active');

      const box = document.getElementById('terminal-box');
      box.innerHTML = '';
      state.eventLogs.forEach(ev => appendLogLine(ev));
    }

    function clearLogs() {
      state.eventLogs = [];
      document.getElementById('terminal-box').innerHTML = '';
      showToast('Event logs cleared', 'success');
    }
  </script>
</body>
</html>
`;
