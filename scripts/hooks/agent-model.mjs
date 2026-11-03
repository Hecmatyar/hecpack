#!/usr/bin/env node
// PreToolUse (Agent): a `model` override in an Agent call must fit the agent's row in `agentModels` of the
// project's .claude/hecpack/config.json (`models` lists the allowed ones, else `model`). Agents without a row
// are free. A hecpack agent the project left out (`without`, chosen at /init when another plugin does that
// job) is refused. A project without the config is not set up by hecpack: the hook stays silent.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CONFIG = '.claude/hecpack/config.json';

export const modelReason = (agentModels, type, model) => {
  // A fork always inherits the session's model and ignores `model`.
  if (!model || type === 'fork') return false;
  const row = agentModels?.[type];
  if (!row) return false;
  const allowed = row.models ?? [row.model];
  return (
    !allowed.includes(model) &&
    `${type} runs on ${allowed.join(' or ')} (agentModels in ${CONFIG}); change or drop the model override.`
  );
};

export const withoutReason = (without, type) =>
  Array.isArray(without) && without.includes(type) && `${type} is left out in this project (without in ${CONFIG}): another plugin's agent or skill does this job here.`;

const main = () => {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.');
  const file = join(root, CONFIG);
  if (!existsSync(file)) return;
  const { agentModels, without } = JSON.parse(readFileSync(file, 'utf8'));
  const { subagent_type: type, model } = input.tool_input ?? {};
  const reason = withoutReason(without, type) || modelReason(agentModels, type, model);
  if (!reason) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
};

// A hook failure never blocks the call: report to stderr and exit 0.
if (process.argv[1]?.endsWith('agent-model.mjs')) {
  try {
    main();
  } catch (error) {
    console.error(`hecpack agent-model hook: ${error.message}`);
  }
}
