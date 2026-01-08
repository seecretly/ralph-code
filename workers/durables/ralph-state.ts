/**
 * Ralph State Durable Object
 * Manages persistent state for tasks, progress, and execution history
 * Inspired by Rocket's Durable Object pattern
 */

import { PRD, PRDEntry, ProgressEntry, Task, ExecutionResult, Env } from '../utils/types';
import { logger, generateId } from '../utils/common';

export class RalphStateDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route handlers
      if (path === '/enqueue' && request.method === 'POST') {
        return await this.handleEnqueue(request);
      } else if (path === '/complete' && request.method === 'POST') {
        return await this.handleComplete(request);
      } else if (path === '/fail' && request.method === 'POST') {
        return await this.handleFail(request);
      } else if (path === '/get-next-task' && request.method === 'GET') {
        return await this.handleGetNextTask();
      } else if (path === '/get-prd' && request.method === 'GET') {
        return await this.handleGetPRD();
      } else if (path === '/get-progress' && request.method === 'GET') {
        return await this.handleGetProgress();
      } else if (path === '/update-progress' && request.method === 'POST') {
        return await this.handleUpdateProgress(request);
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      logger.error('Durable Object error', error, { path });
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Enqueue a new task
   */
  private async handleEnqueue(request: Request): Promise<Response> {
    const task: Task = await request.json();

    logger.info('Enqueuing task', { taskId: task.id, title: task.title });

    // Get current PRD
    const prd = await this.getPRD();

    // Add task to PRD
    prd.tasks[task.id] = {
      description: task.description,
      branchName: task.branch,
      passes: false,
      attempts: 0
    };

    prd.version++;
    prd.updatedAt = new Date().toISOString();

    // Save PRD
    await this.state.storage.put('prd', prd);

    // Schedule execution via alarm
    await this.state.storage.setAlarm(Date.now() + 1000); // Execute in 1 second

    return Response.json({ ok: true, taskId: task.id });
  }

  /**
   * Mark task as complete
   */
  private async handleComplete(request: Request): Promise<Response> {
    const data: { taskId: string; result: ExecutionResult } = await request.json();

    logger.info('Completing task', { taskId: data.taskId });

    const prd = await this.getPRD();

    if (!prd.tasks[data.taskId]) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    // Update task
    prd.tasks[data.taskId].passes = data.result.success;
    prd.tasks[data.taskId].prUrl = data.result.prUrl;
    prd.tasks[data.taskId].lastAttemptAt = new Date().toISOString();
    prd.version++;
    prd.updatedAt = new Date().toISOString();

    await this.state.storage.put('prd', prd);

    // Append to progress
    if (data.result.learnings && data.result.learnings.length > 0) {
      await this.appendProgress({
        timestamp: new Date().toISOString(),
        taskId: data.taskId,
        description: prd.tasks[data.taskId].description,
        learnings: data.result.learnings,
        filesChanged: []
      });
    }

    return Response.json({ ok: true });
  }

  /**
   * Mark task as failed
   */
  private async handleFail(request: Request): Promise<Response> {
    const data: { taskId: string; error: string } = await request.json();

    logger.info('Failing task', { taskId: data.taskId, error: data.error });

    const prd = await this.getPRD();

    if (!prd.tasks[data.taskId]) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    prd.tasks[data.taskId].passes = false;
    prd.tasks[data.taskId].error = data.error;
    prd.tasks[data.taskId].lastAttemptAt = new Date().toISOString();
    prd.tasks[data.taskId].attempts++;
    prd.version++;
    prd.updatedAt = new Date().toISOString();

    await this.state.storage.put('prd', prd);

    return Response.json({ ok: true });
  }

  /**
   * Get next task to execute
   */
  private async handleGetNextTask(): Promise<Response> {
    const prd = await this.getPRD();

    // Find first task that hasn't passed and has attempts < 3
    for (const [taskId, task] of Object.entries(prd.tasks)) {
      if (!task.passes && task.attempts < 3) {
        return Response.json({ taskId, task });
      }
    }

    return Response.json({ taskId: null, task: null });
  }

  /**
   * Get PRD
   */
  private async handleGetPRD(): Promise<Response> {
    const prd = await this.getPRD();
    return Response.json(prd);
  }

  /**
   * Get progress
   */
  private async handleGetProgress(): Promise<Response> {
    const progress = await this.getProgress();
    return Response.json({ progress });
  }

  /**
   * Update progress
   */
  private async handleUpdateProgress(request: Request): Promise<Response> {
    const entry: ProgressEntry = await request.json();
    await this.appendProgress(entry);
    return Response.json({ ok: true });
  }

  /**
   * Alarm handler - processes queued tasks
   */
  async alarm(): Promise<void> {
    logger.info('Alarm triggered');

    // Get next task
    const prd = await this.getPRD();

    for (const [taskId, task] of Object.entries(prd.tasks)) {
      if (!task.passes && task.attempts < 3) {
        // Increment attempts
        task.attempts++;
        await this.state.storage.put('prd', prd);

        // Trigger execution
        try {
          await fetch(`${this.env.EXECUTION_SERVER_URL}/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.env.EXECUTION_SERVER_TOKEN}`
            },
            body: JSON.stringify({
              taskId,
              repoUrl: `https://github.com/${this.env.GITHUB_REPO_OWNER}/${this.env.GITHUB_REPO_NAME}.git`,
              baseBranch: 'main',
              branchName: task.branchName,
              prompt: task.description,
              maxIterations: 10,
              callbackUrl: `https://ralph-coordinator.${this.env.EXECUTION_SERVER_URL}/callbacks/execution`
            })
          });

          logger.info('Triggered execution', { taskId });
        } catch (error) {
          logger.error('Failed to trigger execution', error, { taskId });
        }

        // Only process one task at a time
        break;
      }
    }
  }

  /**
   * Get or initialize PRD
   */
  private async getPRD(): Promise<PRD> {
    let prd = await this.state.storage.get<PRD>('prd');

    if (!prd) {
      prd = {
        projectName: this.env.VIBE_PROJECT_NAME || 'rocket',
        tasks: {},
        version: 1,
        updatedAt: new Date().toISOString()
      };
      await this.state.storage.put('prd', prd);
    }

    return prd;
  }

  /**
   * Get progress log
   */
  private async getProgress(): Promise<string> {
    const progress = await this.state.storage.get<string>('progress');
    return progress || '';
  }

  /**
   * Append to progress log
   */
  private async appendProgress(entry: ProgressEntry): Promise<void> {
    const progress = await this.getProgress();

    const newEntry = [
      `\n## ${entry.timestamp} - ${entry.taskId}`,
      `${entry.description}`,
      '',
      '### Learnings',
      ...entry.learnings.map(l => `- ${l}`),
      '',
      ...(entry.filesChanged.length > 0 ? ['### Files Changed', ...entry.filesChanged.map(f => `- ${f}`), ''] : [])
    ].join('\n');

    await this.state.storage.put('progress', progress + newEntry);
  }
}
