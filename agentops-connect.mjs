#!/usr/bin/env node
// Budgethelm 連接腳本：在客戶自己的電腦跑，自動找出裝了哪些 AI agent 工具、用哪些模型服務商，
// 把能讀到的用量（時間、模型、token 數）回報到 Budgethelm 專案。單一檔案、只用 Node 內建模組（Node 18+）。
//
// 用法：
//   node agentops-connect.mjs                 只偵測、印出會送什麼，不送任何東西（預設）
//   node agentops-connect.mjs --send          確認後回報；匯入金鑰從環境變數 AGENTOPS_KEY 讀，沒有就提示輸入（不顯示在畫面）
//   node agentops-connect.mjs --install       在這台電腦裝好 Budgethelm：找到的每個工具都接上守護 hook（Claude Code、Codex CLI、Cursor、Gemini CLI，
//                                             含優化設定）＋ Claude Code 的 Budgethelm MCP ＋ 開機自動啟動（macOS）；可跟 --send 一起用
//                                             --no-autostart：不裝開機自動啟動
//   node agentops-connect.mjs --tick          背景定時跑的那一步（開機自動啟動會呼叫）：接上新出現的工具、看本地模型、上傳近 2 天用量
//   node agentops-connect.mjs --setup         一行安裝指令（install.sh／install.ps1）用：開瀏覽器按一次「授權」（裝置授權碼），然後全部自動：偵測工具、接守護 hook 與 Budgethelm MCP、
//                                             上傳用量、掃 AI 工具設定檔、開機自動執行（macOS／Windows／Linux）。不問任何問題
//   node agentops-connect.mjs --uninstall     移除上面裝的東西（設定檔都先備份），並撤銷這台電腦的匯入金鑰
//   node agentops-connect.mjs --watch         紀錄監看（安裝時自動常駐，macOS／Linux）：讀 Codex 的對話紀錄，一直出錯或空轉就停下那個 Codex（含 codex exec），不用在 /hooks 信任
//   node agentops-connect.mjs --proxy ollama  選配的本機計數代理（只聽 127.0.0.1:11500，--port 可改）：程式的 base URL 改指向它，就記 token 數、擋暴衝；
//                                             也可接 lm-studio、llama-cpp、vllm、jan、gpt4all、localai、openai、anthropic、gemini、openrouter 或網址。金鑰只經過這台電腦
//   node agentops-connect.mjs --pair aopp_…   用 MCP 健檢（start_checkup）給的一次性配對碼換匯入金鑰，存在 ~/.agentops/key（只有你能讀）
//   選項：--days 30（最多 400）、--url https://…（或 AGENTOPS_URL）、--no-folder（agent 名稱不帶資料夾名）、--yes（不再問）、--json
//   雲端主機／CI：排程跑 AGENTOPS_KEY=… node agentops-connect.mjs --send --yes（有裝 hook 會順便更新優化設定）
//   匯入金鑰的來源順序：環境變數 AGENTOPS_KEY → --pair 換到的新金鑰 → ~/.agentops/key → 提示輸入
//
// 隱私：
//   - 環境變數只看「名稱」判斷有哪些服務商，金鑰的值不讀、不印、不送。
//   - 對話紀錄只取時間、模型、token 數；對話內容、檔案路徑不會離開這台電腦（agent 名稱只帶最後一層資料夾名，--no-folder 可拿掉）。
//   - MCP 設定檔只看有沒有 agentops 這個伺服器；只有 --install／--uninstall 會改設定，而且先問、先備份。
//   - 你的模型 API key 留在你的電腦：這個腳本不讀它的值、不送出，Budgethelm 也不提供替你保管 key 的功能。
//     匯入金鑰（aops_）只能上傳計數和下載優化設定，不能呼叫任何模型。
//
// 讀得到用量的工具（格式來源，2026-11-02 查）：
//   Claude Code：~/.claude/projects/**/*.jsonl 的 assistant 訊息 message.usage（本機紀錄實際比對）
//     output_tokens 已經含 thinking：官方說 usage.output_tokens_details.thinking_tokens 是「已計費輸出 token 裡屬於 thinking 的部分」
//     （platform.claude.com/docs/en/build-with-claude/extended-thinking，2026-11-10 查），所以照 output_tokens 計價，不另加 thinking。
//     同一個請求會寫成多行（thinking、文字、工具各一行），各行 usage 相同（本機 7 天 13,956 筆實測，2026-11-10），取第一行即可。
//   Codex CLI：$CODEX_HOME（預設 ~/.codex）/sessions/**/rollout-*.jsonl 的 event_msg/token_count 與 turn_context.model
//     （github.com/openai/codex：codex-rs/history/src/rollout_payload.rs、codex-rs/protocol/src/protocol.rs TokenUsage）
//   Gemini CLI：~/.gemini/tmp/<專案>/chats/session-*.jsonl（舊版 .json）的 type:"gemini" 訊息 tokens{input,output,cached,thoughts}
//     （google-gemini/gemini-cli packages/core/src/services/chatRecordingService.ts，2026-11-06 查；同一個訊息 id 會重複寫入，取最後一次）
//   Antigravity CLI（agy）：~/.gemini/antigravity-cli/conversations/*.db（SQLite＋protobuf，⚠️ 非公開格式，欄位見 antigravityEvents 上方）
//   Cline（VS Code）：globalStorage/saoudrizwan.claude-dev/tasks/<id>/ui_messages.json 的 say:"api_req_started" 裡的 tokensIn/tokensOut/cacheReads/cacheWrites，
//     模型取同資料夾 task_metadata.json 的 model_usage（cline/cline apps/vscode/src/shared/getApiMetrics.ts，2026-11-06 查；只讀數字欄位）
//   Continue：~/.continue/dev_data/devdata.sqlite 的 tokens_generated（model、tokens_prompt、tokens_generated、timestamp）
//     （continuedev/continue core/data/devdataSqlite.ts，2026-11-06 查；要 Node 22.13 以上的內建 node:sqlite，沒有就標「無法讀」）
// 只偵測、不讀用量（誠實標「僅偵測到，無用量」，不估算）：Cursor、Windsurf、GitHub Copilot CLI、Aider、OpenCode
//   （官方沒有公開的本機用量格式，或紀錄散在各專案、token 只到 k 位數）；本地模型 Ollama、LM Studio、llama.cpp 偵測服務與模型，
//   Ollama、LM Studio 不在本機存用量；llama.cpp 有開 --metrics 才有自伺服器啟動以來的累計 token（只顯示在本機，不上傳）。
// cost_usd 不送（記為 unknown），由 Budgethelm 依官方價估算；快取寫入分 5 分鐘／1 小時送（cache_write_5m_tokens／cache_write_1h_tokens），照官方加價算。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_URL = 'https://agentops.agentops.workers.dev';
export const BATCH = 500; // 跟伺服器 MAX_EVENTS 一致
const DAY_MS = 864e5;

// 服務商 → 常見的金鑰環境變數名稱（只比對名稱）
export const PROVIDER_ENV = [
  ['Anthropic', ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']],
  ['OpenAI', ['OPENAI_API_KEY']],
  ['Azure OpenAI', ['AZURE_OPENAI_API_KEY']],
  ['Google Gemini', ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']],
  ['Google Vertex AI', ['GOOGLE_APPLICATION_CREDENTIALS', 'VERTEX_PROJECT']],
  ['AWS Bedrock', ['AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CODE_USE_BEDROCK']],
  ['DeepSeek', ['DEEPSEEK_API_KEY']],
  ['Mistral', ['MISTRAL_API_KEY']],
  ['Groq', ['GROQ_API_KEY']],
  ['xAI', ['XAI_API_KEY']],
  ['OpenRouter', ['OPENROUTER_API_KEY']],
  ['Together AI', ['TOGETHER_API_KEY']],
  ['Cohere', ['COHERE_API_KEY', 'CO_API_KEY']],
  ['Perplexity', ['PERPLEXITY_API_KEY']],
  ['Moonshot', ['MOONSHOT_API_KEY']],
];

// 模型名稱 → 服務商（從用量紀錄推）
export function providerOf(model) {
  const m = String(model).toLowerCase();
  if (m.includes('claude')) return 'Anthropic';
  if (/^(gpt|o\d|codex|chatgpt)/.test(m) || m.startsWith('openai/')) return 'OpenAI';
  if (m.includes('gemini')) return 'Google Gemini';
  if (m.includes('deepseek')) return 'DeepSeek';
  if (/mistral|codestral/.test(m)) return 'Mistral';
  if (m.includes('grok')) return 'xAI';
  return '其他';
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// 找指令的完整路徑：PATH 之外再找常見安裝位置。Claude Code 原生安裝在 ~/.local/bin、有人把 claude 包成 shell function，
// 一行安裝與開機自動啟動跑的時候 PATH 很短（launchd 只有 /usr/bin:/bin），只看 PATH 會找不到。
// system：連 /opt/homebrew/bin、/usr/local/bin 也找（帶自訂 env 測試時預設不找，避免讀到這台電腦真的工具）
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const verDesc = (a, b) => b.localeCompare(a, 'en', { numeric: true });
const subBins = (dir, tail = ['bin']) => { try { return fs.readdirSync(dir).sort(verDesc).map((v) => path.join(dir, v, ...tail)); } catch { return []; } };
export function binDirs({ home = os.homedir(), env = process.env, platform = process.platform, system = env === process.env && env.AGENTOPS_SYSTEM_BINS !== '0' } = {}) {
  const fromPath = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const extra = platform === 'win32'
    ? [path.join(home, '.local', 'bin'), path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'), path.join(local, 'Programs', 'claude'),
      path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'), path.join(local, 'Volta', 'bin'), ...subBins(path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'nvm'), []),
      ...(system ? [path.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs')] : [])]
    : [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'),
      path.join(home, '.volta', 'bin'), path.join(home, '.asdf', 'shims'), path.join(home, '.local', 'share', 'mise', 'shims'), path.join(home, '.fnm', 'aliases', 'default', 'bin'),
      ...subBins(path.join(home, '.nvm', 'versions', 'node')), path.join(home, '.lmstudio', 'bin'),
      ...(system ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/snap/bin'] : [])];
  return [...new Set([...fromPath, ...extra])];
}
export function findBin(names, opts = {}) {
  const win = (opts.platform || process.platform) === 'win32';
  const exts = win ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of binDirs(opts)) for (const n of names) for (const x of exts) { const p = path.join(d, n + x); if (isFile(p)) return p; }
  return null;
}

// MCP 設定檔：只回傳有沒有 agentops，不回傳其他伺服器的設定
function mcpHasAgentops(file, kind) {
  if (!exists(file)) return null;
  if (kind === 'toml') {
    try { return /^\s*\[mcp_servers\.["']?agentops["']?\]/m.test(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  const j = readJson(file);
  if (!j) return null;
  const has = (o) => !!(o?.mcpServers && Object.hasOwn(o.mcpServers, 'agentops'));
  return has(j) || Object.values(j.projects || {}).some(has);
}

// ~/.vscode/extensions 底下某個擴充（資料夾名稱帶版本號）；沒有就回一個不存在的路徑
function vscodeExt(home, prefix) {
  const d = path.join(home, '.vscode', 'extensions');
  try { const n = fs.readdirSync(d).find((x) => x.startsWith(prefix)); if (n) return path.join(d, n); } catch { /* 沒裝 VS Code */ }
  return path.join(d, `${prefix}*`);
}
function vscodeStorage(home, env, ext = 'saoudrizwan.claude-dev') {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', ext);
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', ext);
  return path.join(home, '.config', 'Code', 'User', 'globalStorage', ext);
}

export function agentDefs(home, env) {
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const codex = env.CODEX_HOME || path.join(home, '.codex');
  return [
    { id: 'claude-code', name: 'Claude Code', dirs: [claude], bins: ['claude'], usage: 'claude', logs: path.join(claude, 'projects'),
      mcp: [path.join(home, '.claude.json'), 'json'] },
    { id: 'codex', name: 'Codex CLI', dirs: [codex], bins: ['codex'], usage: 'codex', logs: path.join(codex, 'sessions'),
      mcp: [path.join(codex, 'config.toml'), 'toml'] },
    { id: 'gemini-cli', name: 'Gemini CLI', dirs: [path.join(home, '.gemini')], bins: ['gemini'], usage: 'gemini', logs: path.join(home, '.gemini', 'tmp'),
      mcp: [path.join(home, '.gemini', 'settings.json'), 'json'] },
    { id: 'antigravity', name: 'Antigravity CLI', dirs: [path.join(home, '.gemini', 'antigravity-cli')], bins: ['agy'], usage: 'antigravity', logs: antigravityDir({ home }) },
    { id: 'cursor', name: 'Cursor', dirs: [path.join(home, '.cursor')], bins: ['cursor', 'cursor-agent'], mcp: [path.join(home, '.cursor', 'mcp.json'), 'json'],
      usage: 'cursor-db', logs: cursorDbPath({ home, env }) },
    { id: 'windsurf', name: 'Windsurf', dirs: [path.join(home, '.codeium', 'windsurf')], bins: ['windsurf'], mcp: [path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'json'],
      why: '本機沒有公開的用量紀錄' },
    { id: 'copilot-cli', name: 'GitHub Copilot CLI', dirs: [env.COPILOT_HOME || path.join(home, '.copilot')], bins: ['copilot'], usage: 'copilot',
      logs: path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'session-state') },
    { id: 'cline', name: 'Cline（VS Code）', dirs: [vscodeStorage(home, env)], bins: [], usage: 'cline', logs: path.join(vscodeStorage(home, env), 'tasks') },
    { id: 'continue', name: 'Continue', dirs: [path.join(home, '.continue')], bins: [], usage: 'continue', logs: path.join(home, '.continue', 'dev_data', 'devdata.sqlite') },
    { id: 'aider', name: 'Aider', dirs: [path.join(home, '.aider.conf.yml')], bins: ['aider'], why: '紀錄散在各專案的 .aider.chat.history.md，token 只到 k 位數' },
    { id: 'opencode', name: 'OpenCode', dirs: [path.join(home, '.config', 'opencode'), path.join(home, '.local', 'share', 'opencode')], bins: ['opencode'],
      why: '本機儲存格式還沒查證' },
    { id: 'ollama', name: 'Ollama（本機模型）', dirs: [path.join(home, '.ollama')], bins: ['ollama'], usage: 'ollama-log', local: true,
      logs: ollamaLogPaths({ home, env }).find(exists) || ollamaLogPaths({ home, env })[0] },
    { id: 'lm-studio', name: 'LM Studio（本機模型）', dirs: [path.join(home, '.lmstudio'), path.join(home, '.cache', 'lm-studio')], bins: ['lms'], why: 'LM Studio 不在本機存用量', local: true },
    { id: 'llama-cpp', name: 'llama.cpp（本機模型）', dirs: [], bins: ['llama-server', 'llama-cli'], why: '只有伺服器開 --metrics 時的累計數字', local: true },
    // 2026-11-09 加：只偵測（用量格式沒有官方文件，或要對方另外開功能），見 docs/TOOL_MATRIX.md
    { id: 'amp', name: 'Amp', dirs: [path.join(home, '.config', 'amp')], bins: ['amp'], usage: 'amp', logs: ampThreadsDir({ home, env }) },
    { id: 'goose', name: 'Goose', dirs: [path.join(home, '.config', 'goose'), path.join(home, '.local', 'share', 'goose')], bins: ['goose'], why: '本機 sessions.db 的欄位沒有官方文件' },
    { id: 'kiro', name: 'Kiro', dirs: [path.join(home, '.kiro')], bins: ['kiro', 'kiro-cli'], why: '本機沒有公開的用量紀錄' },
    { id: 'roo', name: 'Roo Code（VS Code）', dirs: [vscodeStorage(home, env, 'rooveterinaryinc.roo-cline')], bins: [], why: '紀錄格式沿用 Cline，還沒實測' },
    // VS Code 的 Copilot agent（Copilot 執行環境）也讀 ~/.copilot/hooks/（code.visualstudio.com/docs/copilot/customization/hooks，2026-11-09 查，Preview）
    { id: 'copilot-vscode', name: 'GitHub Copilot（VS Code）', dirs: [vscodeExt(home, 'github.copilot-chat-')], bins: [], why: 'Copilot（VS Code）沒有本機用量紀錄；擋暴衝共用 Copilot CLI 的 hook' },
    { id: 'junie', name: 'JetBrains Junie CLI', dirs: [path.join(home, '.junie')], bins: ['junie'], why: 'Junie 沒有公開的本機用量紀錄' },
    { id: 'zed', name: 'Zed', dirs: [path.join(home, '.config', 'zed'), path.join(home, 'Library', 'Application Support', 'Zed')], bins: ['zed'], usage: 'zed', logs: zedDbPath({ home, env }) },
    { id: 'jan', name: 'Jan（本機模型）', dirs: [path.join(home, 'Library', 'Application Support', 'Jan'), path.join(home, '.config', 'Jan')], bins: [], why: 'Jan 不在本機存用量；要記錄請用本機計數代理', local: true },
    { id: 'gpt4all', name: 'GPT4All（本機模型）', dirs: [path.join(home, 'Library', 'Application Support', 'nomic.ai', 'GPT4All'), path.join(home, '.local', 'share', 'nomic.ai', 'GPT4All')], bins: [], why: 'GPT4All 不在本機存用量；要記錄請用本機計數代理', local: true },
    { id: 'cursor-team', name: 'Cursor 團隊（官方 Admin API，選配）', dirs: [path.join(agentopsHome({ home, env }), CURSOR_ADMIN_KEY_FILE)], bins: [], usage: 'cursor-admin',
      logs: path.join(agentopsHome({ home, env }), CURSOR_ADMIN_KEY_FILE) },
    { id: 'agentops-estimate', name: 'Budgethelm 估算用量（Cursor、Copilot VS Code、Kiro、Junie、Goose 的 hook）', dirs: [path.join(agentopsHome({ home, env }), 'hooks', ESTIMATE_FILE)], bins: [], usage: 'estimate',
      logs: path.join(agentopsHome({ home, env }), 'hooks', ESTIMATE_FILE) },
    { id: 'agentops-proxy', name: 'Budgethelm 本機計數代理', dirs: [path.join(agentopsHome({ home, env }), PROXY_FILE)], bins: [], usage: 'proxy', logs: path.join(agentopsHome({ home, env }), PROXY_FILE) },
  ];
}

export function detect({ home = os.homedir(), env = process.env, system = env === process.env && env.AGENTOPS_SYSTEM_BINS !== '0' } = {}) {
  const agents = [];
  for (const a of agentDefs(home, env)) {
    const viaDir = a.dirs.some(exists);
    const viaBin = a.bins.length > 0 && !!findBin(a.bins, { home, env, system });
    if (!viaDir && !viaBin) continue;
    agents.push({ id: a.id, name: a.name, usage: a.usage && exists(a.logs) ? a.usage : null, logs: a.usage ? a.logs : null,
      agentops_mcp: a.mcp ? mcpHasAgentops(...a.mcp) : null, why: a.usage ? (exists(a.logs) ? null : '還沒有用量紀錄') : a.why || null });
  }
  const providers = PROVIDER_ENV.map(([name, vars]) => ({ name, env: vars.filter((v) => env[v] != null && env[v] !== '') }))
    .filter((p) => p.env.length);
  return { agents, providers };
}

// ---------- 計費身分（API／訂閱／混合）：只讀下面列的欄位，只輸出分類，不輸出 email、姓名、組織、uuid、token ----------
// 規格與官方出處見 docs/BILLING.md
const TIER = /^[a-z0-9_]{1,32}$/;
const tierOf = (...v) => { for (const x of v) { const t = typeof x === 'string' ? x.replace(/^default_/, '') : ''; if (TIER.test(t)) return t; } return null; };

function newestRollout(dir) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const names = list.filter((f) => f.isDirectory()).map((f) => f.name).sort().reverse();
  const file = list.filter((f) => f.isFile() && f.name.startsWith('rollout-') && f.name.endsWith('.jsonl')).map((f) => f.name).sort().reverse()[0];
  if (file) return path.join(dir, file);
  for (const n of names) { const r = newestRollout(path.join(dir, n)); if (r) return r; }
  return null;
}

// 只讀最新 session 檔的最後 512KB，取最後一筆 payload.rate_limits 的 plan_type 與 credits 有沒有餘額
function lastRateLimits(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, n = Math.min(size, 512 * 1024), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    const ls = buf.toString('utf8').split('\n');
    for (let i = ls.length - 1; i >= 0; i--) {
      if (!ls[i].includes('"rate_limits"')) continue;
      try { const r = JSON.parse(ls[i]).payload?.rate_limits; if (r && typeof r === 'object') return { tier: tierOf(r.plan_type), credits: r.credits?.has_credits === true || r.credits?.unlimited === true }; } catch { /* 第一行可能被截斷 */ }
    }
  } catch { /* 讀不到就當沒有 */ } finally { if (fd != null) fs.closeSync(fd); }
  return null;
}

export function billingMode({ home = os.homedir(), env = process.env } = {}) {
  const out = [];
  const claudeFile = path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json');
  const cj = fs.existsSync(claudeFile) ? readJson(claudeFile) : undefined;
  const key = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY !== '';
  if (cj !== undefined || key) {
    const o = cj?.oauthAccount;
    const sub = !!o && (/subscription/.test(o.billingType) || /^claude_(max|pro|ultra)/.test(o.organizationType));
    if (key) out.push({ tool: 'claude-code', billing: 'api', tier: null, source: o ? 'env+claude.json' : 'env' }); // 官方：有 ANTHROPIC_API_KEY 就用金鑰，不用訂閱額度
    else if (sub) out.push({ tool: 'claude-code', billing: o.hasExtraUsageEnabled === true ? 'hybrid' : 'subscription', tier: tierOf(o.organizationRateLimitTier, o.organizationType), source: 'claude.json' });
    else out.push({ tool: 'claude-code', billing: 'unknown', tier: null, source: cj ? 'claude.json' : 'claude.json（讀不到）' });
  }
  const codex = env.CODEX_HOME || path.join(home, '.codex');
  const authFile = path.join(codex, 'auth.json');
  if (fs.existsSync(authFile)) {
    const a = readJson(authFile);
    const mode = typeof a?.auth_mode === 'string' ? a.auth_mode : null;
    if (!a) out.push({ tool: 'codex', billing: 'unknown', tier: null, source: 'auth.json（讀不到）' });
    else if (mode === 'apikey' || mode === 'api_key' || (!mode && typeof a.OPENAI_API_KEY === 'string' && a.OPENAI_API_KEY)) out.push({ tool: 'codex', billing: 'api', tier: null, source: 'auth.json' });
    else if (mode && /^chatgpt/.test(mode)) {
      const f = newestRollout(path.join(codex, 'sessions'));
      const r = f && lastRateLimits(f);
      out.push({ tool: 'codex', billing: r?.credits ? 'hybrid' : 'subscription', tier: r?.tier ?? null, source: r ? 'auth.json+session' : 'auth.json' });
    } else out.push({ tool: 'codex', billing: 'unknown', tier: null, source: 'auth.json' });
  }
  return out;
}

export const billingLine = (modes) => modes.length ? `計費身分：${modes.map((m) => `${m.tool === 'codex' ? 'Codex CLI' : 'Claude Code'} ${{ api: 'API', subscription: '訂閱', hybrid: '混合', unknown: '無法判斷' }[m.billing]}${m.tier ? `（${m.tier}）` : ''}`).join('、')}（只在本機判斷，不上傳）` : '';

function jsonlFiles(dir, since, test = () => true, out = []) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const f of list) {
    const x = path.join(dir, f.name);
    if (f.isDirectory()) jsonlFiles(x, since, test, out);
    else if (f.name.endsWith('.jsonl') && test(f.name)) { try { if (fs.statSync(x).mtimeMs >= since) out.push(x); } catch { /* 讀不到就跳過 */ } }
  }
  return out;
}

async function* lines(file) {
  for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) yield line;
}

const label = (tool, cwd, { folder = true, sub = false } = {}) =>
  `${tool}${folder && cwd ? ` · ${path.basename(String(cwd))}` : ''}${sub ? '（子代理）' : ''}`.slice(0, 80);

// Claude Code：同一個 requestId 只算一次；<synthetic> 是本機產生的訊息，不是 API 呼叫
export async function claudeEvents(dir, { since, folder = true } = {}) {
  const seen = new Set();
  const out = [];
  for (const f of jsonlFiles(dir, since)) {
    for await (const line of lines(f)) {
      if (!line.includes('"usage"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const m = o.message;
      if (o.type !== 'assistant' || !m?.usage || !m.model || m.model.startsWith('<')) continue;
      const id = o.requestId || m.id;
      const ts = Date.parse(o.timestamp);
      if (!id || seen.has(id) || !(ts >= since)) continue;
      seen.add(id);
      const u = m.usage;
      const read = u.cache_read_input_tokens || 0;
      const wAll = u.cache_creation_input_tokens || 0;
      // 舊版紀錄沒有 cache_creation 明細：全部當 5 分鐘（API 預設）
      const w1h = Math.min(u.cache_creation?.ephemeral_1h_input_tokens || 0, wAll);
      out.push({
        ts: new Date(ts).toISOString(), agent: label('Claude Code', o.cwd, { folder, sub: !!o.isSidechain }), model: m.model,
        input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + read, output_tokens: u.output_tokens || 0,
        cache_read_tokens: read, cache_write_5m_tokens: wAll - w1h, cache_write_1h_tokens: w1h,
        cost_usd: null, status: o.isApiErrorMessage ? 'error' : 'ok', external_id: `cc-${id}`.slice(0, 128),
      });
    }
  }
  return out;
}

// Codex CLI：token_count 事件會重複送同一份累計值，累計 total_tokens 沒變就跳過；
// OpenAI 的 input_tokens 已含 cached_input_tokens，reasoning 已含在 output_tokens
export async function codexEvents(dir, { since, folder = true } = {}) {
  const out = [];
  for (const f of jsonlFiles(dir, since, (n) => n.startsWith('rollout-'))) {
    const sid = path.basename(f, '.jsonl').replace(/^rollout-/, '');
    let model = null; let cwd = null; let lastTotal = null;
    for await (const line of lines(f)) {
      if (!line.includes('"turn_context"') && !line.includes('"token_count"') && !line.includes('"session_meta"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const p = o.payload || {};
      if (o.type === 'session_meta' || o.type === 'turn_context') { model = p.model || model; cwd = p.cwd || cwd; continue; }
      if (o.type !== 'event_msg' || p.type !== 'token_count' || !p.info?.last_token_usage) continue;
      const total = p.info.total_token_usage?.total_tokens;
      if (total != null && total === lastTotal) continue;
      lastTotal = total;
      const ts = Date.parse(o.timestamp);
      if (!(ts >= since) || !model) continue;
      const u = p.info.last_token_usage;
      const input = Math.max(0, u.input_tokens || 0);
      out.push({
        ts: new Date(ts).toISOString(), agent: label('Codex CLI', cwd, { folder }), model,
        input_tokens: input, output_tokens: Math.max(0, u.output_tokens || 0), cache_read_tokens: Math.min(Math.max(0, u.cached_input_tokens || 0), input),
        cost_usd: null, status: 'ok', external_id: `cx-${sid}-${total ?? out.length}`.slice(0, 128),
      });
    }
  }
  return out;
}

// Gemini CLI：同一個訊息會隨著串流重複寫入，取同一 id 最後有 tokens 的那筆；input 已含 cached，thoughts 算輸出
export async function geminiEvents(dir, { since, folder = true } = {}) {
  const files = [];
  const walk = (d, depth = 0) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const f of list) {
      const x = path.join(d, f.name);
      if (f.isDirectory() && depth < 4) walk(x, depth + 1);
      else if (/^session-.*\.jsonl?$/.test(f.name) && path.basename(d) !== 'tmp') { try { if (fs.statSync(x).mtimeMs >= since) files.push(x); } catch {} }
    }
  };
  walk(dir);
  const out = [];
  for (const f of files) {
    const msgs = new Map();
    let sid = path.basename(f).replace(/\.jsonl?$/, '');
    const take = (o) => {
      if (o?.sessionId) sid = String(o.sessionId).slice(0, 60);
      if (o?.type === 'gemini' && o.id && o.tokens && o.model) msgs.set(o.id, o);
    };
    if (f.endsWith('.jsonl')) { for await (const line of lines(f)) { if (!line.includes('"tokens"') && !line.includes('"sessionId"')) continue; try { take(JSON.parse(line)); } catch {} } }
    else { const j = readJson(f); if (j) { take(j); for (const m of j.messages || []) take(m); } }
    for (const [id, m] of msgs) {
      const ts = Date.parse(m.timestamp);
      if (!(ts >= since)) continue;
      const t = m.tokens, input = Math.max(0, (t.input || 0) + (t.tool || 0));
      out.push({ ts: new Date(ts).toISOString(), agent: label('Gemini CLI', null, { folder }), model: String(m.model).slice(0, 100),
        input_tokens: input, output_tokens: Math.max(0, (t.output || 0) + (t.thoughts || 0)), cache_read_tokens: Math.min(Math.max(0, t.cached || 0), input),
        cost_usd: null, status: 'ok', external_id: `gm-${sid}-${id}`.slice(0, 128) });
    }
  }
  return out;
}

// Cline：每個 api_req_started 是一次 API 呼叫；text 是 JSON 字串（裡面也有請求內容，只取數字欄位，內容不碰）
export async function clineEvents(dir, { since, folder = true } = {}) {
  let tasks; try { tasks = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  const out = [];
  for (const t of tasks) {
    const f = path.join(dir, t.name, 'ui_messages.json');
    try { if (fs.statSync(f).mtimeMs < since) continue; } catch { continue; }
    const msgs = readJson(f);
    if (!Array.isArray(msgs)) continue;
    const usage = (readJson(path.join(dir, t.name, 'task_metadata.json'))?.model_usage || []).filter((u) => u?.model_id && Number.isFinite(u.ts)).sort((a, b) => a.ts - b.ts);
    const modelAt = (ts) => { let m = null; for (const u of usage) if (u.ts <= ts) m = u.model_id; return m || usage[0]?.model_id || null; };
    for (const m of msgs) {
      if (m?.type !== 'say' || m.say !== 'api_req_started' || typeof m.text !== 'string' || !(m.ts >= since)) continue;
      let d; try { d = JSON.parse(m.text); } catch { continue; }
      if (typeof d.tokensIn !== 'number' || typeof d.tokensOut !== 'number') continue;
      const model = modelAt(m.ts);
      if (!model) continue;
      const read = Math.max(0, d.cacheReads || 0);
      out.push({ ts: new Date(m.ts).toISOString(), agent: label('Cline', null, { folder }), model: String(model).slice(0, 100),
        input_tokens: Math.max(0, d.tokensIn) + Math.max(0, d.cacheWrites || 0) + read, output_tokens: Math.max(0, d.tokensOut), cache_read_tokens: read,
        cache_write_5m_tokens: Math.max(0, d.cacheWrites || 0), // Cline 用 Anthropic 預設的 5 分鐘快取
        cost_usd: null, status: d.cancelReason || d.streamingFailedMessage ? 'error' : 'ok', external_id: `cl-${t.name}-${m.ts}`.slice(0, 128) });
    }
  }
  return out;
}

// Continue：devdata.sqlite 的 tokens_generated（timestamp 是 SQLite CURRENT_TIMESTAMP，UTC）；Node 太舊沒有 node:sqlite 就丟錯讓呼叫端標「無法讀」
export async function continueEvents(file, { since, folder = true } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id, model, tokens_prompt, tokens_generated, timestamp FROM tokens_generated WHERE timestamp >= ?')
      .all(new Date(since).toISOString().replace('T', ' ').slice(0, 19));
    return rows.map((r) => ({ ts: new Date(`${String(r.timestamp).replace(' ', 'T')}Z`).toISOString(), agent: label('Continue', null, { folder }),
      model: String(r.model).slice(0, 100), input_tokens: Math.max(0, Number(r.tokens_prompt) || 0), output_tokens: Math.max(0, Number(r.tokens_generated) || 0),
      cache_read_tokens: 0, cost_usd: null, status: 'ok', external_id: `ct-${r.id}` }));
  } finally { db.close(); }
}

// GitHub Copilot CLI：$COPILOT_HOME/session-state/<session>/events.jsonl 的 session.usage_record（每次呼叫模型一筆：model、inputTokens、outputTokens、
// cacheReadTokens），session.start 有 cwd。官方文件沒寫這個格式，copilot 1.0.107 實跑比對（2026-11-09）；inputTokens 當成含快取的總輸入（⚠️ 推論）
export async function copilotEvents(dir, { since, folder = true } = {}) {
  const out = [];
  for (const f of jsonlFiles(dir, since, (n) => n === 'events.jsonl')) {
    let cwd = null;
    for await (const line of lines(f)) {
      if (!line.includes('"session.usage_record"') && !line.includes('"session.start"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'session.start') { cwd = o.data?.context?.cwd || cwd; continue; }
      const u = o.data?.usage;
      const ts = Date.parse(o.timestamp);
      if (!u || !(ts >= since)) continue;
      const input = num(u.inputTokens);
      out.push({ ts: new Date(ts).toISOString(), agent: label('GitHub Copilot CLI', cwd, { folder }), model: modelName(u.model) || 'unknown',
        input_tokens: input, output_tokens: num(u.outputTokens), cache_read_tokens: Math.min(num(u.cacheReadTokens), input), cost_usd: null, status: 'ok',
        external_id: `cp-${String(u.accounting?.sourceSessionId || '').slice(0, 40)}-${String(u.accounting?.usageId || o.id || out.length).slice(0, 60)}`.slice(0, 128) });
    }
  }
  return out;
}

// Ollama 不改 base URL 也記得到：讀 Ollama 自己的伺服器紀錄（官方 troubleshooting 頁：macOS ~/.ollama/logs/server.log、Windows %LOCALAPPDATA%\Ollama\server.log＋server-#.log；
// Homebrew 背景服務寫 $(brew --prefix)/var/log/ollama.log）。每次呼叫 llama.cpp 會印
//   「task.n_tokens = N」（整段提示）「cached n_tokens = C」「prompt eval time = … / P tokens」「eval time = … / M tokens」，接著一行 [GIN] 時間、狀態碼、路徑。
// 這些行不是 Ollama 公開保證的格式（ollama 0.40.15＋llama-server 實測，2026-11-09）：認不得就讀不到，不會記錯；模型名稱取最近一次載入的模型（同時載入多個模型時可能標錯 ⚠️）
export const ollamaLogPaths = ({ home = os.homedir(), env = process.env, platform = process.platform } = {}) => [
  path.join(home, '.ollama', 'logs', 'server.log'),
  ...(platform === 'win32' ? [path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Ollama', 'server.log')] : []),
  '/opt/homebrew/var/log/ollama.log', '/usr/local/var/log/ollama.log',
];
const GIN = /^\[GIN\] (\d{4})\/(\d\d)\/(\d\d) - (\d\d):(\d\d):(\d\d) \|\s*(\d{3}) \|[^|]*\|[^|]*\|\s*POST\s+"(\/api\/(chat|generate)|\/v1\/(chat\/completions|completions|responses|messages))"/;
export async function ollamaLogEvents(file, { since, folder = true } = {}) {
  const out = [];
  const files = path.basename(file) === 'server.log'
    ? [...(() => { try { return fs.readdirSync(path.dirname(file)).filter((n) => /^server-\d+\.log$/.test(n)).map((n) => path.join(path.dirname(file), n)); } catch { return []; } })(), file]
    : [file];
  for (const f of files) {
    if (!exists(f) || fs.statSync(f).mtimeMs < since) continue;
    let model = null, p = {};
    for await (const line of lines(f)) {
      let m;
      if ((m = line.match(/msg="template selection" model=(\S+)/))) { model = m[1].replace(/^registry\.ollama\.ai\/library\//, '').replace(/^registry\.ollama\.ai\//, ''); continue; }
      if ((m = line.match(/\| task (\d+) \| new prompt.*task\.n_tokens = (\d+)/))) { p = { task: m[1], total: Number(m[2]) }; continue; }
      if ((m = line.match(/\| task (\d+) \| cached n_tokens = (\d+)/)) && m[1] === p.task) { p.cached = Number(m[2]); continue; }
      if ((m = line.match(/\| task (\d+) \| prompt eval time = .*\/\s*(\d+) tokens/))) { if (m[1] !== p.task) p = { task: m[1] }; p.prompt = Number(m[2]); continue; }
      if ((m = line.match(/\| task (\d+) \|\s+eval time = .*\/\s*(\d+) tokens/))) { if (m[1] === p.task) p.out = Number(m[2]); continue; }
      if (!(m = line.match(GIN)) || p.out == null) continue;
      const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); // GIN 用本機時間、沒有時區
      const input = p.total ?? (p.prompt || 0) + (p.cached || 0);
      if (ts >= since) out.push({ ts: new Date(ts).toISOString(), agent: 'Ollama（本機模型）', model: modelName(model) || 'unknown',
        input_tokens: input, output_tokens: p.out, cache_read_tokens: Math.min(p.cached || 0, input), cost_usd: null, status: Number(m[7]) < 400 ? 'ok' : 'error',
        external_id: `ol-${createHash('sha256').update(`${path.basename(f)}|${m.slice(1, 7).join('')}|${p.task}|${input}|${p.out}`).digest('hex').slice(0, 32)}` });
      p = {};
    }
  }
  return out;
}

const READERS = { copilot: copilotEvents, 'ollama-log': ollamaLogEvents, claude: claudeEvents, codex: codexEvents, gemini: geminiEvents, cline: clineEvents, continue: continueEvents, proxy: (...a) => proxyEvents(...a), 'cursor-db': cursorDbEvents, 'cursor-admin': cursorAdminEvents, zed: zedEvents, amp: ampEvents, antigravity: antigravityEvents,
  estimate: (f, o) => estimateEvents(f, { ...o, copilotState: path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'session-state') }) };

export async function collect(report, { days = 30, folder = true, nowMs = Date.now() } = {}) {
  const since = nowMs - Math.min(Math.max(days, 1), 400) * DAY_MS;
  const events = [];
  for (const a of report.agents) {
    if (!a.usage) continue;
    let ev;
    try { ev = (await READERS[a.usage](a.logs, { since, folder })).filter((e) => Date.parse(e.ts) <= nowMs); }
    catch (e) { a.events = 0; a.why = `讀不到用量（${String(e.message).slice(0, 60)}）`; continue; }
    a.events = ev.length;
    events.push(...ev);
  }
  events.sort((x, y) => x.ts.localeCompare(y.ts));
  return events;
}

export function summarize(report, events) {
  const by = (k) => [...events.reduce((m, e) => m.set(e[k], (m.get(e[k]) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const models = by('model');
  const fromModels = [...new Set(models.map(([m]) => providerOf(m)))];
  return {
    tools: report.agents.map((a) => ({ id: a.id, name: a.name, events: a.usage && !a.why ? a.events ?? 0 : null,
      usage: a.usage && !a.why ? `${a.events ?? 0} 筆` : `僅偵測到，無用量${a.why ? `（${a.why}）` : ''}`, agentops_mcp: a.agentops_mcp })),
    agents: by('agent'), models,
    providers: [...new Set([...fromModels, ...report.providers.map((p) => p.name)])],
    provider_env: report.providers,
    events: events.length,
    tokens: events.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0),
  };
}

// 送出：每批最多 500 筆；429 照 retry-after 等（最多 60 秒）再送同一批
export async function send(events, { url, key, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onBatch = () => {} }) {
  let accepted = 0; let duplicates = 0;
  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH);
    for (let tries = 0; ; tries++) {
      const r = await fetchFn(`${url}/api/ingest/usage`, { method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: batch }) });
      const body = await r.json().catch(() => ({}));
      if (r.status === 429 && tries < 3) { await sleep(Math.min(Number(r.headers.get('retry-after')) || 60, 60) * 1000); continue; }
      if (!r.ok) throw new Error(`第 ${i / BATCH + 1} 批失敗（HTTP ${r.status}）：${body.error || '未知錯誤'}`);
      accepted += body.accepted || 0; duplicates += body.duplicates || 0;
      onBatch(Math.min(i + BATCH, events.length), events.length);
      break;
    }
  }
  return { accepted, duplicates };
}

// ---------- 安裝到 Claude Code（hook ＋ 優化設定 ＋ MCP） ----------
// 跟 agentops-guard.mjs 的 EVENTS 一致（測試會比對）；兩個檔案都要能單獨下載使用，所以各存一份
export const HOOK_EVENTS = [['SessionStart', 'startup|clear'], ['UserPromptSubmit', null], ['PostToolUseFailure', '*'], ['PostToolUse', '*']];
const HOOK_FILE = 'agentops-guard.mjs', PROFILE_FILE = 'agentops-profile.json';
const BREAKER_FILES = ['agentops-breaker.log', 'agentops-breaker.seen', 'agentops-baseline.json', 'agentops-allow.json']; // hook 的熔斷紀錄（只有時間、原因、次數）
// 我們的 hook：Claude Code／Codex／Gemini 是 { hooks: [{ command }] }，Cursor 是 { command }，Copilot CLI 是 { bash, powershell }
const ours = (entry) => String(entry?.command || entry?.bash || '').includes(HOOK_FILE) || (entry?.hooks || []).some((h) => String(h?.command || '').includes(HOOK_FILE));
export const claudeDir = ({ home = os.homedir(), env = process.env } = {}) => env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');

// 純函式：把我們的 hook 合併進 settings（先拿掉舊的，重跑不會重複），其他設定原樣保留
export function mergeHookSettings(settings, command) {
  const out = removeHookSettings(settings);
  out.hooks = { ...(out.hooks || {}) };
  for (const [ev, matcher] of HOOK_EVENTS) {
    out.hooks[ev] = [...(out.hooks[ev] || []), { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 5 }] }];
  }
  return out;
}

export function removeHookSettings(settings) {
  const out = { ...(settings || {}) };
  if (!out.hooks || typeof out.hooks !== 'object') return out;
  const hooks = {};
  for (const [ev, list] of Object.entries(out.hooks)) {
    const keep = Array.isArray(list) ? list.filter((e) => !ours(e)) : list;
    if (!Array.isArray(keep) || keep.length) hooks[ev] = keep;
  }
  if (Object.keys(hooks).length) out.hooks = hooks; else delete out.hooks;
  return out;
}

// settings.json 壞掉就停，不覆蓋；改之前先備份
function readSettings(file) {
  if (!exists(file)) return {};
  const j = readJson(file);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`${file} 不是正確的 JSON，沒有修改。修好後再跑一次。`);
  return j;
}
function backup(file, nowMs) {
  if (!exists(file)) return null;
  const b = `${file}.agentops-backup-${new Date(nowMs).toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, b);
  return b;
}

export function installHook({ dir = claudeDir(), source, profile = null, nowMs = Date.now(), node = 'node' }) {
  if (!isGuardSource(source)) throw new Error('下載到的 hook 內容不對，沒有安裝');
  const hookDir = path.join(dir, 'hooks');
  const hookPath = path.join(hookDir, HOOK_FILE);
  const settingsPath = path.join(dir, 'settings.json');
  const settings = readSettings(settingsPath);
  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(hookPath, source);
  if (profile) writeProfile(dir, profile);
  const saved = backup(settingsPath, nowMs);
  fs.writeFileSync(settingsPath, JSON.stringify(mergeHookSettings(settings, `${node === 'node' ? 'node' : `"${node}"`} "${hookPath}"`), null, 2) + '\n');
  return { hookPath, settingsPath, backup: saved, profile: !!profile };
}

export function uninstallHook({ dir = claudeDir(), nowMs = Date.now() } = {}) {
  const settingsPath = path.join(dir, 'settings.json');
  const settings = readSettings(settingsPath);
  const had = Object.values(settings.hooks || {}).some((l) => Array.isArray(l) && l.some(ours));
  const saved = had ? backup(settingsPath, nowMs) : null;
  if (had) fs.writeFileSync(settingsPath, JSON.stringify(removeHookSettings(settings), null, 2) + '\n');
  const removed = [HOOK_FILE, PROFILE_FILE, ...BREAKER_FILES].map((f) => path.join(dir, 'hooks', f)).filter((f) => { if (!exists(f)) return false; fs.rmSync(f); return true; });
  return { settingsPath, backup: saved, settingsChanged: had, removed };
}

// ---------- 其他 AI 工具的守護 hook（Codex CLI、Cursor、Gemini CLI） ----------
// 設定檔位置與格式依官方文件（2026-11-05 查）：
//   Codex：$CODEX_HOME（預設 ~/.codex）/hooks.json，hooks → 事件 → [{ hooks: [{ type:"command", command, timeout(秒) }] }]；要在 Codex 的 /hooks 信任一次才會跑
//   Cursor：~/.cursor/hooks.json，{ version: 1, hooks → 事件 → [{ command, timeout(秒) }] }
//   Gemini CLI：~/.gemini/settings.json 的 hooks，結構同 Codex，timeout 是毫秒、多一個 name
// 不寫 matcher＝所有工具都經過（⚠️ 依 Claude Code 的慣例推論，各家文件沒明寫）。指令用 node 的完整路徑：Cursor 從 Dock 開時 PATH 可能沒有 node。
// 跟 agentops-guard.mjs 的 TOOL_EVENTS 一致（測試會比對）
export const TOOL_EVENTS = {
  codex: ['PostToolUse', 'PreToolUse', 'UserPromptSubmit'],
  cursor: ['postToolUse', 'postToolUseFailure', 'beforeSubmitPrompt', 'sessionStart', 'preToolUse'],
  gemini: ['AfterTool', 'BeforeAgent'],
  copilot: ['postToolUse', 'postToolUseFailure', 'preToolUse', 'userPromptSubmitted'],
  cline: ['PostToolUse', 'PreToolUse', 'UserPromptSubmit'],
  kiro: ['PostToolUse', 'PreToolUse', 'UserPromptSubmit'],
  junie: ['PostToolUse', 'PreToolUse', 'UserPromptSubmit'],
  goose: ['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'UserPromptSubmit'],
};
// 2026-11-09 加（格式見 agentops-guard.mjs 開頭）：
//   Copilot CLI：$COPILOT_HOME（預設 ~/.copilot）/hooks/*.json 都會讀，我們用自己的 agentops.json（{ version:1, hooks → 事件 → [{ type, bash, powershell, timeoutSec }] }）
//   Kiro CLI V3：~/.kiro/hooks/*.json（{ version:"v1", hooks:[{ name, trigger, action:{ type:"command", command, timeout } }] }），一樣用自己的 agentops.json
//   Cline：~/Documents/Cline/Hooks/<事件名>（macOS／Linux 要可執行；Windows 是 <事件名>.ps1），每個事件一個腳本；使用者已有同名腳本就不蓋，回報跳過
export const TOOL_HOOKS = {
  codex: { id: 'codex', name: 'Codex CLI', file: ({ home, env }) => path.join(env.CODEX_HOME || path.join(home, '.codex'), 'hooks.json'),
    entry: (command) => ({ hooks: [{ type: 'command', command, timeout: 5 }] }) },
  cursor: { id: 'cursor', name: 'Cursor', file: ({ home }) => path.join(home, '.cursor', 'hooks.json'),
    entry: (command) => ({ command, timeout: 5 }) },
  gemini: { id: 'gemini-cli', name: 'Gemini CLI', file: ({ home }) => path.join(home, '.gemini', 'settings.json'),
    entry: (command) => ({ hooks: [{ name: 'agentops-guard', type: 'command', command, timeout: 5000 }] }) },
  copilot: { id: 'copilot-cli', ids: ['copilot-cli', 'copilot-vscode'], name: 'GitHub Copilot CLI／VS Code', file: ({ home, env }) => path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'hooks', 'agentops.json'),
    entry: (command) => ({ type: 'command', bash: command, powershell: `& ${command.replace(/^"([^"]+)"/, "'$1'").replace(/"/g, "'")}`, timeoutSec: 5 }), own: true, event: true }, // Copilot 的輸入沒有事件名稱，用 --event 帶
  kiro: { id: 'kiro', name: 'Kiro CLI', file: ({ home }) => path.join(home, '.kiro', 'hooks', 'agentops.json'), own: true,
    build: (command) => ({ version: 'v1', hooks: TOOL_EVENTS.kiro.map((t) => ({ name: `agentops-guard ${t}`, trigger: t, action: { type: 'command', command: `${command} --event ${t}`, timeout: 5 } })) }) },
  // JetBrains Junie CLI（junie.jetbrains.com/docs/junie-cli-hooks.html，2026-11-09 查，Early Access）：~/.junie/config.json 的 hooks，結構同 Claude Code
  junie: { id: 'junie', name: 'JetBrains Junie CLI', file: ({ home }) => path.join(home, '.junie', 'config.json'),
    entry: (command) => ({ hooks: [{ type: 'command', command, timeout: 5 }] }) },
  // Goose（goose-docs.ai/docs/guides/context-engineering/hooks，2026-11-09 查）：使用者外掛 ~/.agents/plugins/<名稱>/hooks/hooks.json，結構同 Claude Code；
  // 輸入的事件名稱欄位叫 event；PreToolUse 回 {"decision":"block"} 擋工具。外掛資料夾放一份 plugin.json（範例都有，官方沒說一定要）
  goose: { id: 'goose', name: 'Goose', file: ({ home }) => path.join(home, '.agents', 'plugins', 'agentops', 'hooks', 'hooks.json'), own: true,
    build: (command) => ({ hooks: Object.fromEntries(TOOL_EVENTS.goose.map((ev) => [ev, [{ hooks: [{ type: 'command', command: `${command} --event ${ev}`, timeout: 5 }] }]])) }),
    extra: (file) => [[path.join(path.dirname(path.dirname(file)), 'plugin.json'), { name: 'agentops', description: 'Budgethelm 擋暴衝（解除安裝會刪掉）' }]] },
  cline: { id: 'cline', name: 'Cline', dir: ({ home }) => path.join(home, 'Documents', 'Cline', 'Hooks'), file: ({ home }) => path.join(home, 'Documents', 'Cline', 'Hooks') },
};
const CLINE_MARK = 'AgentOps 守護 hook（Cline）'; // 舊品牌名：已裝的客戶靠這行認出我們的腳本，改名後不改
export const clineScript = (command, platform = process.platform) => platform === 'win32'
  // PowerShell 把字串用管線交給外部程式時會轉碼、輸出也會被拆成物件：輸入先寫暫存檔（環境變數有 32K 上限）用 --input-file 交給 node，結果原樣寫回 stdout
  ? `# ${CLINE_MARK}；解除安裝會刪掉\r\n$f = [IO.Path]::GetTempFileName()\r\n[IO.File]::WriteAllText($f, [Console]::In.ReadToEnd())\r\n`
    + `$out = & ${command.replace(/^"([^"]+)"/, "'$1'").replace(/"/g, "'")} --input-file $f 2>$null\r\nRemove-Item $f -ErrorAction SilentlyContinue\r\n[Console]::Out.Write(($out -join "\`n"))\r\nexit 0\r\n`
  : `#!/bin/sh\n# ${CLINE_MARK}；解除安裝會刪掉\nexec ${command}\n`;
const clineFile = (dir, ev, platform) => path.join(dir, platform === 'win32' ? `${ev}.ps1` : ev);
function installClineHooks({ home, command, platform }) {
  const dir = TOOL_HOOKS.cline.dir({ home });
  fs.mkdirSync(dir, { recursive: true });
  const skipped = [];
  for (const ev of TOOL_EVENTS.cline) {
    const f = clineFile(dir, ev, platform);
    if (exists(f) && !fs.readFileSync(f, 'utf8').includes(CLINE_MARK)) { skipped.push(ev); continue; } // 使用者自己的腳本不蓋
    // Windows PowerShell 5.1 沒有 BOM 會用系統碼頁讀，中文註解（和中文使用者名稱的路徑）會壞掉
    fs.writeFileSync(f, (platform === 'win32' ? '\ufeff' : '') + clineScript(command, platform), { mode: 0o755 });
    if (platform !== 'win32') fs.chmodSync(f, 0o755);
  }
  return skipped;
}
function uninstallClineHooks({ home }) {
  const dir = TOOL_HOOKS.cline.dir({ home });
  const removed = [];
  for (const ev of TOOL_EVENTS.cline) for (const f of [path.join(dir, ev), path.join(dir, `${ev}.ps1`)]) {
    try { if (fs.readFileSync(f, 'utf8').includes(CLINE_MARK)) { fs.rmSync(f); removed.push(f); } } catch { /* 沒有這個檔 */ }
  }
  return removed;
}
export function mergeToolHooks(tool, settings, command) {
  if (TOOL_HOOKS[tool].build) return TOOL_HOOKS[tool].build(command);
  const out = removeHookSettings(settings);
  out.hooks = { ...(out.hooks || {}) };
  for (const ev of TOOL_EVENTS[tool]) out.hooks[ev] = [...(out.hooks[ev] || []), TOOL_HOOKS[tool].entry(TOOL_HOOKS[tool].event ? `${command} --event ${ev}` : command)];
  if ((tool === 'cursor' || tool === 'copilot') && !out.version) out.version = 1;
  return out;
}
const hasOurs = (settings) => Object.values(settings?.hooks || {}).some((l) => Array.isArray(l) && l.some(ours))
  || (Array.isArray(settings?.hooks) && settings.hooks.some((h) => String(h?.action?.command || '').includes(HOOK_FILE)));
// 偵測到、而且能接熔斷的工具（Claude Code 另外處理）
export const hookableTools = (report) => Object.keys(TOOL_HOOKS).filter((t) => report.agents.some((a) => (TOOL_HOOKS[t].ids || [TOOL_HOOKS[t].id]).includes(a.id)));
export const toolHooked = (tool, { home = os.homedir(), env = process.env, platform = process.platform } = {}) => {
  if (tool === 'cline') { try { return fs.readFileSync(clineFile(TOOL_HOOKS.cline.dir({ home }), 'PostToolUse', platform), 'utf8').includes(CLINE_MARK); } catch { return false; } }
  try { return hasOurs(readSettings(TOOL_HOOKS[tool].file({ home, env }))); } catch { return false; }
};
export const sharedHookDir = (opts) => path.join(agentopsHome(opts), 'hooks');

// hook 本體放一份在 ~/.agentops/hooks（優化設定、熔斷紀錄也在這），再把各工具的設定指過來；設定檔壞掉的那個工具跳過，其他照裝
export function installToolHooks({ tools, source, home = os.homedir(), env = process.env, node = process.execPath, nowMs = Date.now(), platform = process.platform }) {
  if (!isGuardSource(source)) throw new Error('下載到的 hook 內容不對，沒有安裝');
  const dir = sharedHookDir({ home, env });
  const guard = path.join(dir, HOOK_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(guard, source);
  const done = [];
  for (const tool of tools) {
    const file = TOOL_HOOKS[tool].file({ home, env });
    if (tool === 'cline') {
      try {
        const skipped = installClineHooks({ home, command: `"${node}" "${guard}" --tool cline`, platform });
        done.push({ tool, file, ...(skipped.length ? { error: `已有你自己的 ${skipped.join('、')} 腳本，沒有覆蓋` } : {}) });
      } catch (e) { done.push({ tool, file, error: e.message }); }
      continue;
    }
    try {
      const settings = readSettings(file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const saved = TOOL_HOOKS[tool].own ? null : backup(file, nowMs); // 自己的檔案不備份（備份檔留在 hooks 資料夾也會被工具讀到）
      fs.writeFileSync(file, JSON.stringify(mergeToolHooks(tool, settings, `"${node}" "${guard}" --tool ${tool}`), null, 2) + '\n');
      for (const [f, j] of TOOL_HOOKS[tool].extra?.(file) || []) fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
      done.push({ tool, file, backup: saved });
    } catch (e) { done.push({ tool, file, error: e.message }); }
  }
  return { guard, done };
}
export function uninstallToolHooks({ home = os.homedir(), env = process.env, nowMs = Date.now() } = {}) {
  const changed = [];
  for (const f of uninstallClineHooks({ home })) changed.push({ tool: 'cline', file: f, backup: null });
  for (const tool of Object.keys(TOOL_HOOKS)) {
    if (tool === 'cline') continue;
    const file = TOOL_HOOKS[tool].file({ home, env });
    if (TOOL_HOOKS[tool].own) {
      if (exists(file) && hasOurs(readJson(file))) {
        fs.rmSync(file);
        for (const [f] of TOOL_HOOKS[tool].extra?.(file) || []) fs.rmSync(f, { force: true });
        changed.push({ tool, file, backup: null });
      }
      continue;
    }
    let settings;
    try { settings = readSettings(file); } catch { continue; }
    if (!hasOurs(settings)) continue;
    const saved = backup(file, nowMs);
    fs.writeFileSync(file, JSON.stringify(removeHookSettings(settings), null, 2) + '\n');
    changed.push({ tool, file, backup: saved });
  }
  const dir = sharedHookDir({ home, env });
  const removed = [HOOK_FILE, PROFILE_FILE, SEEN_FILE, ...BREAKER_FILES].map((f) => path.join(dir, f)).filter((f) => { if (!exists(f)) return false; fs.rmSync(f); return true; });
  return { changed, removed };
}

// ---------- 開機自動啟動（macOS LaunchAgent；Linux、Windows 還沒做） ----------
// 依 Apple「Creating Launch Daemons and Agents」：放 ~/Library/LaunchAgents，登入時使用者層級的 launchd 會載入，不用管理員密碼；
// Label、ProgramArguments、StartInterval（秒）。RunAtLoad（載入時跑一次）、ProcessType Background（限制 CPU／IO）依 man launchd.plist。
// 睡眠中錯過的 StartInterval 不會補跑（man launchd.plist），所以每 6 小時一次，加上開機登入時一次。
export const AGENT_LABEL = 'com.agentops.agent';
export const TICK_SECONDS = 6 * 3600;
export const plistPath = ({ home = os.homedir() } = {}) => path.join(home, 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function launchAgentPlist({ node, script, url, log }) {
  const args = [node, script, '--tick', '--url', url].map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${TICK_SECONDS}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}
const uidOf = () => (typeof process.getuid === 'function' ? process.getuid() : 0);
export function installAutostart({ url, self, home = os.homedir(), env = process.env, node = process.execPath, platform = process.platform, run = spawnSync, uid = uidOf() }) {
  if (platform !== 'darwin') return { supported: false };
  const dir = agentopsHome({ home, env });
  const script = path.join(dir, 'agentops-connect.mjs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // 背景跑的是固定位置的這份腳本，客戶從哪裡下載都一樣
  if (self && path.resolve(self) !== path.resolve(script)) fs.copyFileSync(self, script);
  const plist = plistPath({ home });
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, launchAgentPlist({ node, script, url, log: path.join(dir, 'agent.log') }), { mode: 0o600 });
  fs.chmodSync(plist, 0o600); // Apple：使用者的 agent 檔不能讓群組或其他人寫
  run('launchctl', ['bootout', `gui/${uid}/${AGENT_LABEL}`], { stdio: 'ignore' }); // 重裝：先卸下舊的（沒載入過會失敗，忽略）
  const loaded = run('launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'ignore' }).status === 0;
  return { supported: true, plist, script, loaded };
}
export function uninstallAutostart({ home = os.homedir(), platform = process.platform, run = spawnSync, uid = uidOf() } = {}) {
  const plist = plistPath({ home });
  if (platform !== 'darwin' || !exists(plist)) return { removed: false };
  run('launchctl', ['bootout', `gui/${uid}/${AGENT_LABEL}`], { stdio: 'ignore' });
  fs.rmSync(plist, { force: true });
  return { removed: true, plist };
}

// ---------- 背景定時（--tick）：接上新出現的工具、看本地模型、上傳用量數字；不問任何問題 ----------
// 安裝時客戶同意過一次（~/.agentops/config.json）；known＝已經處理過的工具，客戶自己拿掉的 hook 不會再被裝回去
export const configPath = (opts) => path.join(agentopsHome(opts), 'config.json');
export const loadConfig = (opts) => { const c = readJson(configPath(opts)); return c && typeof c === 'object' && c.version === 1 ? c : null; };
export function saveConfig(c, opts) {
  fs.mkdirSync(agentopsHome(opts), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(opts), JSON.stringify({ version: 1, ...c }, null, 2) + '\n', { mode: 0o600 });
}
const modelName = (m) => String(m || '').replace(/[^\w.:/@-]/g, '').slice(0, 100);
// 本地模型：Ollama GET /api/ps（正在載入的模型）、LM Studio GET /api/v0/models（state＝loaded）；只拿模型名稱
// （docs.ollama.com/api/ps、lmstudio.ai/docs/developer/rest/endpoints，2026-11-05 查；LM Studio 1234 是文件範例埠）
export async function localModels({ fetchFn = fetch, timeoutMs = 1500 } = {}) {
  const get = async (u) => {
    try { const r = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs) }); return r.ok ? await r.json() : null; } catch { return null; }
  };
  const getText = async (u) => {
    try { const r = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs) }); return r.ok ? await r.text() : null; } catch { return null; }
  };
  const names = (list, f = () => true) => (Array.isArray(list) ? list : []).filter(f).map((m) => modelName(m?.name || m?.model || m?.id)).filter(Boolean).slice(0, 20);
  const out = [];
  const o = await get('http://127.0.0.1:11434/api/ps');
  if (o) {
    const tags = await get('http://127.0.0.1:11434/api/tags'); // 已下載的模型（docs.ollama.com/api/tags）
    out.push({ server: 'Ollama', models: names(o.models), installed: names(tags?.models), tokens: null, note: 'Ollama 不在本機存用量' });
  }
  const l = await get('http://127.0.0.1:1234/api/v0/models');
  const list = Array.isArray(l) ? l : Array.isArray(l?.data) ? l.data : null;
  if (list) out.push({ server: 'LM Studio', models: names(list, (m) => m?.state === 'loaded'), installed: names(list), tokens: null, note: 'LM Studio 不在本機存用量' });
  // llama.cpp server（預設 8080；github.com/ggml-org/llama.cpp tools/server/README.md：/health、/v1/models、--metrics 才有 /metrics）
  const h = await get('http://127.0.0.1:8080/health');
  if (h && (h.status === 'ok' || h.status === 'loading model')) {
    const m = await get('http://127.0.0.1:8080/v1/models');
    const metrics = await getText('http://127.0.0.1:8080/metrics');
    const num = (k) => { const x = metrics?.match(new RegExp(`^llamacpp:${k}\\s+([0-9.e+]+)`, 'm')); return x ? Math.round(Number(x[1])) : null; };
    const tokens = metrics ? { prompt: num('prompt_tokens_total'), output: num('tokens_predicted_total') } : null;
    out.push({ server: 'llama.cpp', models: names(m?.data), installed: [], tokens: tokens && tokens.prompt != null ? tokens : null,
      note: tokens ? '累計數字從伺服器啟動起算，沒有時間與每次呼叫，不上傳' : '沒開 --metrics，拿不到 token 數' });
  } else if ((await getText('http://127.0.0.1:8080/readyz')) != null) {
    // LocalAI（預設 :8080，localai.io troubleshooting／CLI reference：/readyz、/v1/models）
    const m = await get('http://127.0.0.1:8080/v1/models');
    out.push({ server: 'LocalAI', models: names(m?.data), installed: names(m?.data), tokens: null, note: 'LocalAI 的 token 數要用本機計數代理記' });
  }
  // vLLM（範例埠 8000；/metrics 的 vllm:prompt_tokens_total、vllm:generation_tokens_total，docs.vllm.ai design/metrics）
  const v = await get('http://127.0.0.1:8000/v1/models');
  if (v && Array.isArray(v.data)) {
    const metrics = await getText('http://127.0.0.1:8000/metrics');
    const sum = (k) => { if (!metrics) return null; let t = 0, hit = false; for (const x of metrics.matchAll(new RegExp(`^vllm:${k}(?:\\{[^}]*\\})?\\s+([0-9.e+]+)`, 'gm'))) { t += Number(x[1]); hit = true; } return hit ? Math.round(t) : null; };
    const tokens = metrics && /^vllm:/m.test(metrics) ? { prompt: sum('prompt_tokens_total'), output: sum('generation_tokens_total') } : null;
    if (tokens || v.data.some((m) => m?.owned_by === 'vllm')) out.push({ server: 'vLLM', models: names(v.data), installed: names(v.data), tokens: tokens && tokens.prompt != null ? tokens : null,
      note: '累計數字從伺服器啟動起算，沒有時間與每次呼叫，不上傳' });
  }
  // Jan（預設 127.0.0.1:1337，jan.ai/docs/local-api）、GPT4All（預設 4891，GPT4All API Server 文件）：OpenAI 相容 /v1/models
  for (const [server, port] of [['Jan', 1337], ['GPT4All', 4891]]) {
    const j = await get(`http://127.0.0.1:${port}/v1/models`);
    if (j && Array.isArray(j.data)) out.push({ server, models: names(j.data), installed: names(j.data), tokens: null, note: `${server} 不在本機存用量；要記錄請用本機計數代理` });
  }
  return out;
}
export async function tick({ url, home = os.homedir(), env = process.env, fetchFn = fetch, nowMs = Date.now(), platform = process.platform, run = spawnSync } = {}) {
  const opts = { home, env };
  const cfg = loadConfig(opts) || { known: [] };
  const report = detect(opts);
  const guard = path.join(sharedHookDir(opts), HOOK_FILE);
  const added = [];
  const known = new Set(cfg.known || []);
  if (cfg.autostart && exists(guard)) {
    const source = fs.readFileSync(guard, 'utf8');
    const fresh = hookableTools(report).filter((t) => !known.has(t));
    if (fresh.length) {
      const done = installToolHooks({ tools: fresh, source, home, env, nowMs }).done;
      for (const d of done) if (!d.error) added.push(d.tool);
      cfg.hook_errors = done.filter((d) => d.error).map((d) => d.tool);
      if (added.includes('codex')) cfg.codex_hooked_at = new Date(nowMs).toISOString();
    }
    const cdir = claudeDir(opts);
    if (!known.has('claude') && report.agents.some((a) => a.id === 'claude-code') && !hookInstalled(cdir)) { installHook({ dir: cdir, source, nowMs }); added.push('claude'); }
    for (const t of added) known.add(t);
    if (added.length || fresh.length) saveConfig({ ...cfg, known: [...known] }, opts);
    const script = path.join(agentopsHome(opts), 'agentops-connect.mjs');
    const watchFile = platform === 'darwin' ? watchPlistPath(opts) : platform === 'win32' ? path.join(agentopsHome(opts), 'agentops-watch.vbs') : path.join(systemdDir(home), 'agentops-watch.service');
    if (cfg.watch !== false && watchableTools(report).length && exists(script) && !exists(watchFile)) {
      if (installWatch({ script, home, env, platform, run }).supported) added.push('watch');
    }
  }
  // 背景定時跑得起來＝開機自動執行生效了；Codex hook 跑過一次就記進設定
  {
    const c = loadConfig(opts) || cfg;
    const seen = !c.codex_seen_at && codexSeenAt({ opts, cfg: c });
    if (c.autostart_pending || seen) saveConfig({ ...c, autostart_pending: false, ...(seen ? { codex_seen_at: new Date(seen).toISOString() } : {}) }, opts);
  }
  const local = await localModels({ fetchFn });
  // 基線一天更新一次（讀 14 天紀錄）
  if (!cfg.baseline_at || nowMs - Date.parse(cfg.baseline_at) > DAY_MS) {
    const done = writeBaseline(hookDirs(opts), computeBaseline(await collect(detect(opts), { days: 14, nowMs })));
    if (done.length) saveConfig({ ...(loadConfig(opts) || cfg), baseline_at: new Date(nowMs).toISOString() }, opts);
  }
  let sent = null;
  const key = env.AGENTOPS_KEY || loadSavedKey(opts);
  if (key && url) {
    const events = await collect(report, { days: 2, nowMs });
    if (events.length) { const r = await send(events, { url, key, fetchFn, sleep: async () => {} }); sent = { accepted: r.accepted, duplicates: r.duplicates }; }
    try { const t = await sendTrips(readTrips(hookDirs(opts)), { url, key, fetchFn }); if (sent) sent.trips = t.accepted; else sent = { accepted: 0, duplicates: 0, trips: t.accepted }; } catch { /* 下次再送 */ }
    try {
      const p = await fetchProfile({ url, key, fetchFn });
      if (hookInstalled(claudeDir(opts))) writeProfile(claudeDir(opts), p);
      if (exists(guard)) writeProfile(agentopsHome(opts), p);
    } catch { /* 下次再更新 */ }
    try { await sendMachine({ url, key, fetchFn, status: machineStatus({ report, local, opts, cfg: loadConfig(opts) || cfg }) }); } catch { /* 下次再送 */ }
    // 一行安裝裝的：AI 工具設定檔一天掃一次
    const c2 = loadConfig(opts) || cfg;
    if (c2.via === 'installer' && (!c2.scanned_at || nowMs - Date.parse(c2.scanned_at) > DAY_MS)) {
      try {
        const sc = await loadScanner({ url, fetchFn, opts });
        await sendFindings({ url, key, fetchFn, nowMs, label: CONFIG_SCAN_LABEL, findings: sc.uploadable(scanToolConfigs({ lineSecrets: sc.lineSecrets, home, env })) });
        saveConfig({ ...c2, scanned_at: new Date(nowMs).toISOString() }, opts);
      } catch { /* 下次再掃 */ }
    }
  }
  const status = { at: new Date(nowMs).toISOString(), tools: report.agents.map((a) => a.id),
    hooked: [...(hookInstalled(claudeDir(opts)) ? ['claude'] : []), ...Object.keys(TOOL_HOOKS).filter((t) => toolHooked(t, opts))], added, local, sent };
  fs.mkdirSync(agentopsHome(opts), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(agentopsHome(opts), 'status.json'), JSON.stringify(status, null, 2) + '\n');
  return status;
}

// ---------- 個人基線（token 速率熔斷用）：過去紀錄裡「每 5 分鐘不含快取讀取的 token 數」的 p95 ----------
export const BASELINE_FILE = 'agentops-baseline.json';
export function computeBaseline(events, { minBuckets = 30 } = {}) {
  const b = new Map();
  for (const e of events) {
    if (!e.agent.startsWith('Claude Code')) continue; // 熔斷只有 Claude Code 讀得到即時 token
    const k = Math.floor(Date.parse(e.ts) / 300e3);
    b.set(k, (b.get(k) || 0) + Math.max(0, e.input_tokens - (e.cache_read_tokens || 0)) + e.output_tokens);
  }
  const v = [...b.values()].sort((x, y) => x - y);
  if (v.length < minBuckets) return null;
  return { version: 1, rate5m_p95: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))], buckets: v.length, computed_at: new Date().toISOString() };
}
export function writeBaseline(dirs, base) {
  if (!base) return [];
  return dirs.filter((d) => exists(path.join(d, HOOK_FILE))).map((d) => { fs.writeFileSync(path.join(d, BASELINE_FILE), JSON.stringify(base) + '\n'); return d; });
}

// ---------- 熔斷紀錄上傳：hook 寫的 agentops-breaker.log（每行 {id, at, tool, reason, n, model, token 數}；舊格式沒有 id 的不送） ----------
const TRIP_FIELDS = ['id', 'at', 'tool', 'reason', 'n', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens'];
export function readTrips(dirs) {
  const out = new Map();
  for (const d of dirs) {
    let text = '';
    try { text = fs.readFileSync(path.join(d, BREAKER_FILES[0]), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      let t; try { t = JSON.parse(line); } catch { continue; }
      if (t?.id && t.at && t.reason) out.set(t.id, Object.fromEntries(TRIP_FIELDS.filter((k) => t[k] != null).map((k) => [k, t[k]])));
    }
  }
  return [...out.values()];
}
export async function sendTrips(trips, { url, key, fetchFn = fetch }) {
  if (!trips.length) return { accepted: 0, duplicates: 0 };
  const r = await fetchFn(`${url}/api/ingest/guard`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: trips.slice(-200) }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`熔斷紀錄上傳失敗（HTTP ${r.status}）：${b.error || ''}`);
  return b;
}
const hookDirs = (opts) => [path.join(claudeDir(opts), 'hooks'), sharedHookDir(opts)];

// ---------- 本機資安掃描（agentops-scan.mjs＋agentops-workspace-rules.mjs；不在旁邊就從 Budgethelm 下載到 ~/.agentops） ----------
export async function loadScanner({ url, fetchFn = fetch, opts = {} } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = [here, agentopsHome(opts)].find((d) => exists(path.join(d, 'agentops-scan.mjs')) && exists(path.join(d, 'agentops-workspace-rules.mjs')));
  if (!dir) {
    dir = agentopsHome(opts);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const f of ['agentops-scan.mjs', 'agentops-workspace-rules.mjs']) fs.writeFileSync(path.join(dir, f), await fetchText(`${url}/${f}`, { fetchFn }));
  }
  return import(pathToFileURL(path.join(dir, 'agentops-scan.mjs')).href);
}
export const scanLabel = (dir) => (path.basename(path.resolve(dir)).replace(/[^\p{L}\p{N}_. ()-]/gu, '_').slice(0, 80) || 'project');
export async function sendFindings({ url, key, label, findings, fetchFn = fetch, nowMs = Date.now() }) {
  const r = await fetchFn(`${url}/api/ingest/findings`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ label, scanned_at: new Date(nowMs).toISOString(), findings }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`資安結果上傳失敗（HTTP ${r.status}）：${b.error || ''}`);
  return b;
}

export const isGuardSource = (src) => typeof src === 'string' && src.length < 100_000 && (src.includes('Budgethelm 守護 hook') || src.includes('AgentOps 守護 hook')) && src.includes('export function decide');
export const hookInstalled = (dir = claudeDir()) => exists(path.join(dir, 'hooks', HOOK_FILE));

// 優化設定只留 hook 會用的欄位（開關、最多 2 句提示）與給人看的摘要；不寫任何秘密
export function writeProfile(dir, p) {
  const clean = { version: 1, generated_at: p.generated_at, rules: Object.fromEntries(Object.entries(p.rules || {}).filter(([, v]) => typeof v === 'boolean')),
    tips: (p.tips || []).filter((t) => typeof t === 'string' && t.length <= 200).slice(0, 2), focus: p.focus || [], models: p.models || [],
    ...(p.breaker && typeof p.breaker === 'object' ? { breaker: Object.fromEntries(Object.entries(p.breaker).filter(([, v]) => Number.isInteger(v))) } : {}) };
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks', PROFILE_FILE), JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

export async function fetchText(u, { fetchFn = fetch, headers = {} } = {}) {
  const r = await fetchFn(u, { headers });
  if (!r.ok) throw new Error(`下載 ${u} 失敗（HTTP ${r.status}）`);
  return r.text();
}
// ---------- 配對與本機保存的匯入金鑰 ----------
export const agentopsHome = ({ home = os.homedir(), env = process.env } = {}) => env.AGENTOPS_HOME || path.join(home, '.agentops');
export const savedKeyPath = (opts) => path.join(agentopsHome(opts), 'key');
export function loadSavedKey(opts) {
  try { const k = fs.readFileSync(savedKeyPath(opts), 'utf8').trim(); return k.startsWith('aops_') ? k : ''; } catch { return ''; }
}
export function saveKey(key, opts) {
  const dir = agentopsHome(opts);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(savedKeyPath(opts), key + '\n', { mode: 0o600 });
  fs.chmodSync(savedKeyPath(opts), 0o600); // 檔案已存在時 writeFileSync 不會改權限
}
// 一次性配對碼換匯入金鑰；replace 是這台電腦上一把（伺服器只撤銷同一人、同專案的那把）
export async function pair({ url, code, replace = '', fetchFn = fetch }) {
  const r = await fetchFn(`${url}/api/ingest/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(replace ? { code, replace } : { code }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `配對失敗（HTTP ${r.status}）`);
  return b;
}

export const fetchProfile = async ({ url, key, fetchFn = fetch }) => JSON.parse(await fetchText(`${url}/api/ingest/profile`, { fetchFn, headers: { authorization: `Bearer ${key}` } }));

// ---------- 各工具的 Budgethelm MCP（一行安裝用：帶 MCP 權杖，客戶不用在工具裡點授權） ----------
// 格式依官方文件（2026-11-08 查）：
//   Claude Code：claude mcp add --transport http -s user agentops <url> -H "Authorization: Bearer …"（claude mcp add --help）
//   Cursor：~/.cursor/mcp.json mcpServers.<名稱> { url, headers }（cursor.com/docs/context/mcp）
//   Gemini CLI：~/.gemini/settings.json mcpServers.<名稱> { httpUrl, headers }（url 是 SSE；github.com/google-gemini/gemini-cli docs/tools/mcp-server.md）
//   Codex：config.toml [mcp_servers.<名稱>] url、http_headers（learn.chatgpt.com/docs/config-file/config-reference）
//   Windsurf 文件已搬到 docs.devin.ai、遠端 HTTP 的欄位查不到 ❓，先不自動接
// 權杖是 Budgethelm 發的（aopm_，只能讀這個專案的摘要），不是模型 API key；寫進去的檔案權限改成只有自己能讀
const BEARER = (t) => `Bearer ${t}`;
// 舊品牌名：已裝的客戶 config.toml 靠這兩行標記認出這段，改名後不改
const CODEX_BEGIN = '# >>> AgentOps（AgentOps 安裝時加的；解除安裝會拿掉這段）', CODEX_END = '# <<< AgentOps';
export const MCP_TARGETS = {
  cursor: { name: 'Cursor', file: ({ home }) => path.join(home, '.cursor', 'mcp.json'), entry: (u, t) => ({ url: u, headers: { Authorization: BEARER(t) } }) },
  'gemini-cli': { name: 'Gemini CLI', file: ({ home }) => path.join(home, '.gemini', 'settings.json'), entry: (u, t) => ({ httpUrl: u, headers: { Authorization: BEARER(t) } }) },
  codex: { name: 'Codex CLI', toml: true, file: ({ home, env }) => path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml') },
};
export const codexBlock = (u, t) => `${CODEX_BEGIN}\n[mcp_servers.agentops]\nurl = ${JSON.stringify(u)}\nhttp_headers = { Authorization = ${JSON.stringify(BEARER(t))} }\n${CODEX_END}\n`;
export const stripCodexBlock = (s) => s.replace(new RegExp(`\\n?${CODEX_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CODEX_END}\\n?`, 'g'), '\n').replace(/\n{3,}/g, '\n\n');
const writePrivate = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { mode: 0o600 }); fs.chmodSync(file, 0o600); };
const spawnBin = (bin, args, run) => run(bin, args, { stdio: 'ignore', shell: /\.(cmd|bat)$/i.test(bin), timeout: 60_000 });

// 已經接了 agentops（例如客戶之前用 OAuth 接過）的工具不動
export function registerMcp({ report, url, token, home = os.homedir(), env = process.env, claudeBin = null, run = spawnSync, nowMs = Date.now() }) {
  const mcpUrl = `${url}/api/mcp`;
  const done = [];
  for (const a of report.agents) {
    if (a.agentops_mcp === true) { done.push({ id: a.id, skipped: '已經接過' }); continue; }
    if (a.id === 'claude-code') {
      if (!claudeBin) { done.push({ id: a.id, error: '找不到 claude 指令' }); continue; }
      const ok = spawnBin(claudeBin, ['mcp', 'add', '--transport', 'http', '-s', 'user', 'agentops', mcpUrl, '-H', `Authorization: ${BEARER(token)}`], run).status === 0;
      done.push(ok ? { id: a.id, via: 'claude mcp add' } : { id: a.id, error: 'claude mcp add 失敗' });
      continue;
    }
    const t = MCP_TARGETS[a.id];
    if (!t) continue;
    const file = t.file({ home, env });
    try {
      const saved = backup(file, nowMs);
      if (t.toml) {
        const cur = exists(file) ? fs.readFileSync(file, 'utf8') : '';
        writePrivate(file, `${stripCodexBlock(cur).replace(/\s*$/, '')}${cur.trim() ? '\n\n' : ''}${codexBlock(mcpUrl, token)}`);
      } else {
        const j = readSettings(file);
        writePrivate(file, JSON.stringify({ ...j, mcpServers: { ...(j.mcpServers || {}), agentops: t.entry(mcpUrl, token) } }, null, 2) + '\n');
      }
      done.push({ id: a.id, file, backup: saved });
    } catch (e) { done.push({ id: a.id, file, error: e.message }); }
  }
  return done;
}
// 只拿掉我們加的（網址是 /api/mcp、或 Codex 標記中間那段）
export function unregisterMcp({ ids = [], home = os.homedir(), env = process.env, claudeBin = null, run = spawnSync, nowMs = Date.now() } = {}) {
  const done = [];
  for (const id of ids) {
    if (id === 'claude-code') {
      if (claudeBin) done.push({ id, ok: spawnBin(claudeBin, ['mcp', 'remove', 'agentops', '-s', 'user'], run).status === 0 });
      else done.push({ id, ok: false });
      continue;
    }
    const t = MCP_TARGETS[id];
    if (!t) continue;
    const file = t.file({ home, env });
    if (!exists(file)) continue;
    try {
      if (t.toml) {
        const cur = fs.readFileSync(file, 'utf8');
        if (!cur.includes(CODEX_BEGIN)) continue;
        const b = backup(file, nowMs);
        fs.writeFileSync(file, stripCodexBlock(cur).replace(/^\n+/, '').replace(/\n+$/, '\n'));
        done.push({ id, file, backup: b, ok: true });
      } else {
        const j = readSettings(file);
        const e = j.mcpServers?.agentops;
        if (!e || !String(e.url || e.httpUrl || '').endsWith('/api/mcp')) continue;
        const b = backup(file, nowMs);
        const servers = { ...j.mcpServers };
        delete servers.agentops;
        const out = { ...j, mcpServers: servers };
        if (!Object.keys(servers).length) delete out.mcpServers;
        fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
        done.push({ id, file, backup: b, ok: true });
      }
    } catch (e) { done.push({ id, file, ok: false, error: e.message }); }
  }
  return done;
}

// ---------- 開機自動啟動：Windows（工作排程器＋登入時）、Linux（systemd 使用者計時器） ----------
// Windows：schtasks /Create /SC HOURLY /MO 6（learn.microsoft.com schtasks-create）＋ HKCU\…\Run 登入時跑一次，都不用系統管理員；
//   用 wscript 跑一個 .vbs 包住 node，背景跑時不會跳出黑色視窗。⚠️ 沒有在真的 Windows 上跑過，只有指令層測試
// Linux：~/.config/systemd/user/agentops.{service,timer}，OnBootSec＋OnUnitActiveSec（man systemd.timer）；沒有 systemd 就跳過
export const WIN_TASK = 'AgentOps', // 舊品牌名：已裝的 Windows 排程與開機項目靠這個名字移除，改名後不改
  WIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const vbsQ = (s) => `""${String(s).replace(/"/g, '')}""`;
export const winTickVbs = ({ node, script, url }) => `' Budgethelm 背景定時（解除安裝會刪掉）\r\nCreateObject("WScript.Shell").Run "${vbsQ(node)} ${vbsQ(script)} --tick --url ${vbsQ(url)}", 0, False\r\n`;
export const systemdUnits = ({ node, script, url }) => ({
  'agentops.service': `[Unit]\nDescription=Budgethelm 背景定時（接上新工具、上傳用量數字）\n\n[Service]\nType=oneshot\nExecStart="${node}" "${script}" --tick --url ${url}\n`,
  'agentops.timer': `[Unit]\nDescription=Budgethelm 每 6 小時\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=${TICK_SECONDS / 3600}h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`,
});
const systemdDir = (home) => path.join(home, '.config', 'systemd', 'user');
export function installAutostartOther({ url, script, home = os.homedir(), env = process.env, node = process.execPath, platform = process.platform, run = spawnSync }) {
  const dir = agentopsHome({ home, env });
  if (platform === 'win32') {
    const vbs = path.join(dir, 'agentops-tick.vbs');
    fs.writeFileSync(vbs, '\ufeff' + winTickVbs({ node, script, url }), 'utf16le'); // UTF-16 才不會被系統碼頁弄壞中文使用者名稱的路徑
    const cmd = `wscript.exe "${vbs}"`;
    const a = run('schtasks', ['/Create', '/F', '/SC', 'HOURLY', '/MO', '6', '/TN', WIN_TASK, '/TR', cmd], { stdio: 'ignore' }).status === 0;
    const b = run('reg', ['add', WIN_RUN_KEY, '/v', WIN_TASK, '/t', 'REG_SZ', '/d', cmd, '/f'], { stdio: 'ignore' }).status === 0;
    return { supported: true, loaded: a && b, files: [vbs] };
  }
  if (platform === 'linux') {
    const d = systemdDir(home);
    fs.mkdirSync(d, { recursive: true });
    const files = Object.entries(systemdUnits({ node, script, url })).map(([f, text]) => { fs.writeFileSync(path.join(d, f), text); return path.join(d, f); });
    const ok = run('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' }).status === 0
      && run('systemctl', ['--user', 'enable', '--now', 'agentops.timer'], { stdio: 'ignore' }).status === 0;
    return { supported: true, loaded: ok, files };
  }
  return { supported: false };
}
export function uninstallAutostartOther({ home = os.homedir(), env = process.env, platform = process.platform, run = spawnSync } = {}) {
  if (platform === 'win32') {
    run('schtasks', ['/Delete', '/F', '/TN', WIN_TASK], { stdio: 'ignore' });
    run('reg', ['delete', WIN_RUN_KEY, '/v', WIN_TASK, '/f'], { stdio: 'ignore' });
    const vbs = path.join(agentopsHome({ home, env }), 'agentops-tick.vbs');
    const had = exists(vbs); fs.rmSync(vbs, { force: true });
    return { removed: had };
  }
  if (platform === 'linux') {
    const d = systemdDir(home);
    if (!exists(path.join(d, 'agentops.timer'))) return { removed: false };
    run('systemctl', ['--user', 'disable', '--now', 'agentops.timer'], { stdio: 'ignore' });
    for (const f of Object.keys(systemdUnits({ node: '', script: '', url: '' }))) fs.rmSync(path.join(d, f), { force: true });
    run('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    return { removed: true };
  }
  return { removed: false };
}

// ---------- 紀錄監看（--watch）：hook 沒被信任或工具沒有 hook 時的後備熔斷 ----------
// 讀工具自己寫的對話紀錄（只在本機，不上傳內容），套 agentops-guard.mjs 同一套熔斷規則；觸發就記一筆熔斷紀錄、跳通知，
// 再對「正開著這份紀錄檔」的行程送 SIGINT（跟按 Ctrl-C 一樣），3 秒後還在才送 SIGTERM。headless（codex exec、排程）一樣適用。
// Codex：hook 要在 /hooks 信任才會跑（learn.chatgpt.com/docs/hooks，2026-11-09 查），一般使用者層級沒有官方的預先信任方式
// （只有系統層 /etc/codex/requirements.toml 的 managed hooks，要管理員權限），所以 Codex 一律加這層。
// Codex 紀錄格式：sessions/YYYY/MM/DD/rollout-*.jsonl，response_item 的 function_call（name、arguments、call_id）
// 與 function_call_output（call_id、output 含「Process exited with code N」）；event_msg user_message／item_completed UserMessage＝有人發訊息
// （codex-cli 0.164.0 實際跑 codex exec 比對，2026-11-09）。找行程用 lsof（macOS、Linux 內建）；Windows 用 PowerShell 列 codex.exe，挑紀錄建立前最晚開始的那個（2026-11-09 加）。
export const WATCH_LABEL = 'com.agentops.watch';
export const WATCH_MS = 2000;
export function codexWatchEvents(line, st) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  const p = o?.payload || {};
  st.calls ||= {};
  if (o.type === 'turn_context' || o.type === 'session_meta') { st.model = p.model || st.model; return []; }
  if (o.type === 'event_msg' && (p.type === 'user_message' || (p.type === 'item_completed' && p.item?.type === 'UserMessage'))) return [{ hook_event_name: 'UserPromptSubmit' }];
  if (o.type !== 'response_item') return [];
  if (p.type === 'function_call' || p.type === 'custom_tool_call') {
    if (Object.keys(st.calls).length > 200) st.calls = {};
    st.calls[p.call_id] = { name: p.name, input: p.arguments ?? p.input ?? null };
    return [];
  }
  if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
    const c = st.calls[p.call_id] || {};
    delete st.calls[p.call_id];
    const out = typeof p.output === 'string' ? p.output : p.output?.content ?? JSON.stringify(p.output ?? '');
    return [{ hook_event_name: 'PostToolUse', tool_name: c.name || 'tool', tool_input: c.input, tool_response: out, session_id: st.sid }];
  }
  return [];
}
export const WATCHERS = {
  codex: { name: 'Codex CLI', dir: ({ home, env }) => path.join(env.CODEX_HOME || path.join(home, '.codex'), 'sessions'),
    match: (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), events: codexWatchEvents },
};
// 正開著這個檔案的行程（lsof -t 只印 pid）；不是自己
// Windows 沒有 lsof：用 PowerShell 列出 codex.exe（npm 版的本體也是它），挑「在這份紀錄建立之前、最晚開始」的那一個（紀錄是那個行程開的）
export const WIN_PS_CODEX = "Get-CimInstance Win32_Process -Filter \"Name='codex.exe'\" | ForEach-Object { \"$($_.ProcessId) $($_.CreationDate.ToUniversalTime().ToString('o'))\" }";
export function winHolders(file, { run = spawnSync, birthMs = null } = {}) {
  let born = birthMs;
  if (born == null) { try { const st = fs.statSync(file); born = st.birthtimeMs || st.ctimeMs; } catch { return []; } }
  const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PS_CODEX], { encoding: 'utf8', windowsHide: true });
  const procs = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim().match(/^(\d+)\s+(\S+)$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), at: Date.parse(m[2]) })).filter((x) => x.pid > 4 && x.pid !== process.pid && Number.isFinite(x.at) && x.at <= born + 2000);
  procs.sort((a, b) => b.at - a.at);
  return procs.length ? [procs[0].pid] : [];
}
// 自己的上層行程（叫起監看／安裝程式的終端機、agent）：絕不停（2026-11-10：測試或安裝時不能把呼叫它的 session 停掉）
export function ancestors({ pid = process.ppid, run = spawnSync, platform = process.platform, depth = 16 } = {}) {
  const out = new Set();
  if (platform === 'win32') return out;
  for (let i = 0; i < depth && pid > 1 && !out.has(pid); i++) {
    out.add(pid);
    const m = String(run('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim();
    pid = Number(m);
    if (!Number.isInteger(pid)) break;
  }
  return out;
}
export function holders(file, { run = spawnSync, platform = process.platform, birthMs = null } = {}) {
  if (platform === 'win32') return winHolders(file, { run, birthMs });
  const r = run('lsof', ['-t', '--', file], { encoding: 'utf8' });
  const pids = String(r.stdout || '').split('\n').map(Number).filter((n) => Number.isInteger(n) && n > 1 && n !== process.pid);
  if (!pids.length) return pids;
  const mine = ancestors({ run, platform });
  return pids.filter((n) => !mine.has(n));
}
export function stopProcess(pid, { kill = process.kill.bind(process), setTimer = setTimeout } = {}) {
  try { kill(pid, 'SIGINT'); } catch { return false; }
  setTimer(() => { try { kill(pid, 0); kill(pid, 'SIGTERM'); } catch { /* 已經停了 */ } }, 3000).unref?.();
  return true;
}
export async function loadGuard(opts) {
  const f = path.join(sharedHookDir(opts), HOOK_FILE);
  if (!exists(f)) return null;
  try { return await import(`${pathToFileURL(f).href}?m=${fs.statSync(f).mtimeMs}`); } catch { return null; }
}
// 掃一輪：近 10 分鐘有寫入的紀錄檔，從上次讀到的位置往下讀完整的行。state.files[檔名]＝{ off, b, st, tripped }
export function watchOnce(state, { guard, home = os.homedir(), env = process.env, nowMs = Date.now(), run = spawnSync, kill, setTimer, notify = guard?.notify, platform = process.platform } = {}) {
  const opts = { home, env };
  const actions = [];
  const off = /^(off|0|false)$/i.test(env.AGENTOPS_BREAKER || '');
  const dir = sharedHookDir(opts);
  const allowed = guard.allowedUntil(dir) > nowMs;
  const limits = { ...guard.BREAKER, ...(guard.loadProfile(path.join(dir, PROFILE_FILE)).breaker || {}) };
  state.files ||= {};
  for (const [tool, w] of Object.entries(WATCHERS)) {
    for (const f of jsonlFiles(w.dir(opts), nowMs - 10 * 60e3, w.match)) {
      const s = state.files[f] ||= { off: 0, b: {}, st: { sid: path.basename(f, '.jsonl') }, tripped: false };
      let size;
      try { size = fs.statSync(f).size; } catch { continue; }
      if (size < s.off) Object.assign(s, { off: 0, b: {}, tripped: false });
      if (size === s.off) continue;
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(Math.min(size - s.off, 8 * 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, s.off);
      fs.closeSync(fd);
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n');
      if (end < 0) { if (buf.length === 8 * 1024 * 1024) s.off += buf.length; continue; } // 一行超過 8MB：跳過
      s.off += Buffer.byteLength(text.slice(0, end + 1));
      for (const line of text.slice(0, end).split('\n')) {
        for (const ev of w.events(line, s.st)) {
          if (ev.hook_event_name === 'UserPromptSubmit') { s.b = {}; s.tripped = false; continue; }
          const r = guard.breakerStep(guard.normalize(tool, ev), s.b, limits);
          s.b = r.b;
          if (!r.stop || s.tripped || off || allowed) continue;
          s.tripped = true;
          const why = guard.MSG.stop(`${tool === 'codex' ? 'Codex' : tool}：${{ fails: `連續失敗 ${r.n} 次`, same: `同一個錯誤重複了 ${r.n} 次`, failures: `這次工作已經失敗 ${r.n} 次`, tools: `沒有人回話的情況下已經連續跑了 ${r.n} 個工具呼叫`, cmd: `同一個指令重複執行了 ${r.n} 次` }[r.stop] || r.stop}`);
          try { fs.mkdirSync(dir, { recursive: true }); guard.recordTrip(dir, { at: new Date(nowMs).toISOString(), tool, reason: r.stop, n: r.n, ...(s.st.model ? { usage: { model: s.st.model } } : {}) }); } catch { /* 記不下來也要停 */ }
          const pids = holders(f, { run, platform });
          const stopped = pids.filter((pid) => stopProcess(pid, { kill, setTimer }));
          try { notify?.(why.replace(/^\[(?:Budgethelm|AgentOps) 熔斷\] /, '').replace(/，已自動停下.*$/, '')); } catch { /* 通知失敗不影響 */ }
          actions.push({ tool, file: f, reason: r.stop, n: r.n, pids: stopped });
        }
      }
    }
  }
  for (const f of Object.keys(state.files)) { try { if (fs.statSync(f).mtimeMs < nowMs - 60 * 60e3) delete state.files[f]; } catch { delete state.files[f]; } }
  return actions;
}
export async function watch({ home = os.homedir(), env = process.env, log = console.log, intervalMs = WATCH_MS } = {}) {
  const opts = { home, env };
  const state = {};
  let guard = null, loadedAt = 0;
  for (;;) {
    if (!guard || Date.now() - loadedAt > 10 * 60e3) { guard = await loadGuard(opts) || guard; loadedAt = Date.now(); }
    const cfg = loadConfig(opts);
    if (guard && cfg?.watch !== false) {
      try { for (const a of watchOnce(state, { guard, home, env })) log(`${new Date().toISOString()} 熔斷 ${a.tool} ${a.reason}×${a.n}${a.pids.length ? `，已停下行程 ${a.pids.join(',')}` : '，沒找到行程'}`); }
      catch (e) { log(`監看出錯：${e.message}`); }
    }
    await new Promise((r) => setTimeout(r, guard ? intervalMs : 60e3));
  }
}
// 監看常駐：macOS LaunchAgent（KeepAlive）、Linux systemd --user（Restart=always）、Windows HKCU Run＋wscript 隱藏視窗
export const watchPlistPath = ({ home = os.homedir() } = {}) => path.join(home, 'Library', 'LaunchAgents', `${WATCH_LABEL}.plist`);
export function watchPlist({ node, script, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${WATCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>--watch</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}
export const watchUnit = ({ node, script }) => `[Unit]\nDescription=Budgethelm 紀錄監看（hook 沒生效的工具，暴衝時停下）\n\n[Service]\nExecStart="${node}" "${script}" --watch\nRestart=always\nRestartSec=30\nNice=10\n\n[Install]\nWantedBy=default.target\n`;
export function installWatch({ script, home = os.homedir(), env = process.env, node = process.execPath, platform = process.platform, run = spawnSync, uid = uidOf() }) {
  const dir = agentopsHome({ home, env });
  if (platform === 'darwin') {
    const plist = watchPlistPath({ home });
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, watchPlist({ node, script, log: path.join(dir, 'watch.log') }), { mode: 0o600 });
    fs.chmodSync(plist, 0o600);
    run('launchctl', ['bootout', `gui/${uid}/${WATCH_LABEL}`], { stdio: 'ignore' });
    return { supported: true, file: plist, loaded: run('launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'ignore' }).status === 0 };
  }
  if (platform === 'linux') {
    const f = path.join(systemdDir(home), 'agentops-watch.service');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, watchUnit({ node, script }));
    const ok = run('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' }).status === 0
      && run('systemctl', ['--user', 'enable', '--now', 'agentops-watch.service'], { stdio: 'ignore' }).status === 0;
    return { supported: true, file: f, loaded: ok };
  }
  if (platform === 'win32') {
    // 登入時用 wscript 隱藏視窗跑 --watch（HKCU Run，不用管理員）；現在也先跑一個
    const vbs = path.join(dir, 'agentops-watch.vbs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(vbs, '\ufeff' + winWatchVbs({ node, script }), 'utf16le');
    const cmd = `wscript.exe "${vbs}"`;
    const ok = run('reg', ['add', WIN_RUN_KEY, '/v', WIN_WATCH, '/t', 'REG_SZ', '/d', cmd, '/f'], { stdio: 'ignore' }).status === 0;
    const started = run('wscript.exe', [vbs], { stdio: 'ignore' }).status === 0;
    return { supported: true, file: vbs, loaded: ok && started };
  }
  return { supported: false };
}
export const WIN_WATCH = 'AgentOpsWatch'; // 舊品牌名，同 WIN_TASK
export const winWatchVbs = ({ node, script }) => `' Budgethelm 紀錄監看（解除安裝會刪掉）\r\nCreateObject("WScript.Shell").Run "${vbsQ(node)} ${vbsQ(script)} --watch", 0, False\r\n`;
export function uninstallWatch({ home = os.homedir(), env = process.env, platform = process.platform, run = spawnSync, uid = uidOf() } = {}) {
  if (platform === 'win32') {
    const vbs = path.join(agentopsHome({ home, env }), 'agentops-watch.vbs');
    if (!exists(vbs)) return { removed: false };
    run('reg', ['delete', WIN_RUN_KEY, '/v', WIN_WATCH, '/f'], { stdio: 'ignore' });
    // 停掉正在跑的監看：命令列有 --watch 而且是我們的腳本
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*agentops-connect.mjs*--watch*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore', windowsHide: true });
    fs.rmSync(vbs, { force: true });
    return { removed: true, file: vbs };
  }
  if (platform === 'darwin') {
    const plist = watchPlistPath({ home });
    if (!exists(plist)) return { removed: false };
    run('launchctl', ['bootout', `gui/${uid}/${WATCH_LABEL}`], { stdio: 'ignore' });
    fs.rmSync(plist, { force: true });
    return { removed: true, file: plist };
  }
  if (platform === 'linux') {
    const f = path.join(systemdDir(home), 'agentops-watch.service');
    if (!exists(f)) return { removed: false };
    run('systemctl', ['--user', 'disable', '--now', 'agentops-watch.service'], { stdio: 'ignore' });
    fs.rmSync(f, { force: true });
    run('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    return { removed: true, file: f };
  }
  return { removed: false };
}
// 有哪些偵測到的工具要靠監看（現在只有 Codex）
export const watchableTools = (report) => Object.keys(WATCHERS).filter((t) => report.agents.some((a) => a.id === TOOL_HOOKS[t]?.id));

// ---------- 選配：本機計數代理（--proxy <名稱|網址>，客戶自己開才有）----------
// 給沒有紀錄檔、沒有 hook 的呼叫：自己寫的程式直接用 OpenAI／Anthropic／Gemini／OpenRouter SDK、Ollama、LM Studio 等本地伺服器。
// 只聽 127.0.0.1，請求原樣轉給上游（金鑰在請求標頭裡，只經過這台電腦的這個程式，不記錄、不存、不送 Budgethelm），
// 從回應讀 token 數寫到 ~/.agentops/proxy-usage.jsonl（時間、模型、token 數、成功與否），背景定時跟其他用量一起上傳。
// 暴衝：5 分鐘內請求超過上限（預設 600，AGENTOPS_PROXY_MAX_5M 可改）或上游連續失敗 8 次，接下來 5 分鐘直接回 429，不再轉給上游。
// 用量欄位：OpenAI usage.prompt_tokens／completion_tokens（Responses API input_tokens／output_tokens），Anthropic usage.input_tokens／output_tokens／cache_read_input_tokens，
// Ollama prompt_eval_count／eval_count，Gemini usageMetadata.promptTokenCount／candidatesTokenCount（各家 API 文件，2026-11-09 查）
export const PROXY_UPSTREAMS = {
  ollama: 'http://127.0.0.1:11434', 'lm-studio': 'http://127.0.0.1:1234', 'llama-cpp': 'http://127.0.0.1:8080', vllm: 'http://127.0.0.1:8000',
  jan: 'http://127.0.0.1:1337', gpt4all: 'http://127.0.0.1:4891', localai: 'http://127.0.0.1:8080',
  openai: 'https://api.openai.com', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com', openrouter: 'https://openrouter.ai/api',
};
export const PROXY_FILE = 'proxy-usage.jsonl', PROXY_PORT = 11500;
export function proxyUpstream(x) {
  const u = PROXY_UPSTREAMS[x] || x;
  if (!/^https:\/\/[^/]+/.test(u) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(u)) throw new Error('--proxy 要接名稱（ollama、openai…）或 https 網址／本機 http 網址');
  return u.replace(/\/+$/, '');
}
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);
function usageObj(o, acc) {
  if (!o || typeof o !== 'object') return;
  const m = o.model || o.message?.model || o.response?.model || o.modelVersion;
  if (typeof m === 'string' && m) acc.model = m;
  const u = o.usage || o.message?.usage || o.response?.usage;
  if (u) {
    if (u.prompt_tokens != null || u.input_tokens != null) acc.input = Math.max(acc.input, num(u.prompt_tokens ?? u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens));
    if (u.completion_tokens != null || u.output_tokens != null) acc.output = Math.max(acc.output, num(u.completion_tokens ?? u.output_tokens));
    acc.cache = Math.max(acc.cache, num(u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens));
  }
  if (o.prompt_eval_count != null || o.eval_count != null) { acc.input = Math.max(acc.input, num(o.prompt_eval_count)); acc.output = Math.max(acc.output, num(o.eval_count)); acc.cache = Math.max(acc.cache, num(o.prompt_eval_cached_count)); }
  const g = o.usageMetadata;
  if (g) { acc.input = Math.max(acc.input, num(g.promptTokenCount)); acc.output = Math.max(acc.output, num(g.candidatesTokenCount) + num(g.thoughtsTokenCount)); acc.cache = Math.max(acc.cache, num(g.cachedContentTokenCount)); }
}
// 回應本文（JSON、SSE 的 data: 行、Ollama 的 NDJSON）→ { model, input, output, cache }；沒有用量回 null
export function usageFromBody(text) {
  const acc = { model: null, input: 0, output: 0, cache: 0 };
  const t = String(text || '').trim();
  try { usageObj(JSON.parse(t), acc); } catch {
    for (const line of t.split('\n')) {
      const s = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      if (!s.startsWith('{')) continue;
      try { usageObj(JSON.parse(s), acc); } catch { /* 不是 JSON 的行 */ }
    }
  }
  return acc.input || acc.output ? acc : null;
}
export function proxyBreaker({ max5m = 600, fails = 8, coolMs = 5 * 60e3 } = {}) {
  const b = { hits: [], fails: 0, until: 0, reason: null };
  return {
    check(now) {
      if (b.until > now) return b.reason;
      b.hits = b.hits.filter((t) => t > now - 5 * 60e3);
      if (b.hits.length >= max5m) { b.until = now + coolMs; b.reason = `5 分鐘內送了 ${b.hits.length} 次請求`; return b.reason; }
      b.hits.push(now);
      return null;
    },
    result(ok, now) {
      b.fails = ok ? 0 : b.fails + 1;
      if (b.fails >= fails) { b.until = now + coolMs; b.reason = `上游連續失敗 ${b.fails} 次`; b.fails = 0; }
    },
  };
}
const HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive', 'upgrade', 'proxy-connection']);
export function startProxy({ upstream, port = PROXY_PORT, home = os.homedir(), env = process.env, fetchFn = fetch, now = Date.now, log = () => {}, guard = null }) {
  const base = proxyUpstream(upstream);
  const file = path.join(agentopsHome({ home, env }), PROXY_FILE);
  const br = proxyBreaker({ max5m: Number(env.AGENTOPS_PROXY_MAX_5M) > 0 ? Number(env.AGENTOPS_PROXY_MAX_5M) : 600 });
  const name = Object.keys(PROXY_UPSTREAMS).find((k) => PROXY_UPSTREAMS[k] === base) || new URL(base).host;
  const server = http.createServer(async (req, res) => {
    // 只接本機呼叫：Host 不是本機就拒絕（擋 DNS rebinding，網頁不能借瀏覽器打進來）
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
    const t = now();
    const why = /^(off|0|false)$/i.test(env.AGENTOPS_BREAKER || '') ? null : br.check(t);
    if (why) {
      if (guard) try { guard.recordTrip(sharedHookDir({ home, env }), { at: new Date(t).toISOString(), tool: `proxy-${name}`, reason: 'proxy', n: 1 }); } catch { /* 記不下來也要擋 */ }
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '300' });
      res.end(JSON.stringify({ error: { type: 'agentops_breaker', message: `[Budgethelm 熔斷] ${why}，接下來 5 分鐘先不轉送，避免空轉燒錢。` } }));
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    let reqModel = null;
    try { reqModel = JSON.parse(body.toString('utf8')).model || null; } catch { /* 不是 JSON */ }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.has(k.toLowerCase())));
    let r;
    try { r = await fetchFn(base + req.url, { method: req.method, headers: { ...headers, 'accept-encoding': 'identity' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }); }
    catch (e) { br.result(false, now()); res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: `Budgethelm 本機代理連不上 ${base}` } })); return; }
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => !HOP.has(k) && k !== 'content-encoding')));
    let seen = '', size = 0;
    const dec = new TextDecoder();
    if (r.body) for await (const c of r.body) { res.write(c); if (size < 8 * 1024 * 1024) { seen += dec.decode(c, { stream: true }); size += c.length; } }
    res.end();
    br.result(r.status < 500 && r.status !== 429, now());
    const u = usageFromBody(seen);
    if (u || r.status >= 400) {
      const row = { id: randomBytes(8).toString('hex'), ts: new Date(t).toISOString(), upstream: name, model: modelName(u?.model || reqModel) || 'unknown',
        input_tokens: u?.input || 0, output_tokens: u?.output || 0, cache_read_tokens: Math.min(u?.cache || 0, u?.input || 0), status: r.status < 400 ? 'ok' : 'error' };
      try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 }); } catch { /* 寫不下也不影響呼叫 */ }
      log(`${row.ts} ${name} ${row.model} in ${row.input_tokens} out ${row.output_tokens}`);
    }
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, base, file })); });
}
export async function proxyEvents(file, { since, folder = true } = {}) {
  const out = [];
  for await (const line of lines(file)) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(r.ts);
    if (!(ts >= since) || !r.id) continue;
    out.push({ ts: new Date(ts).toISOString(), agent: `本機代理 · ${String(r.upstream).slice(0, 40)}`, model: modelName(r.model) || 'unknown',
      input_tokens: num(r.input_tokens), output_tokens: num(r.output_tokens), cache_read_tokens: num(r.cache_read_tokens), cost_usd: null,
      status: r.status === 'error' ? 'error' : 'ok', external_id: `px-${String(r.id).slice(0, 40)}` });
  }
  return out;
}

// ---------- 更多工具的精確用量（2026-11-10）：全部唯讀、格式不對就略過（fail closed），不讀內容 ----------
// Cursor 本機資料庫 state.vscdb 的 cursorDiskKV：bubbleId:<composer>:<bubble> 的 tokenCount.inputTokens／outputTokens、modelInfo.modelName、createdAt。
// ⚠️ Cursor 官方沒公開這個格式（依 getagentseal/codeburn、wakatime-cli 原始碼，2026-11-10 查）；新版常是 0，0 的不算（由 hook 估算補）
export const cursorDbPath = ({ home = os.homedir(), env = process.env, platform = process.platform } = {}) =>
  platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
    : platform === 'win32' ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb')
      : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
export async function cursorDbEvents(file, { since } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'").get();
    if (!has) return [];
    const rows = db.prepare(`SELECT key, json_extract(value, '$.tokenCount.inputTokens') AS i, json_extract(value, '$.tokenCount.outputTokens') AS o,
        json_extract(value, '$.modelInfo.modelName') AS m, json_extract(value, '$.createdAt') AS t
      FROM cursorDiskKV WHERE key LIKE 'bubbleId:%' AND json_valid(value) AND (json_extract(value, '$.tokenCount.inputTokens') > 0 OR json_extract(value, '$.tokenCount.outputTokens') > 0)`).all();
    const out = [];
    for (const r of rows) {
      const ts = typeof r.t === 'number' ? r.t : Date.parse(r.t);
      if (!(ts >= since)) continue;
      out.push({ ts: new Date(ts).toISOString(), agent: 'Cursor', model: modelName(r.m) || 'unknown', input_tokens: num(r.i), output_tokens: num(r.o),
        cache_read_tokens: 0, cost_usd: null, status: 'ok', external_id: `cu-${createHash('sha256').update(String(r.key)).digest('hex').slice(0, 32)}` });
    }
    return out;
  } finally { db.close(); }
}

// Zed：data_dir/threads/threads.db 的 threads 表（data_type 'zstd' 或 'json'），DbThread 的 request_token_usage（每則使用者訊息一筆）與 model。
// ✅ 依 zed-industries/zed crates/agent/src/db.rs、crates/paths/src/paths.rs（main，2026-11-09）。每筆沒有自己的時間，用 thread 的 updated_at。
// zstd 要 Node 22.15+／23.8+ 的 zlib.zstdDecompressSync；沒有就略過那幾筆
export const zedDbPath = ({ home = os.homedir(), env = process.env, platform = process.platform } = {}) =>
  platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Zed', 'threads', 'threads.db')
    : platform === 'win32' ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Zed', 'threads', 'threads.db')
      : path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'zed', 'threads', 'threads.db');
export async function zedEvents(file, { since } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const zlib = await import('node:zlib');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id, updated_at, data_type, data FROM threads ORDER BY updated_at DESC LIMIT 5000').all(); // 時間格式不比字串，下面用 Date.parse 篩
    const out = [];
    for (const r of rows) {
      let t;
      try {
        const buf = Buffer.from(r.data);
        const text = r.data_type === 'zstd' ? (zlib.zstdDecompressSync ? zlib.zstdDecompressSync(buf).toString('utf8') : null) : buf.toString('utf8');
        if (!text) continue;
        t = JSON.parse(text);
      } catch { continue; }
      const ts = Date.parse(r.updated_at);
      if (!(ts >= since) || !t || typeof t.request_token_usage !== 'object') continue;
      const model = modelName(typeof t.model === 'string' ? t.model : t.model?.model) || 'unknown';
      for (const [mid, u] of Object.entries(t.request_token_usage || {})) {
        if (!u || typeof u !== 'object') continue;
        const cr = num(u.cache_read_input_tokens), cw = num(u.cache_creation_input_tokens);
        out.push({ ts: new Date(ts).toISOString(), agent: 'Zed', model, input_tokens: num(u.input_tokens) + cr + cw, output_tokens: num(u.output_tokens),
          cache_read_tokens: cr, cache_write_5m_tokens: cw, cost_usd: null, status: 'ok',
          external_id: `zed-${createHash('sha256').update(`${r.id}\u0000${mid}`).digest('hex').slice(0, 32)}` });
      }
    }
    return out;
  } finally { db.close(); }
}

// Antigravity CLI（agy，取代 Gemini CLI）：~/.gemini/antigravity-cli/conversations/<uuid>.db，每個對話一個 SQLite（WAL）。
// ⚠️ 官方沒公開格式；欄位意義是 agy 1.5.4 實測加對 24 個對話的數字比對（docs/TOOL_MATRIX.md）。blob 是 protobuf，這裡手寫解碼，只取數字與模型名：
//   steps（step_type=15 是模型回覆）.metadata：欄位 9＝用量（2 未快取輸入、5 快取讀取、3 輸出＝9 思考＋10 回覆）、6／7／1＝{秒、奈秒} 時間
//   gen_metadata.data：欄位 3 的子欄位 28＝模型名（多段回覆時只有最後一段有，取對話內第一個有的）
// 使用中的檔直接開會失敗（code 14），所以連 -wal／-shm 複製到暫存資料夾再讀，讀完刪掉。
export function pbFields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let r = 0, m = 1;
    for (let n = 0; n < 10; n++) {
      if (i >= buf.length) throw new Error('truncated');
      const c = buf[i++];
      r += (c & 127) * m; m *= 128;
      if (!(c & 128)) return r;
    }
    throw new Error('varint');
  };
  try {
    while (i < buf.length) {
      const tag = varint(), f = Math.floor(tag / 8), w = tag % 8;
      if (w === 0) out.push([f, varint()]);
      else if (w === 2) { const l = varint(); if (i + l > buf.length) return null; out.push([f, buf.subarray(i, i + l)]); i += l; }
      else if (w === 1) { i += 8; if (i > buf.length) return null; }
      else if (w === 5) { i += 4; if (i > buf.length) return null; }
      else return null;
    }
  } catch { return null; }
  return out;
}
const pbGet = (fields, f) => fields?.find((x) => x[0] === f)?.[1];
export const antigravityDir = ({ home = os.homedir() } = {}) => path.join(home, '.gemini', 'antigravity-cli', 'conversations');
export async function antigravityEvents(dir, { since, folder = true } = {}) {
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.db')); } catch { return []; }
  const { DatabaseSync } = await import('node:sqlite');
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const out = [];
  for (const n of names) {
    const src = path.join(dir, n);
    if (Math.max(mtime(src), mtime(`${src}-wal`)) < since) continue;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-agy-copy-'));
    let db;
    try {
      for (const ext of ['', '-wal', '-shm']) { try { fs.copyFileSync(src + ext, path.join(work, n + ext)); } catch (e) { if (!ext) throw e; } }
      db = new DatabaseSync(path.join(work, n)); // 複本，可寫（WAL 復原要寫 -shm）；原檔不動
      let model = '';
      try {
        for (const g of db.prepare('SELECT data FROM gen_metadata ORDER BY idx').all()) {
          const m = pbGet(pbFields(pbGet(pbFields(Buffer.from(g.data)), 3) || Buffer.alloc(0)), 28);
          if (Buffer.isBuffer(m) && (model = modelName(m.toString('utf8')))) break;
        }
      } catch {}
      const uid = n.replace(/\.db$/, '').slice(0, 60);
      for (const r of db.prepare('SELECT idx, metadata FROM steps WHERE step_type = 15 AND metadata IS NOT NULL ORDER BY idx').all()) {
        const m = pbFields(Buffer.from(r.metadata));
        const u = Buffer.isBuffer(pbGet(m, 9)) ? pbFields(pbGet(m, 9)) : null;
        if (!u) continue;
        const v = (f) => (typeof pbGet(u, f) === 'number' ? pbGet(u, f) : 0);
        const cache = v(5), input = v(2) + cache, output = v(3) || v(9) + v(10);
        let sec = 0;
        for (const f of [6, 7, 1]) { const t = Buffer.isBuffer(pbGet(m, f)) ? pbGet(pbFields(pbGet(m, f)), 1) : 0; if (t > 1e9) { sec = t; break; } }
        if (!sec || sec * 1000 < since || input + output === 0) continue;
        out.push({ ts: new Date(sec * 1000).toISOString(), agent: 'Antigravity CLI', model: model || 'unknown', input_tokens: input, output_tokens: output,
          cache_read_tokens: cache, cost_usd: null, status: 'ok', external_id: `agy-${uid}-${r.idx}`.slice(0, 128) });
      }
    } catch { /* 壞檔、空 db、缺表：略過這個對話，不影響其他 */ }
    finally { try { db?.close(); } catch {} fs.rmSync(work, { recursive: true, force: true }); }
  }
  return out;
}

// Amp：本機 threads/*.json 的 messages[].usage（model、inputTokens、outputTokens、cacheCreationInputTokens、cacheReadInputTokens、timestamp）。
// ⚠️ Amp 官方文件沒寫這些檔案（依 ryoppippi/ccusage 的 amp adapter，2026-11-10 查）；位置 $AMP_DATA_DIR 或 ~/.local/share/amp/threads
export const ampThreadsDir = ({ home = os.homedir(), env = process.env } = {}) => path.join(env.AMP_DATA_DIR || path.join(home, '.local', 'share', 'amp'), 'threads');
export async function ampEvents(dir, { since } = {}) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return out; }
  for (const f of names.map((n) => path.join(dir, n))) {
    let t;
    try { if (fs.statSync(f).mtimeMs < since) continue; } catch { continue; }
    try { if (fs.statSync(f).size > 50 * 1024 * 1024) continue; t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    (Array.isArray(t?.messages) ? t.messages : []).forEach((m, i) => {
      const u = m?.usage;
      const ts = Date.parse(u?.timestamp ?? m?.timestamp);
      if (!u || typeof u !== 'object' || !(ts >= since)) return;
      const cr = num(u.cacheReadInputTokens), cw = num(u.cacheCreationInputTokens);
      out.push({ ts: new Date(ts).toISOString(), agent: 'Amp', model: modelName(u.model) || 'unknown', input_tokens: num(u.inputTokens) + cr + cw, output_tokens: num(u.outputTokens),
        cache_read_tokens: cr, cache_write_5m_tokens: cw, cost_usd: null, status: 'ok',
        external_id: `amp-${createHash('sha256').update(`${t.id || path.basename(f)}\u0000${m.messageId ?? i}`).digest('hex').slice(0, 32)}` });
    });
  }
  return out;
}

// ---------- 選配：Cursor 團隊官方用量 API（2026-11-10）----------
// ✅ cursor.com/docs/account/teams/admin-api：POST https://api.cursor.com/teams/filtered-usage-events，Basic（金鑰當帳號、密碼空白），
// startDate／endDate 毫秒、page、pageSize ≤ 1000；isTokenBasedCall 時有 tokenUsage{inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, totalCents}。
// 團隊管理員在 cursor.com/dashboard 建 Admin API 金鑰，自己存到 ~/.agentops/cursor-admin-key（只有自己能讀）。金鑰只送 api.cursor.com，不送 Budgethelm；
// 成員 email 不上傳（external_id 用雜湊）。每分鐘 60 次的限制：一次最多讀 20 頁
export const CURSOR_ADMIN_KEY_FILE = 'cursor-admin-key';
export async function cursorAdminEvents(keyFile, { since, nowMs = Date.now(), fetchImpl = globalThis.fetch, maxPages = 20 } = {}) {
  let key = '';
  try {
    if (process.platform !== 'win32' && (fs.statSync(keyFile).mode & 0o077)) throw new Error('金鑰檔別人也能讀，請改成只有自己能讀（chmod 600）');
    key = fs.readFileSync(keyFile, 'utf8').trim();
  } catch (e) { if (/chmod/.test(e.message)) throw e; return []; }
  if (!/^[\w.-]{8,300}$/.test(key)) throw new Error('金鑰格式不對');
  const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
  const out = [];
  const start = Math.max(since, nowMs - 30 * DAY_MS);
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchImpl('https://api.cursor.com/teams/filtered-usage-events', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: nowMs, page, pageSize: 1000 }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Cursor Admin API HTTP ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j?.usageEvents)) throw new Error('Cursor Admin API 回應格式變了');
    for (const e of j.usageEvents) {
      const u = e?.tokenUsage;
      const ts = Number(e?.timestamp);
      if (!e?.isTokenBasedCall || !u || !(ts >= since)) continue;
      const cr = num(u.cacheReadTokens), cw = num(u.cacheWriteTokens);
      const cents = Number(u.totalCents);
      out.push({ ts: new Date(ts).toISOString(), agent: 'Cursor 團隊（官方 API）', model: modelName(e.model) || 'unknown',
        input_tokens: num(u.inputTokens) + cr + cw, output_tokens: num(u.outputTokens), cache_read_tokens: cr, cache_write_5m_tokens: cw,
        cost_usd: Number.isFinite(cents) && cents >= 0 ? cents / 100 : null, status: 'ok',
        external_id: `cua-${createHash('sha256').update(JSON.stringify([e.timestamp, e.userEmail, e.model, u.inputTokens, u.outputTokens, cr, cw])).digest('hex').slice(0, 32)}` });
    }
    if (!j.pagination?.hasNextPage) break;
  }
  return out;
}

// ---------- 估算用量（2026-11-10）：守護 hook 寫的 agentops-estimate.jsonl（只有數字），網站的工具名稱後面標「（估算）」，跟精確數字分開 ----------
export const ESTIMATE_FILE = 'agentops-estimate.jsonl';
export const ESTIMATE_SUFFIX = '（估算）';
const EST_NAMES = { cursor: 'Cursor', copilot: 'GitHub Copilot（VS Code）', kiro: 'Kiro', junie: 'JetBrains Junie', goose: 'Goose' };
export async function estimateEvents(file, { since, copilotState = null } = {}) {
  const out = [];
  for (const f of [`${file}.1`, file]) {
    if (!exists(f)) continue;
    for await (const line of lines(f)) {
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const ts = Date.parse(r.at);
      if (!(ts >= since) || !r.id || !EST_NAMES[r.tool]) continue;
      // Copilot CLI 也跑同一份 hook，但它有精確用量（session-state）：同一個 session 就不再算估算，免得重複
      if (r.tool === 'copilot' && copilotState && r.sid && /^[\w.-]{1,100}$/.test(r.sid) && exists(path.join(copilotState, r.sid))) continue;
      out.push({ ts: new Date(ts).toISOString(), agent: `${EST_NAMES[r.tool]}${ESTIMATE_SUFFIX}`, model: modelName(r.model) || 'unknown',
        input_tokens: num(r.in), output_tokens: num(r.out), cache_read_tokens: 0, cost_usd: null, status: 'ok', external_id: `est-${String(r.id).slice(0, 40)}` });
    }
  }
  return out;
}

// ---------- 這台電腦（網站「已連接」）：隨機 id、作業系統、偵測到的工具 id、本地模型名稱；沒有主機名稱、路徑、使用者名稱 ----------
export const osName = (p = process.platform) => (p === 'darwin' ? 'macos' : p === 'win32' ? 'windows' : 'linux');
export function machineId(opts) {
  const f = path.join(agentopsHome(opts), 'machine-id');
  try { const v = fs.readFileSync(f, 'utf8').trim(); if (/^[A-Za-z0-9_-]{16,64}$/.test(v)) return v; } catch { /* 第一次 */ }
  const v = randomBytes(18).toString('base64url');
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, v + '\n', { mode: 0o600 });
  return v;
}
export function machineStatus({ report, local = [], opts = {}, cfg = loadConfig(opts) || {} }) {
  return { machine_id: machineId(opts), os: osName(opts.platform), tools: report.agents.map((a) => a.id),
    hooked: [...(hookInstalled(claudeDir(opts)) ? ['claude-code'] : []), ...Object.keys(TOOL_HOOKS).filter((t) => toolHooked(t, opts)).map((t) => TOOL_HOOKS[t].id)],
    mcp: [...new Set([...(cfg.mcp || []), ...report.agents.filter((a) => a.agentops_mcp === true).map((a) => a.id)])],
    local: local.map((l) => ({ server: l.server, models: l.models })), autostart: cfg.autostart === true, todo: setupTodos({ opts, cfg }) };
}
export async function sendMachine({ url, key, status, fetchFn = fetch }) {
  const r = await fetchFn(`${url}/api/ingest/machine`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(status) });
  if (!r.ok) throw new Error(`電腦狀態上傳失敗（HTTP ${r.status}）`);
}
export async function forgetMachine({ url, key, fetchFn = fetch }) {
  const r = await fetchFn(`${url}/api/ingest/machine/forget`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' });
  return r.ok;
}

// ---------- 還差一步：安裝程式做不到、要客人自己完成的步驟 ----------
// 只上傳 { tool, step }；網站顯示「還差一步」卡片、MCP 回應附提醒、24 小時沒完成寄信。文字跟 lib/setup-steps.mjs 同一份（測試比對）
export const SETUP_STEPS = {
  hook_trust: {
    title: '在 {tool} 按「信任」Budgethelm 守護',
    why: 'Codex 的安全規定：新加的 hook 要你親手信任一次才會執行。背景紀錄監看已經會擋暴衝，按了信任能更早擋下。',
    steps: ['打開終端機，輸入 codex 按 Enter 開啟 Codex。', '在 Codex 裡輸入 /hooks 按 Enter。', '把列表裡 Budgethelm（agentops-guard）的每一條都選「信任」。', '照常用 Codex；守護第一次真的執行後，這個提醒會自動消失。'],
  },
  relogin: {
    title: '登出再登入電腦，讓背景自動執行生效',
    why: '開機自動執行的設定放好了，但這次沒能立刻啟動；沒啟動就不會自動接上新裝的 AI 工具、也不會定時上傳用量。',
    steps: ['存好手邊的工作。', '登出這台電腦的帳號再登入（或重新開機）。', 'Budgethelm 會在背景回報一次，這個提醒就會自動消失。'],
  },
  fix_config: {
    title: '{tool} 的設定檔讀不懂，守護沒接上',
    why: '那個工具的設定檔格式有誤（通常是手動改過的 JSON 少了逗號或括號），Budgethelm 不敢硬改，所以先跳過。',
    steps: ['用文字編輯器打開 {file}，修好格式錯誤。', '重新執行一次安裝指令；背景每 6 小時也會自動重試。', '接上之後這個提醒會自動消失。'],
  },
};
const STEP_TOOL = { 'claude-code': 'Claude Code', codex: 'Codex CLI', 'gemini-cli': 'Gemini CLI', cursor: 'Cursor', agentops: 'Budgethelm' };
const STEP_FILE = { codex: '~/.codex/hooks.json', cursor: '~/.cursor/hooks.json', 'gemini-cli': '~/.gemini/settings.json' };
export const SEEN_FILE = 'agentops-seen.json'; // 守護 hook 第一次在各工具執行的時間（hook 自己寫）
// Codex 的 hook 真的跑過一次＝客人信任過了（hook 第一次執行時寫 agentops-seen.json）。
// 不看系統暫存資料夾的 codex-*.json：測試和手動試跑也會留下，會誤判成已信任
export function codexSeenAt({ opts = {}, cfg = {} } = {}) {
  const t = [Date.parse(cfg.codex_seen_at || '') || 0];
  try { t.push(Date.parse(JSON.parse(fs.readFileSync(path.join(sharedHookDir(opts), SEEN_FILE), 'utf8')).codex || '') || 0); } catch { /* 還沒跑過 */ }
  const at = Math.max(...t);
  return at && at >= (Date.parse(cfg.codex_hooked_at || '') || 0) ? at : 0;
}
export function setupTodos({ opts = {}, cfg = loadConfig(opts) || {} } = {}) {
  const out = [];
  if (toolHooked('codex', opts) && !codexSeenAt({ opts, cfg })) out.push({ tool: 'codex', step: 'hook_trust' });
  for (const t of cfg.hook_errors || []) if (TOOL_HOOKS[t] && !toolHooked(t, opts)) out.push({ tool: TOOL_HOOKS[t].id, step: 'fix_config' });
  if (cfg.autostart_pending) out.push({ tool: 'agentops', step: 'relogin' });
  return out;
}
export function describeStep({ tool, step }) {
  const s = SETUP_STEPS[step];
  const fill = (x) => x.replaceAll('{tool}', STEP_TOOL[tool] || tool).replaceAll('{file}', STEP_FILE[tool] || '那個工具的設定檔');
  return { title: fill(s.title), why: fill(s.why), steps: s.steps.map(fill) };
}
// 安裝結束最後印的待完成清單（醒目：上下框線、終端機支援就上黃色）
export function todoBlock(todos, { color = false } = {}) {
  if (!todos.length) return '';
  const y = (x) => (color ? `\x1b[1;33m${x}\x1b[0m` : x);
  const line = '━'.repeat(44);
  const body = todos.flatMap((t, i) => { const d = describeStep(t); return [y(`${i + 1}. ${d.title}`), `   ${d.why}`, ...d.steps.map((x, j) => `   ${'①②③④⑤'[j] || `${j + 1}.`} ${x}`)]; });
  return [y(line), y(`⚠️  還差 ${todos.length} 步才算裝好（網站和 AI 工具也會提醒你，完成後自動消失）`), '', ...body, y(line)].join('\n');
}

// ---------- AI 工具設定檔的資安掃描：MCP 設定裡寫死的 API key 最常見 ----------
// 只上傳類型、嚴重度、相對家目錄的檔名、行號；值不離開這台電腦。我們自己寫進去的 Budgethelm 權杖不算
export function toolConfigFiles({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const desktop = platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude') : platform === 'win32' ? path.join(appData, 'Claude') : path.join(home, '.config', 'Claude');
  return [path.join(home, '.claude.json'), path.join(claudeDir({ home, env }), 'settings.json'), path.join(desktop, 'claude_desktop_config.json'),
    path.join(home, '.cursor', 'mcp.json'), path.join(home, '.gemini', 'settings.json'), path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'),
    path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), path.join(home, '.continue', 'config.yaml'), path.join(home, '.continue', 'config.json')].filter(isFile);
}
export function scanToolConfigs({ lineSecrets, home = os.homedir(), env = process.env, platform = process.platform }) {
  const out = [];
  for (const f of toolConfigFiles({ home, env, platform })) {
    let text;
    try { if (fs.statSync(f).size > 5 * 1024 * 1024) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const file = path.relative(home, f).split(path.sep).join('/');
    text.split(/\r?\n/).forEach((l, i) => {
      for (const s of lineSecrets(l)) if (!/^(?:Budgethelm|AgentOps) 金鑰$/.test(s.label) && out.length < 200) out.push({ type: s.type, severity: s.severity, file, line: i + 1, label: s.label });
    });
  }
  return out;
}
export const CONFIG_SCAN_LABEL = 'AI 工具設定';

// ---------- 一行安裝流程（--setup）：裝置授權碼 → 綁定帳號 → 全部裝好，不用回答任何問題 ----------
export async function deviceStart({ url, os: osn, fetchFn = fetch }) {
  const r = await fetchFn(`${url}/api/device/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ os: osn }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || `連不上 Budgethelm（HTTP ${r.status}）`);
  return b;
}
export async function devicePoll({ url, deviceCode, machine, replace = '', interval = 3, expiresIn = 600, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), nowMs = Date.now }) {
  const until = nowMs() + expiresIn * 1000;
  let wait = interval;
  while (nowMs() < until) {
    await sleep(wait * 1000);
    let r;
    try { r = await fetchFn(`${url}/api/device/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: deviceCode, machine_id: machine, ...(replace ? { replace } : {}) }) }); }
    catch { continue; } // 網路斷一下就再試
    const b = await r.json().catch(() => ({}));
    if (r.status === 429) { wait = Math.min(wait + 5, 30); continue; }
    if (r.ok && b.status === 'pending') continue;
    if (r.ok && b.key) return b;
    throw new Error(b.error || `授權失敗（HTTP ${r.status}）`);
  }
  throw new Error('等了 10 分鐘還沒按授權，請重新執行安裝指令');
}
export function openBrowser(u, { env = process.env, platform = process.platform, run = spawnSync } = {}) {
  if (env.AGENTOPS_NO_BROWSER === '1') return false;
  const [cmd, args] = platform === 'darwin' ? ['open', [u]] : platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', u]] : ['xdg-open', [u]];
  try { return run(cmd, args, { stdio: 'ignore', timeout: 15_000 }).status === 0; } catch { return false; }
}
// 解除安裝的入口：Mac 放一個點兩下就能跑的 .command 在 ~/Applications；Linux 放 ~/.agentops/uninstall.sh；Windows 放 ~/.agentops/uninstall.cmd
export function uninstallerFiles({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (platform === 'darwin') return [path.join(home, 'Applications', 'Budgethelm 解除安裝.command')];
  if (platform === 'linux') return [path.join(agentopsHome({ home, env }), 'uninstall.sh')];
  if (platform === 'win32') return [path.join(agentopsHome({ home, env }), 'uninstall.cmd')];
  return [];
}
// Windows 的 .cmd 用系統碼頁讀（中文 Windows 是 950），所以只放 ASCII：路徑一律用 %~dp0（.cmd 所在的 ~/.agentops）；
// cmd 是邊跑邊讀檔，Node 不刪它，最後一行自己刪掉（(goto) 技巧，不會跳「找不到批次檔」）
export const winUninstallCmd = ({ node, dir }) => {
  const inside = path.win32.relative(dir, node);
  const n = inside && !inside.startsWith('..') && !path.win32.isAbsolute(inside) ? `%~dp0${inside}` : node;
  return ['@echo off', 'rem Budgethelm uninstall: removes hooks, MCP settings, autostart; revokes this computer\'s key',
    'set AGENTOPS_HOME=%~dp0.', 'set AGENTOPS_FROM_UNINSTALLER=1', `"${n}" "%~dp0agentops-connect.mjs" --uninstall --yes`,
    'if exist "%~dp0node" rmdir /s /q "%~dp0node"', 'echo.', 'echo Budgethelm removed. You can close this window.', 'pause',
    '(goto) 2>nul & del "%~f0" & rmdir "%~dp0." 2>nul', ''].join('\r\n');
};
export function writeUninstaller({ node = process.execPath, script, home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const files = uninstallerFiles({ home, env, platform });
  for (const f of files) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (platform === 'win32') { fs.writeFileSync(f, winUninstallCmd({ node, dir: path.dirname(f) })); continue; }
    fs.writeFileSync(f, `#!/bin/sh\n# Budgethelm 解除安裝：拿掉 hook、MCP 設定、開機自動執行，撤銷這台電腦的金鑰\n"${node}" "${script}" --uninstall --yes\necho\necho "Budgethelm 已移除，可以關掉這個視窗了。"\n`, { mode: 0o755 });
    fs.chmodSync(f, 0o755);
  }
  for (const f of legacyUninstallers({ home, platform })) fs.rmSync(f, { force: true }); // 換成新名字後，舊名那個不留
  return files;
}
// 改名前（AgentOps）放在 Mac 的解除安裝檔：重裝或解除安裝時一起刪掉，不會留兩個
export const legacyUninstallers = ({ home = os.homedir(), platform = process.platform } = {}) =>
  platform === 'darwin' ? [path.join(home, 'Applications', 'AgentOps 解除安裝.command')] : [];
// 一行安裝下載的可攜版 Node（~/.agentops/node）：解除安裝時刪掉；Windows 正在用它跑的話刪不掉，交給 uninstall.cmd 收尾
export function removePortableNode({ home = os.homedir(), env = process.env, platform = process.platform, execPath = process.execPath } = {}) {
  const d = path.join(agentopsHome({ home, env }), 'node');
  if (!exists(d)) return false;
  const rel = path.relative(d, execPath);
  if (platform === 'win32' && rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return false;
  fs.rmSync(d, { recursive: true, force: true });
  return true;
}

// ---------- 命令列 ----------
export function parseArgs(argv) {
  const o = { days: 30, send: false, install: false, uninstall: false, yes: false, json: false, folder: true, url: null, pair: null, tick: false, autostart: true, scan: null, audit: true, setup: false, watch: false, watchSvc: true, proxy: null, port: PROXY_PORT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send') o.send = true;
    else if (a === '--install') o.install = true;
    else if (a === '--uninstall') o.uninstall = true;
    else if (a === '--tick') o.tick = true;
    else if (a === '--setup') o.setup = true;
    else if (a === '--watch') o.watch = true;
    else if (a === '--no-watch') o.watchSvc = false;
    else if (a === '--proxy') o.proxy = argv[++i] || '';
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--no-autostart') o.autostart = false;
    else if (a === '--scan') o.scan = argv[++i] || '.';
    else if (a === '--no-audit') o.audit = false;
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--json') o.json = true;
    else if (a === '--no-folder') o.folder = false;
    else if (a === '--days') o.days = Number(argv[++i]);
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--pair') o.pair = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`不認得的選項：${a}`);
  }
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > 400) throw new Error('--days 要是 1 到 400 的整數');
  if (o.uninstall && (o.install || o.send || o.pair)) throw new Error('--uninstall 不能跟 --install、--send、--pair 一起用');
  if (o.scan != null && (o.install || o.uninstall || o.tick)) throw new Error('--scan 只能跟 --send、--pair、--yes 一起用');
  if (o.setup && (o.install || o.uninstall || o.send || o.pair || o.tick || o.scan != null)) throw new Error('--setup 是安裝指令用的，不能跟其他動作一起用');
  if (o.tick && (o.install || o.uninstall || o.send || o.pair)) throw new Error('--tick 是背景定時用的，不能跟其他動作一起用');
  if ((o.watch || o.proxy != null) && (o.install || o.uninstall || o.send || o.pair || o.tick || o.setup || o.scan != null)) throw new Error('--watch、--proxy 是常駐程式，不能跟其他動作一起用');
  if (o.proxy != null) proxyUpstream(o.proxy);
  if (!Number.isInteger(o.port) || o.port < 1024 || o.port > 65535) throw new Error('--port 要是 1024 到 65535 的整數');
  if (o.pair != null && !/^aopp_[A-Za-z0-9_-]{20,90}$/.test(o.pair)) throw new Error('--pair 要接 aopp_ 開頭的配對碼（在 AI 工具說「用 Budgethelm 健檢」取得）');
  return o;
}

function ask(q, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (v) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(v.trim()); });
  });
}

function printReport(s, url, sample) {
  const log = console.log;
  log('\n找到的 AI 工具：');
  for (const t of s.tools) log(`  - ${t.name}：${t.usage}${t.agentops_mcp === true ? '，已接 Budgethelm MCP' : t.agentops_mcp === false ? '，還沒接 Budgethelm MCP' : ''}`);
  if (!s.tools.length) log('  （沒找到）');
  log(`\n服務商：${s.providers.join('、') || '（沒找到）'}`);
  if (s.provider_env.length) log(`  依據環境變數名稱：${s.provider_env.map((p) => p.env.join('/')).join('、')}（只看名稱，沒有讀值）`);
  log(`\nagent（${s.agents.length} 個）：`);
  for (const [a, n] of s.agents.slice(0, 20)) log(`  - ${a}：${n} 筆`);
  if (s.agents.length > 20) log(`  …另外 ${s.agents.length - 20} 個`);
  log(`\n模型：${s.models.map(([m, n]) => `${m}（${n}）`).join('、') || '（無）'}`);
  log(`共 ${s.events} 筆、${s.tokens.toLocaleString()} tokens，目的地：${url}`);
  if (s.local?.length) for (const l of s.local) log(`本地模型 ${l.server}：正在跑 ${l.models.join('、') || '（沒有）'}${l.installed?.length ? `；已下載 ${l.installed.length} 個` : ''}${l.tokens ? `；累計 ${l.tokens.prompt?.toLocaleString()} 輸入／${l.tokens.output?.toLocaleString()} 輸出 token` : ''}（${l.note}）`);
  if (sample) log(`\n每筆會送的欄位（範例）：\n  ${JSON.stringify(sample)}`);
}

const yesNo = async (o, q) => {
  if (o.yes) return true;
  if (!process.stdin.isTTY) throw new Error('非互動環境請加 --yes 確認');
  return /^y(es)?$/i.test(await ask(q));
};
// 用 claude 自己的指令接／拆 MCP，不直接改它的設定檔
const claudeBin = () => findBin(['claude']);
const claudeMcp = (args) => { const b = claudeBin(); return !!b && spawnSync(b, ['mcp', ...args], { stdio: 'inherit', shell: /\.(cmd|bat)$/i.test(b) }).status === 0; };

// 一行安裝指令（install.sh／install.ps1）跑這個：客戶已經用「貼上指令執行」同意安裝，接下來只在瀏覽器按一次授權
async function setup({ url, log = console.log }) {
  const opts = { home: os.homedir(), env: process.env };
  const node = process.execPath;
  const script = path.join(agentopsHome(), 'agentops-connect.mjs');
  if (path.resolve(fileURLToPath(import.meta.url)) !== path.resolve(script)) {
    fs.mkdirSync(agentopsHome(), { recursive: true, mode: 0o700 });
    fs.copyFileSync(fileURLToPath(import.meta.url), script);
  }
  const machine = machineId();
  log('Budgethelm：連接這台電腦');
  const st = await deviceStart({ url, os: osName() });
  log(`\n請在瀏覽器登入 Budgethelm，確認畫面上的碼是 ${st.user_code}，再按「授權」。`);
  log(openBrowser(st.verification_uri_complete) ? '（已經幫你打開瀏覽器）' : `瀏覽器沒有自動打開，請手動打開：${st.verification_uri_complete}`);
  const t = await devicePoll({ url, deviceCode: st.device_code, machine, replace: loadSavedKey(), interval: st.interval, expiresIn: st.expires_in });
  saveKey(t.key);
  log(`\n已授權，這台電腦接到專案「${t.project.name}」。`);

  const report = detect();
  log(`找到的 AI 工具：${report.agents.map((a) => a.name).join('、') || '（還沒有）'}`);
  // 守護 hook：找到的工具都接上（Claude Code 沒裝也先放好，之後裝了就生效）
  const source = await fetchText(`${url}/agentops-guard.mjs`);
  let profile = null;
  try { profile = await fetchProfile({ url, key: t.key }); } catch { /* 先用預設全開 */ }
  const cc = report.agents.some((a) => a.id === 'claude-code');
  if (cc) { installHook({ dir: claudeDir(), source, profile, node }); log('已接上守護：Claude Code'); }
  const tools = hookableTools(report);
  const hookErrors = [];
  let codexChanged = false;
  if (tools.length) {
    const codexFile = TOOL_HOOKS.codex.file(opts);
    const before = (() => { try { return fs.readFileSync(codexFile, 'utf8'); } catch { return null; } })();
    const r = installToolHooks({ tools, source, node });
    try { codexChanged = r.done.some((d) => d.tool === 'codex' && !d.error) && fs.readFileSync(codexFile, 'utf8') !== before; } catch { /* 沒寫成 */ }
    hookErrors.push(...r.done.filter((d) => d.error).map((d) => d.tool));
    if (profile) writeProfile(agentopsHome(), profile);
    for (const d of r.done) log(d.error ? `${TOOL_HOOKS[d.tool].name} 守護沒接上：${d.error}` : `已接上守護：${TOOL_HOOKS[d.tool].name}`);
    if (r.done.some((d) => d.tool === 'codex' && !d.error)) log('  Codex：不用手動信任。背景的紀錄監看會盯著 Codex（含 codex exec），一直出錯或空轉就停下；你在 /hooks 按了信任的話，會更早擋下。');
  }
  // MCP：帶權杖寫進各工具，不用在工具裡點授權
  const mcpDone = [];
  if (t.mcp_token) {
    for (const d of registerMcp({ report, url, token: t.mcp_token, claudeBin: claudeBin() })) {
      const name = report.agents.find((a) => a.id === d.id)?.name || d.id;
      if (d.error) log(`${name} 的 Budgethelm MCP 沒接上：${d.error}`);
      else { if (!d.skipped) mcpDone.push(d.id); log(`Budgethelm MCP：${name}${d.skipped ? '（已經接過）' : ''}`); }
    }
  } else log('MCP 權杖已達上限（每人 10 個），這次沒接 MCP；可到網站「MCP 進階設定」撤銷不用的再重裝。');
  // 用量、熔斷紀錄、基線
  const events = await collect(report, { days: 30 });
  if (events.length) { const r = await send(events, { url, key: t.key }); log(`已上傳用量：${r.accepted} 筆（時間、模型、token 數；沒有對話內容）`); }
  try { await sendTrips(readTrips(hookDirs()), { url, key: t.key }); } catch { /* 下次再送 */ }
  writeBaseline(hookDirs(), computeBaseline(events.filter((e) => Date.parse(e.ts) > Date.now() - 14 * DAY_MS)));
  // 資安掃描：AI 工具設定檔裡有沒有寫死的金鑰（值不上傳）
  try {
    const sc = await loadScanner({ url });
    const f = scanToolConfigs({ lineSecrets: sc.lineSecrets });
    await sendFindings({ url, key: t.key, label: CONFIG_SCAN_LABEL, findings: sc.uploadable(f) });
    log(f.length ? `資安：AI 工具設定檔有 ${f.length} 處疑似寫死的金鑰，到網站「問題」看是哪個檔案第幾行。` : '資安：AI 工具設定檔沒有發現寫死的金鑰。');
  } catch (e) { log(`資安掃描這次沒跑完（${e.message}），背景定時會再試。`); }
  // 開機自動執行
  const known = [...(cc ? ['claude'] : []), ...tools];
  // Codex 的 hook 設定有變（第一次裝、或 Node 路徑換了）就要重新信任；沒變就沿用上次的確認
  const prev = loadConfig() || {};
  const codexState = codexChanged ? { codex_hooked_at: new Date().toISOString() } : { codex_hooked_at: prev.codex_hooked_at, codex_seen_at: prev.codex_seen_at };
  saveConfig({ autostart: true, url, known, mcp: mcpDone, consented_at: new Date().toISOString(), via: 'installer', scanned_at: new Date().toISOString(), hook_errors: hookErrors, ...codexState, watch: true });
  if (watchableTools(report).length) {
    const w = installWatch({ script, node });
    log(w.supported ? (w.loaded ? '已開啟紀錄監看（Codex 不用在 /hooks 按信任也會被擋暴衝）。' : '紀錄監看的設定放好了，重新登入後生效。') : '這個作業系統還不支援紀錄監看，Codex 要在 /hooks 按信任才有熔斷。');
  }
  const a = process.platform === 'darwin' ? installAutostart({ url, self: script }) : installAutostartOther({ url, script, node });
  if (a.supported && !a.loaded) saveConfig({ ...loadConfig(), autostart_pending: true });
  log(a.supported ? (a.loaded ? '已設定開機自動執行（登入時和每 6 小時）。' : '開機自動執行的設定放好了，重新登入後生效。') : '這個作業系統還不支援開機自動執行。');
  const un = writeUninstaller({ node, script });
  // 告訴網站「這台電腦已連接」
  const local = await localModels();
  try { await sendMachine({ url, key: t.key, status: machineStatus({ report: detect(), local }) }); } catch (e) { log(`網站狀態沒更新（${e.message}），背景定時會再送。`); }
  const todos = setupTodos({ opts });
  log(`\n完成。回到網站就會看到「這台電腦已連接」。新開一個 AI 工具的對話就會生效。`);
  log(un.length ? `要解除安裝：點兩下 ${un[0]}` : `要解除安裝：node ${script} --uninstall`);
  // 要客人自己做的步驟放最後，免得被上面的訊息蓋過去
  if (todos.length) log(`\n${todoBlock(todos, { color: process.stdout.isTTY && !process.env.NO_COLOR })}`);
  return { project: t.project, tools: report.agents.map((a) => a.id), mcp: mcpDone, todo: todos };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n'); console.log(src.slice(1, src.findIndex((l) => l.startsWith('import '))).join('\n').replace(/^\/\/ ?/gm, '')); return; }
  const url = (o.url || process.env.AGENTOPS_URL || loadConfig()?.url || DEFAULT_URL).replace(/\/+$/, '');
  if (!/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error('網址必須是 https（本機測試可用 http://127.0.0.1）');
  if (o.setup) { await setup({ url }); return; }
  if (o.watch) { console.log(`${new Date().toISOString()} Budgethelm 紀錄監看開始（${Object.values(WATCHERS).map((w) => w.name).join('、')}）`); await watch(); return; }
  if (o.proxy != null) {
    const p = await startProxy({ upstream: o.proxy, port: o.port, guard: await loadGuard(), log: console.log });
    console.log(`Budgethelm 本機計數代理：http://127.0.0.1:${p.port} → ${p.base}\n把程式的 base URL 改成上面的網址就會記 token 數（存在 ${p.file}，背景定時上傳）。金鑰照常放在請求裡，只經過這台電腦。Ctrl-C 結束。`);
    return;
  }
  if (o.tick) { const st = await tick({ url }); console.log(`${st.at} 工具 ${st.tools.length} 個、已接熔斷 ${st.hooked.join(',') || '無'}${st.added.length ? `、新接上 ${st.added.join(',')}` : ''}、本地模型 ${st.local.map((l) => `${l.server}(${l.models.length})`).join(',') || '無'}${st.sent ? `、用量新增 ${st.sent.accepted} 筆` : ''}`); return; }
  if (o.scan != null) {
    const sc = await loadScanner({ url });
    const r = await sc.scanProject(o.scan, { audit: o.audit });
    const up = sc.uploadable(r.findings);
    if (o.json) console.log(JSON.stringify({ root: r.root, files: r.files, audits: r.audits, findings: up }, null, 1)); else sc.printScan(r);
    if (!o.send) { if (!o.json) console.log('\n這次只在本機掃描，沒有送出。加 --send 把「類型、嚴重度、檔名、行號」送到 Budgethelm。'); return; }
    let key = process.env.AGENTOPS_KEY || '';
    if (!key && o.pair) { const p = await pair({ url, code: o.pair, replace: loadSavedKey() }); key = p.key; saveKey(key); }
    key = key || loadSavedKey();
    if (!key) throw new Error('沒有匯入金鑰：先跑一次健檢配對，或用環境變數 AGENTOPS_KEY');
    if (!(await yesNo(o, `要把這 ${up.length} 筆（只有類型、嚴重度、檔名、行號）送到 ${url} 嗎？(y/N) `))) { console.log('沒有送出。'); return; }
    const b = await sendFindings({ url, key, label: scanLabel(o.scan), findings: up });
    console.log(`已送出 ${b.accepted} 筆資安結果（專案資料夾「${scanLabel(o.scan)}」，會取代上一次的結果）。`);
    return;
  }
  const report = detect();
  const cc = report.agents.find((a) => a.id === 'claude-code');
  const hasClaude = !!claudeBin();

  if (o.uninstall) {
    if (!(await yesNo(o, `要移除 Budgethelm 的 hook、優化設定、開機自動啟動${cc?.agentops_mcp ? '和 Claude Code 的 Budgethelm MCP' : ''}嗎？(y/N) `))) { console.log('沒有移除。'); return; }
    const r = uninstallHook();
    console.log(r.settingsChanged ? `已從 ${r.settingsPath} 拿掉 hook（備份：${r.backup}）` : 'Claude Code 的 settings.json 裡沒有 Budgethelm hook。');
    if (r.removed.length) console.log(`已刪除：${r.removed.join('、')}`);
    const t = uninstallToolHooks();
    for (const c of t.changed) console.log(`已從 ${c.file} 拿掉 hook（備份：${c.backup}）`);
    if (t.removed.length) console.log(`已刪除：${t.removed.join('、')}`);
    const a = uninstallAutostart();
    if (a.removed) console.log(`已移除開機自動啟動（${a.plist}）`);
    if (uninstallAutostartOther().removed) console.log('已移除開機自動執行。');
    const wu = uninstallWatch();
    if (wu.removed) console.log(`已移除紀錄監看（${wu.file}）`);
    const cfgNow = loadConfig() || {};
    for (const m of unregisterMcp({ ids: (cfgNow.mcp || []).filter((x) => x !== 'claude-code'), claudeBin: claudeBin() })) if (m.ok) console.log(`已從 ${m.file} 拿掉 Budgethelm MCP${m.backup ? `（備份：${m.backup}）` : ''}`);
    const savedKey = loadSavedKey();
    if (savedKey && (cfgNow.url || process.env.AGENTOPS_URL)) {
      try { if (await forgetMachine({ url: (process.env.AGENTOPS_URL || cfgNow.url).replace(/\/+$/, ''), key: savedKey })) console.log('已在 Budgethelm 撤銷這台電腦的匯入金鑰和安裝時發的 MCP 權杖。'); } catch { console.log('連不上 Budgethelm，金鑰沒撤銷；可到網站「接入」頁按「中斷連接」。'); }
    }
    // Windows 的 uninstall.cmd 正在跑時由它自己刪
    if (!(process.platform === 'win32' && process.env.AGENTOPS_FROM_UNINSTALLER === '1')) for (const f of [...uninstallerFiles(), ...legacyUninstallers()]) fs.rmSync(f, { force: true });
    if (removePortableNode()) console.log('已刪除 Budgethelm 下載的 Node.js（~/.agentops/node）。');
    const files = ['config.json', 'status.json', 'agent.log', 'setup.log', 'machine-id', 'agentops-scan.mjs', 'agentops-workspace-rules.mjs', 'agentops-connect.mjs', 'watch.log', PROXY_FILE].map((f) => path.join(agentopsHome(), f)).filter((f) => { if (!exists(f)) return false; fs.rmSync(f); return true; });
    if (files.length) console.log(`已刪除：${files.join('、')}`);
    if ((cc?.agentops_mcp || (cfgNow.mcp || []).includes('claude-code')) && hasClaude && !claudeMcp(['remove', 'agentops', '-s', 'user'])) console.log('MCP 沒拆掉，請自己跑：claude mcp remove agentops -s user');
    if (loadSavedKey()) { fs.rmSync(savedKeyPath(), { force: true }); console.log(`已刪除本機保存的匯入金鑰（${savedKeyPath()}）。`); }
    for (const d of [sharedHookDir(), agentopsHome()]) { try { fs.rmdirSync(d); } catch { /* 裡面還有客戶自己的檔案或備份就留著 */ } }
    return;
  }

  const events = await collect(report, { days: o.days, folder: o.folder });
  const s = { ...summarize(report, events), local: await localModels() };
  if (o.json) console.log(JSON.stringify({ ...s, billing: billingMode(), url }, null, 1));
  else { printReport(s, url, events[0]); const bl = billingLine(billingMode()); if (bl) console.log(`\n${bl}`); }
  if (!o.send && !o.install) {
    if (!o.json) console.log('\n這次只偵測，沒有送出。確認沒問題後加 --send 回報，或加 --install 裝好 hook 與 MCP。');
    return;
  }
  let key = process.env.AGENTOPS_KEY || '';
  if (!key && o.pair && (o.send || o.install)) {
    const r = await pair({ url, code: o.pair, replace: loadSavedKey() });
    key = r.key;
    saveKey(key);
    console.log(`\n已配對專案「${r.project.name}」，匯入金鑰存在 ${savedKeyPath()}（只有你能讀；下次直接跑就好）。`);
  }
  if (!key) key = loadSavedKey();
  const getKey = async () => {
    if (!key) {
      if (!process.stdin.isTTY) throw new Error('請用環境變數 AGENTOPS_KEY 提供匯入金鑰');
      key = await ask('貼上專案的匯入金鑰（aops_ 開頭，不會顯示；只能上傳計數，不能呼叫模型）：', { hidden: true });
    }
    if (!key.startsWith('aops_')) throw new Error('匯入金鑰要是 aops_ 開頭（在 Budgethelm「接入」頁建立）');
    return key;
  };

  if (o.send) {
    if (!events.length) console.log('\n沒有可以回報的用量。');
    else {
      await getKey();
      if (await yesNo(o, `\n要把這 ${events.length} 筆送到 ${url} 嗎？(y/N) `)) {
        const r = await send(events, { url, key, onBatch: (n, all) => process.stdout.write(`\r已送 ${n}/${all}`) });
        console.log(`\n完成：新增 ${r.accepted} 筆，重複略過 ${r.duplicates} 筆（重跑不會重複計算）。`);
        const trips = readTrips(hookDirs());
        if (trips.length) { const t = await sendTrips(trips, { url, key }); console.log(`熔斷紀錄：新增 ${t.accepted} 筆（只有時間、原因、次數、模型與 token 數）。`); }
      } else console.log('沒有送出。');
    }
  }

  if (o.install) {
    const dir = claudeDir();
    const mcpTodo = hasClaude && cc?.agentops_mcp !== true;
    const tools = hookableTools(report);
    const auto = o.autostart && process.platform === 'darwin';
    console.log(`\n要安裝（都在這台電腦，設定檔先備份；不讀、不送任何金鑰和對話內容）：\n  - Claude Code 守護 hook → ${path.join(dir, 'hooks', 'agentops-guard.mjs')}（一直出錯、空轉時自動停下）`);
    for (const t of tools) console.log(`  - ${TOOL_HOOKS[t].name} 守護 hook → ${TOOL_HOOKS[t].file({ home: os.homedir(), env: process.env })}${t === 'cursor' ? '（Cursor 不能被外部停下，會要求 agent 停手）' : ''}`);
    if (mcpTodo) console.log(`  - Claude Code 的 Budgethelm MCP（claude mcp add --transport http -s user agentops ${url}/api/mcp）`);
    if (auto) console.log(`  - 開機自動啟動（${plistPath()}）：登入時和每 6 小時，接上新裝的 AI 工具、看本地模型（Ollama、LM Studio）有沒有開、上傳用量數字`);
    const watchTodo = auto && o.watchSvc && watchableTools(report).length > 0;
    if (watchTodo) console.log(`  - 紀錄監看（${watchPlistPath()}）：讀 Codex 的對話紀錄，一直出錯或空轉就停下那個 Codex（含 codex exec），不用在 /hooks 按信任`);
    if (!(await yesNo(o, '確定安裝嗎？(y/N) '))) { console.log('沒有安裝。'); return; }
    const source = await fetchText(`${url}/agentops-guard.mjs`);
    let profile = null;
    if (key || process.stdin.isTTY) {
      try { profile = await fetchProfile({ url, key: await getKey() }); } catch (e) { console.log(`優化設定沒下載到（${e.message}），hook 先用預設全開。`); }
    }
    const r = installHook({ dir, source, profile });
    const base = computeBaseline(await collect(report, { days: 14, folder: false }));
    console.log(`已安裝 hook：${r.hookPath}${r.backup ? `（settings.json 備份：${r.backup}）` : ''}`);
    if (tools.length) {
      const t = installToolHooks({ tools, source });
      if (profile) writeProfile(agentopsHome(), profile);
      for (const d of t.done) console.log(d.error ? `${TOOL_HOOKS[d.tool].name} 沒接上：${d.error}` : `已接上 ${TOOL_HOOKS[d.tool].name}：${d.file}${d.backup ? `（備份：${d.backup}）` : ''}`);
      if (t.done.some((d) => d.tool === 'codex' && !d.error) && !watchTodo) console.log('Codex 的安全規定：沒開紀錄監看時，要在 Codex 輸入 /hooks，把 Budgethelm 那幾條按「信任」才會生效。');
    }
    const known = [...(hasClaude || cc ? ['claude'] : []), ...tools];
    if (auto) {
      saveConfig({ autostart: true, url, known, consented_at: new Date().toISOString(), watch: watchTodo });
      const a = installAutostart({ url, self: fileURLToPath(import.meta.url) });
      console.log(a.loaded ? `已設定開機自動啟動：${a.plist}` : `開機自動啟動的設定檔放好了（${a.plist}），但這次沒載入成功；重新登入後會生效。`);
      if (watchTodo) { const w = installWatch({ script: a.script }); console.log(w.loaded ? `已開啟紀錄監看：${w.file}` : `紀錄監看的設定檔放好了（${w.file}），重新登入後會生效。`); }
    } else saveConfig({ autostart: false, url, known, consented_at: new Date().toISOString() });
    const bd = writeBaseline(hookDirs(), base);
    console.log(bd.length ? `token 速率基線：平常 5 分鐘約 ${base.rate5m_p95.toLocaleString()} token（p95，${base.buckets} 段），超過 6 倍會自動停下。` : '紀錄還不夠算 token 速率基線（至少 30 段 5 分鐘），先不檢查速率。');
    const local = await localModels();
    if (local.length) console.log(`本地模型：${local.map((l) => `${l.server}${l.models.length ? `（正在跑 ${l.models.join('、')}）` : '（開著，沒有載入模型）'}`).join('；')}`);
    if (profile) console.log(`已套用優化設定：${profile.tips.length ? profile.tips.join(' ') : '目前沒有特別要提醒的'}`);
    if (mcpTodo && !claudeMcp(['add', '--transport', 'http', '-s', 'user', 'agentops', `${url}/api/mcp`])) console.log(`MCP 沒接上，請自己跑：claude mcp add --transport http -s user agentops ${url}/api/mcp`);
    if (!hasClaude) console.log('沒找到 claude 指令：hook 已放好，裝了 Claude Code 之後就會生效。');
    const others = report.agents.filter((a) => a.id !== 'claude-code' && a.agentops_mcp === false).map((a) => a.name);
    if (others.length) console.log(`${others.join('、')} 要接 MCP：到 Budgethelm「接入」頁複製設定。`);
    console.log('完成。新開一個對話就會生效；到 Budgethelm 總覽看結果。要全部移除：node ~/.agentops/agentops-connect.mjs --uninstall');
  } else if (o.send && key && hookInstalled()) {
    // 已經裝過 hook：順便更新優化設定，形成「上傳 → 診斷 → 更新提醒」的閉環
    try { writeProfile(claudeDir(), await fetchProfile({ url, key })); console.log('已更新本機優化設定。'); } catch (e) { console.log(`優化設定沒更新（${e.message}）。`); }
    writeBaseline(hookDirs(), computeBaseline(events));
  }
}

// realpath：放在符號連結路徑下也要能跑
let isMain = false;
try { isMain = fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* 被 import */ }
if (isMain) {
  // 做完就結束：先等輸出寫完再 exit，不讓還開著的連線（fetch keep-alive）或子行程把終端機卡住
  const done = (code) => process.stdout.write('', () => process.exit(code));
  main().then(() => done(process.exitCode ?? 0), (e) => { console.error(`錯誤：${e.message}`); done(1); });
}
