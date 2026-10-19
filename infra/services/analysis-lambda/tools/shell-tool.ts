/**
 * Shell_Analysis_Tool - custom Strands tool for shell-based data analysis.
 *
 * Enables price-aware agents to run shell commands on CSV/JSON files in /tmp.
 * Implements 30-second command timeout with structured error on timeout.
 * Per-agent call limit via SHELL_TOOL_MAX_CALLS env var (default: 15).
 *
 * Since the Strands community bash tool is not available as a package,
 * this implements a custom tool using child_process.exec with the same
 * interface pattern.
 *
 * Requirements: 5.1, 5.4, 5.5
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';
import { exec } from 'child_process';

const SHELL_TIMEOUT_MS = 30_000;
const WORKING_DIRECTORY = '/tmp';
const SHELL_TOOL_MAX_CALLS = parseInt(process.env.SHELL_TOOL_MAX_CALLS || '15', 10);

let shellToolCallCount = 0;

/**
 * Reset the shell tool call counter.
 * Called before each agent execution to give each agent a fresh budget.
 */
export function resetShellToolCallCount(): void {
  shellToolCallCount = 0;
}

/**
 * Strands tool: shell_analysis
 *
 * Executes shell commands within /tmp working directory for data analysis.
 * Agents can use standard Unix utilities (awk, sed, grep, sort, head, tail,
 * wc, bc) to analyze price history CSV and related markets JSON files.
 * NOTE: python3 is NOT available. Use awk for all calculations.
 */
export const shellAnalysisTool = tool({
  name: 'shell_analysis',
  description:
    'Execute a shell command in the /tmp working directory for data analysis. ' +
    'Use this to analyze price history CSV files and related markets JSON files. ' +
    'Available utilities: awk, sed, grep, sort, head, tail, wc, bc. ' +
    'NOTE: python3 is NOT available - use awk for calculations (statistics, moving averages, etc). ' +
    'Commands have a 30-second timeout.',
  inputSchema: z.object({
    command: z
      .string()
      .describe('The shell command to execute in /tmp working directory'),
  }),
  callback: async (input): Promise<JSONValue> => {
    // Enforce per-agent call limit
    shellToolCallCount++;
    if (shellToolCallCount > SHELL_TOOL_MAX_CALLS) {
      return {
        error: true,
        toolName: 'shell_analysis',
        message: `Shell tool call limit reached (${SHELL_TOOL_MAX_CALLS} max). Produce your signal with the data you already have.`,
      } as JSONValue;
    }

    try {
      const result = await executeCommand(input.command);
      return result as JSONValue;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        error: true,
        toolName: 'shell_analysis',
        message,
      } as JSONValue;
    }
  },
});

/**
 * Execute a shell command in /tmp with a 30-second timeout.
 * Returns stdout/stderr on success, structured error on timeout or failure.
 */
function executeCommand(
  command: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd: WORKING_DIRECTORY,
        timeout: SHELL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024, // 1MB output buffer
        shell: '/bin/bash',
      },
      (error, stdout, stderr) => {
        if (error) {
          // Check if the error is a timeout (killed signal)
          if (error.killed || error.signal === 'SIGTERM') {
            resolve({
              error: true,
              toolName: 'shell_analysis',
              message: `Command timed out after ${SHELL_TIMEOUT_MS / 1000} seconds`,
            });
            return;
          }

          // Command exited with non-zero code - return output with exit code
          resolve({
            exitCode: error.code ?? 1,
            stdout: stdout || '',
            stderr: stderr || error.message,
          });
          return;
        }

        // Success
        resolve({
          exitCode: 0,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      },
    );

    // Safety: kill child process if it somehow exceeds timeout without exec handling it
    const safetyTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }, SHELL_TIMEOUT_MS + 1000);

    child.on('exit', () => {
      clearTimeout(safetyTimer);
    });
  });
}
