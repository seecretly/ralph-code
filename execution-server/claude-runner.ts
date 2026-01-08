/**
 * Claude API Runner
 * Executes tasks using Anthropic API directly (simplified version)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ClaudeRunResult } from './types';

export class ClaudeRunner {
  private client: Anthropic;

  constructor(
    private worktreePath: string,
    private promptFile: string
  ) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  /**
   * Run task using Anthropic API
   */
  async run(maxIterations: number = 10): Promise<ClaudeRunResult> {
    const logs: string[] = [];
    let completed = false;
    let iterationsUsed = 0;

    try {
      // Read prompt
      const prompt = await fs.readFile(this.promptFile, 'utf-8');

      console.log(`Running Claude task in ${this.worktreePath}`);
      console.log(`Max iterations: ${maxIterations}`);

      // For now, use a single API call with extended thinking
      // A full implementation would support multiple iterations and tool use
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: `You are an AI coding assistant working on a repository at ${this.worktreePath}.

${prompt}

Please provide a detailed plan of what changes need to be made to complete this task. Focus on:
1. What files need to be modified
2. What the changes should accomplish
3. Any testing or validation needed

If the task is straightforward and you can complete it, end your response with:
<promise>COMPLETE</promise>`
        }]
      });

      const output = response.content
        .map(block => block.type === 'text' ? block.text : '')
        .join('\n');

      logs.push(output);
      console.log(output);

      // Check for completion marker
      completed = output.includes('<promise>COMPLETE</promise>');
      iterationsUsed = 1;

      return {
        success: true,
        output,
        completed,
        iterationsUsed
      };
    } catch (error) {
      console.error('Claude execution failed:', error);

      return {
        success: false,
        output: logs.join('\n') + '\n\nError: ' + (error as Error).message,
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
