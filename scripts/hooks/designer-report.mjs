#!/usr/bin/env node
// SubagentStop (hecpack:designer): the report of a design pass ends with `Checklist: checked <lines or
// areas> — <result>` (agents/designer.md); without that line the designer goes back to run the checklist
// and report again, once (a second stop passes). A project without .claude/hecpack/config.json is not set
// up by hecpack: the hook stays silent. Ported from the HIG check of the Wayfarer project.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CHECK_LINE = /^\s*\**Checklist:\**\s+checked\s+\S/im;

export const reportReason = (input) => {
  const report = input.last_assistant_message;
  if (input.stop_hook_active || typeof report !== 'string' || !report.trim()) return false;
  if (input.agent_type && !/(^|:)designer$/.test(input.agent_type)) return false;
  if (CHECK_LINE.test(report)) return false;
  return 'The report must end with `Checklist: checked <lines or areas> — <result>`: run every board you changed through the project\'s checklist (or the one in your instructions), fix what fails, then report again with that line last.';
};

const main = () => {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? '.');
  if (!existsSync(join(root, '.claude/hecpack/config.json'))) return;
  const reason = reportReason(input);
  if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
};

// A hook failure never holds the agent: report to stderr and exit 0.
if (process.argv[1]?.endsWith('designer-report.mjs')) {
  try {
    main();
  } catch (error) {
    console.error(`hecpack designer-report hook: ${error.message}`);
  }
}
