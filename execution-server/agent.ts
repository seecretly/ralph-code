/**
 * Execution Agent
 * Main execution loop that orchestrates task execution
 */

import { GitManager } from './git-manager';
import { QualityChecker } from './quality-checks';
import { ClaudeRunner } from './claude-runner';
import { ExecutionRequest, ExecutionResult, ExecutionState } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ExecutionAgent {
  private workspaceRoot: string;
  private executions: Map<string, ExecutionState>;

  constructor(workspaceRoot: string = '/workspace') {
    this.workspaceRoot = workspaceRoot;
    this.executions = new Map();
  }

  /**
   * Execute a task
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();

    // Initialize execution state
    const state: ExecutionState = {
      id: executionId,
      taskId: request.taskId,
      status: 'running',
      startedAt: new Date().toISOString(),
      logs: [],
      learnings: []
    };

    this.executions.set(executionId, state);

    try {
      console.log(`Starting execution for task ${request.taskId}`);

      // Step 1: Clone/update repository
      const repoPath = path.join(this.workspaceRoot, 'rocket');
      await GitManager.cloneIfNeeded(request.repoUrl, repoPath);

      const gitManager = new GitManager(repoPath);

      // Step 2: Create worktree
      console.log(`Creating worktree for branch ${request.branchName}`);
      const worktreePath = await gitManager.createWorktree(request.branchName, request.baseBranch);
      state.worktreePath = worktreePath;

      // Step 3: Install dependencies
      console.log('Installing dependencies...');
      const qualityChecker = new QualityChecker(worktreePath);
      await qualityChecker.installDependencies();

      // Step 4: Generate prompt file
      console.log('Generating prompt file...');
      const progressContext = await this.getProgressContext(repoPath);
      const promptFile = await ClaudeRunner.generatePromptFile(
        worktreePath,
        request.prompt,
        progressContext
      );

      // Step 5: Run Claude Code
      console.log('Running Claude Code...');
      const claudeRunner = new ClaudeRunner(worktreePath, promptFile);
      const claudeResult = await claudeRunner.run(request.maxIterations);

      state.logs.push(claudeResult.output);

      if (!claudeResult.success) {
        throw new Error('Claude execution failed');
      }

      if (!claudeResult.completed) {
        console.warn('Claude did not complete the task within max iterations');
      }

      // Extract learnings
      state.learnings = claudeRunner.extractLearnings(claudeResult.output);

      // Step 6: Run quality checks
      console.log('Running quality checks...');
      const qualityResult = await qualityChecker.runAll();

      if (!qualityResult.typecheck || !qualityResult.tests) {
        const error = `Quality checks failed: ${qualityResult.errors.join(', ')}`;
        state.status = 'failed';

        return {
          taskId: request.taskId,
          success: false,
          error,
          logs: state.logs.join('\n'),
          learnings: state.learnings,
          testsPass: qualityResult.tests,
          typecheckPass: qualityResult.typecheck,
          duration: Date.now() - startTime
        };
      }

      // Step 7: Commit changes
      console.log('Committing changes...');
      const changedFiles = await gitManager.getChangedFiles(worktreePath);

      if (changedFiles.length === 0) {
        throw new Error('No changes were made');
      }

      const commitMessage = this.generateCommitMessage(request.prompt, changedFiles);
      await gitManager.commit(worktreePath, commitMessage);

      // Step 8: Push to remote
      console.log('Pushing to remote...');
      await gitManager.push(worktreePath, request.branchName);

      // Step 9: Notify callback
      if (request.callbackUrl) {
        await this.notifyCallback(request.callbackUrl, {
          taskId: request.taskId,
          success: true,
          logs: state.logs.join('\n'),
          learnings: state.learnings,
          testsPass: true,
          typecheckPass: true,
          duration: Date.now() - startTime
        });
      }

      // Clean up worktree
      await gitManager.deleteWorktree(worktreePath);

      state.status = 'completed';
      state.completedAt = new Date().toISOString();

      return {
        taskId: request.taskId,
        success: true,
        logs: state.logs.join('\n'),
        learnings: state.learnings,
        testsPass: true,
        typecheckPass: true,
        duration: Date.now() - startTime
      };
    } catch (error) {
      console.error('Execution failed:', error);

      state.status = 'failed';
      state.completedAt = new Date().toISOString();

      // Notify callback of failure
      if (request.callbackUrl) {
        await this.notifyCallback(request.callbackUrl, {
          taskId: request.taskId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          logs: state.logs.join('\n'),
          learnings: state.learnings,
          testsPass: false,
          typecheckPass: false,
          duration: Date.now() - startTime
        });
      }

      return {
        taskId: request.taskId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        logs: state.logs.join('\n'),
        learnings: state.learnings,
        testsPass: false,
        typecheckPass: false,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Get execution status
   */
  getStatus(executionId: string): ExecutionState | null {
    return this.executions.get(executionId) || null;
  }

  /**
   * Cancel execution
   */
  async cancel(executionId: string): Promise<void> {
    const state = this.executions.get(executionId);
    if (state) {
      state.status = 'cancelled';
      state.completedAt = new Date().toISOString();

      // Clean up worktree if exists
      if (state.worktreePath) {
        try {
          const repoPath = path.join(this.workspaceRoot, 'rocket');
          const gitManager = new GitManager(repoPath);
          await gitManager.deleteWorktree(state.worktreePath);
        } catch (error) {
          console.error('Failed to clean up worktree:', error);
        }
      }
    }
  }

  /**
   * Generate commit message
   */
  private generateCommitMessage(taskDescription: string, changedFiles: string[]): string {
    const title = taskDescription.split('\n')[0].substring(0, 72);
    const authorName = process.env.GIT_AUTHOR_NAME || 'Ralph Agent';
    const authorEmail = process.env.GIT_AUTHOR_EMAIL || 'ralph@aicodingbot.dev';

    return `${title}

Files changed:
${changedFiles.map(f => `- ${f}`).join('\n')}

🤖 Generated with Ralph Code

Co-Authored-By: ${authorName} <${authorEmail}>`;
  }

  /**
   * Get progress context from previous executions
   */
  private async getProgressContext(repoPath: string): Promise<string> {
    try {
      const progressFile = path.join(repoPath, '.ralph', 'progress.txt');
      const content = await fs.readFile(progressFile, 'utf-8');

      // Return last 2000 characters
      return content.length > 2000 ? content.substring(content.length - 2000) : content;
    } catch (error) {
      return '';
    }
  }

  /**
   * Notify callback URL
   */
  private async notifyCallback(callbackUrl: string, result: ExecutionResult): Promise<void> {
    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(result)
      });

      if (!response.ok) {
        console.error(`Callback failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to notify callback:', error);
    }
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}
