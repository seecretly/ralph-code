/**
 * Claude Code CLI Wrapper
 * Executes Claude Code CLI in headless mode and parses output
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ClaudeRunResult } from './types';

export class ClaudeRunner {
  constructor(
    private worktreePath: string,
    private promptFile: string
  ) {}

  /**
   * Run Claude Code CLI
   */
  async run(maxIterations: number = 10): Promise<ClaudeRunResult> {
    const logs: string[] = [];
    let completed = false;
    let iterationsUsed = 0;

    try {
      // Read prompt
      const prompt = await fs.readFile(this.promptFile, 'utf-8');

      console.log(`Running Claude Code in ${this.worktreePath}`);
      console.log(`Max iterations: ${maxIterations}`);

      // Run Claude Code CLI
      const claudeProcess = spawn('claude', [
        '-p', prompt,
        '--max-iterations', maxIterations.toString(),
        '--permission-mode', 'auto-approve',
        '--allowedTools', 'Read,Write,Edit,Bash,Grep,Glob'
      ], {
        cwd: this.worktreePath,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
        }
      });

      // Capture output
      let output = '';

      claudeProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        logs.push(text);
        process.stdout.write(text);
      });

      claudeProcess.stderr.on('data', (data) => {
        const text = data.toString();
        logs.push(`[stderr] ${text}`);
        process.stderr.write(text);
      });

      // Wait for process to complete
      const exitCode = await new Promise<number>((resolve, reject) => {
        claudeProcess.on('close', (code) => {
          resolve(code || 0);
        });

        claudeProcess.on('error', (error) => {
          reject(error);
        });

        // Timeout after 30 minutes
        setTimeout(() => {
          claudeProcess.kill('SIGTERM');
          reject(new Error('Claude execution timed out after 30 minutes'));
        }, 30 * 60 * 1000);
      });

      // Check for completion marker
      completed = output.includes('<promise>COMPLETE</promise>');

      // Extract iterations used (if available in output)
      const iterationMatch = output.match(/Iteration (\d+)\/\d+/g);
      if (iterationMatch) {
        iterationsUsed = parseInt(iterationMatch[iterationMatch.length - 1].split('/')[0].split(' ')[1]);
      }

      return {
        success: exitCode === 0,
        output,
        completed,
        iterationsUsed
      };
    } catch (error) {
      console.error('Claude execution failed:', error);

      return {
        success: false,
        output: logs.join('\n'),
        completed,
        iterationsUsed
      };
    }
  }

  /**
   * Extract learnings from Claude output
   */
  extractLearnings(output: string): string[] {
    const learnings: string[] = [];

    // Look for common patterns in Claude's output
    const patterns = [
      /(?:discovered|found|learned|noticed) (?:that )?(.+?)(?:\.|$)/gi,
      /(?:pattern|approach|solution): (.+?)(?:\.|$)/gi,
      /(?:important|note|key point): (.+?)(?:\.|$)/gi
    ];

    for (const pattern of patterns) {
      const matches = output.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 10 && match[1].length < 200) {
          learnings.push(match[1].trim());
        }
      }
    }

    // Deduplicate
    return [...new Set(learnings)].slice(0, 10);
  }

  /**
   * Generate prompt file from task description
   */
  static async generatePromptFile(
    worktreePath: string,
    taskDescription: string,
    progressContext: string = ''
  ): Promise<string> {
    const promptPath = path.join(worktreePath, '.ralph', 'prompt.md');

    // Ensure .ralph directory exists
    await fs.mkdir(path.join(worktreePath, '.ralph'), { recursive: true });

    const prompt = `# Task

${taskDescription}

## Context

Repository: naturaumana-ai/rocket
Technology Stack: Cloudflare Workers, TypeScript, Supabase, Twilio

## Requirements

- All tests must pass (\`npm test\`)
- TypeScript must compile without errors (\`npm run typecheck\`)
- Code must follow existing patterns in the repository
- Changes should be isolated to relevant files only

${progressContext ? `## Previous Learnings\n\n${progressContext}\n` : ''}

## Success Criteria

When the task is complete and all requirements are met, respond with:

<promise>COMPLETE</promise>

## Important Notes

- Read the codebase thoroughly before making changes
- Follow existing code patterns and conventions
- Test your changes before marking complete
- Keep the implementation simple and focused
`;

    await fs.writeFile(promptPath, prompt, 'utf-8');

    return promptPath;
  }
}
