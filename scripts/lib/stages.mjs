// What a model call was for, read from the tools it called: a call with several tools takes the first
// stage in PRIORITY, a call without tools is an answer. Ported from the efficiency metrics of the Wayfarer
// project, with its project-specific tools taken out. A subagent's calls all count to its agent (the
// architect, or the other subagents), so the stages of the main session add up with them to the total.

export const PRIORITY = ['architect', 'subagent', 'edit', 'docs', 'validate', 'design', 'web', 'explore', 'other', 'service', 'ask'];

// The rows the page shows, in this order; `ask` (questions to the user) joins the service row.
export const STAGES = ['explore', 'edit', 'docs', 'validate', 'architect', 'subagent', 'design', 'web', 'answer', 'other', 'service'];

const VALIDATE_SEGMENT =
  /^((npx|pnpm|yarn|bunx?)\s+(--no-install\s+)?)?(nx\s+(run|run-many|affected)\b|turbo\s+run\b|tsc\b|vue-tsc\b|eslint\b|biome\b|prettier\s+--check\b|jest\b|vitest\b|playwright\s+test\b|cypress\s+run\b|maestro\s+test\b|mocha\b)|^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|type-check|check|e2e|verify)\b|^node\s+--test\b|^(pytest|mypy|ruff|flake8|tox)\b|^python3?\s+-m\s+(pytest|mypy|unittest)\b|^(cargo\s+(test|check|clippy)|go\s+(test|vet)|swift\s+test|xcodebuild\s+test|(\.\/)?gradlew?\s+(test|check|lint)|mvn\s+(test|verify)|make\s+(test|check|lint))\b/;
const EDIT_SEGMENT = /^(sed\s+-i|perl\s+-\w*i|mv|cp|mkdir|rm|touch|ln|git\s+(mv|rm|apply))\b/;
// A python or node script that writes files is an edit made by script.
const SCRIPT_SEGMENT = /^(python3?|node)\b/;
const FILE_WRITE = /\.write\(|writeFileSync|write_text\(|open\([^)]*['"][wa]['"]/;
const ASSIGNMENT_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/;
const SEARCH_SEGMENT = /^(rg|grep|git\s+(grep|ls-files|diff|status|log|show|blame)|ls|find|fd|cat|bat|sed\s+-n|head|tail|wc|jq|tree|du|stat|echo|for|printf|awk|sort|uniq|xargs)\b/;
const SKIPPED_SEGMENT = /^(cd|pushd|popd|do|done|then|else|fi|export|set|source|\.)\b/;

const EXPLORE_TOOL = /^(Read|Grep|Glob|LSP|ToolSearch|NotebookRead)$/;
const EDIT_TOOL = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const DESIGN_TOOL = /^(Artifact|ArtifactComments|ArtifactData|DesignSync)$|^mcp__(visualize|Claude_Browser|claude-in-chrome|playwright|plugin_playwright|figma|pencil|open-pencil)/i;
const WEB_TOOL = /^(WebSearch|WebFetch)$|^mcp__(context7|plugin_context7)|^mcp__.*(docs|documentation)/i;
const SERVICE_TOOL = /^(TaskCreate|TaskUpdate|TaskList|TaskGet|TodoWrite|ExitPlanMode|EnterPlanMode|ScheduleWakeup|CronCreate|CronList|CronDelete|PushNotification)$|^mcp__(ccd|scheduled-tasks|hearthbot)/;

const isDocPath = (path) => path.includes('/.claude/') || path.includes('/memory/') || /\.(md|mdx|txt)$/i.test(path);

export const isArchitect = (type = '') => /(^|:)architect$/.test(type);

export const toolStage = ({ name, input = {} }) => {
  if (name === 'Agent' || name === 'Task') return isArchitect(input.subagent_type) ? 'architect' : 'subagent';
  if (name === 'SendMessage') return 'subagent';
  if (EXPLORE_TOOL.test(name)) return 'explore';
  if (EDIT_TOOL.test(name)) return isDocPath(input.file_path ?? input.notebook_path ?? '') ? 'docs' : 'edit';
  if (name === 'Bash') return bashStage(input.command ?? '');
  if (name === 'AskUserQuestion') return 'ask';
  if (DESIGN_TOOL.test(name)) return 'design';
  if (name === 'Skill') return /design|artifact|frontend/.test(input.skill ?? '') ? 'design' : 'other';
  if (WEB_TOOL.test(name)) return 'web';
  if (SERVICE_TOOL.test(name)) return 'service';
  return 'other';
};

export const callStage = (tools) => {
  if (!tools.length) return 'answer';
  const stage = tools.map(toolStage).reduce((best, next) => (PRIORITY.indexOf(next) < PRIORITY.indexOf(best) ? next : best));
  return stage === 'ask' ? 'service' : stage;
};

// Validation is a segment that starts with a check command, so `rg vitest` stays a search.
export const bashStage = (command) => {
  const parts = segments(command);
  if (parts.some((part) => VALIDATE_SEGMENT.test(part))) return 'validate';
  if (parts.some((part) => EDIT_SEGMENT.test(part))) return 'edit';
  if (parts.some((part) => SCRIPT_SEGMENT.test(part)) && FILE_WRITE.test(command)) return 'edit';
  if (parts.length && SEARCH_SEGMENT.test(parts[0])) return 'explore';
  return 'other';
};

// Shell segments with heredoc bodies, variable assignments, `time` and control words removed.
export const segments = (command) =>
  stripHeredocs(command)
    .split(/&&|\|\||;|\||\n/)
    .map((part) =>
      part
        .trim()
        .replace(/^[({]\s*/, '')
        .replace(/^([A-Z_][A-Z0-9_]*=\S*\s+)+/, '')
        .replace(/^(\/usr\/bin\/)?time(\s+-p)?\s+/, ''),
    )
    .filter((part) => part && !SKIPPED_SEGMENT.test(part) && !ASSIGNMENT_SEGMENT.test(part));

const stripHeredocs = (command) => {
  const kept = [];
  let terminator = null;
  for (const line of command.split('\n')) {
    if (terminator) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    kept.push(line);
    terminator = line.match(/<<-?\s*['"]?(\w+)['"]?/)?.[1] ?? null;
  }
  return kept.join('\n');
};

// Context buckets of a main-session call (input, cache reads and cache writes together).
export const BUCKETS = [
  ['lt100k', 100_000],
  ['100to200k', 200_000],
  ['200to300k', 300_000],
  ['gt300k', Infinity],
];
export const bucketOf = (context) => BUCKETS.find(([, limit]) => context < limit)[0];
