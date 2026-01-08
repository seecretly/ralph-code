/**
 * Ralph Coordinator Worker
 * Main entry point for the Ralph Code system
 * Handles cron triggers, HTTP requests, and orchestrates task execution
 */

import { VibeKanbanClient } from './integrations/vibe-kanban';
import { GitHubClient, generatePRBody } from './integrations/github';
import { ExecutionServerClient } from './integrations/execution-server';
import { Env, Task, ExecutionResult } from './utils/types';
import { logger } from './utils/common';

// Export Durable Object
export { RalphStateDO } from './durables/ralph-state';

/**
 * Main worker export
 */
export default {
  /**
   * Scheduled handler - runs on cron trigger
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runRalphCycle(env));
  },

  /**
   * Fetch handler - handles HTTP requests
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Callback from Execution Server
    if (url.pathname === '/callbacks/execution' && request.method === 'POST') {
      return await handleExecutionCallback(request, env);
    }

    // Manual trigger
    if (url.pathname === '/trigger' && request.method === 'POST') {
      ctx.waitUntil(runRalphCycle(env));
      return Response.json({ ok: true, message: 'Ralph cycle triggered' });
    }

    // Get PRD status
    if (url.pathname === '/status' && request.method === 'GET') {
      return await getStatus(env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

/**
 * Main Ralph cycle - polls Vibe Kanban and enqueues new tasks
 */
async function runRalphCycle(env: Env): Promise<void> {
  logger.info('Starting Ralph cycle');

  try {
    // Initialize clients
    const vibeClient = new VibeKanbanClient(
      env.VIBE_KANBAN_MCP_URL,
      env.VIBE_KANBAN_API_KEY,
      env.VIBE_PROJECT_NAME
    );

    // Poll for new tasks
    const tasks = await vibeClient.listPendingTasks();

    logger.info(`Found ${tasks.length} pending tasks`);

    // Enqueue each task to Durable Object
    for (const task of tasks) {
      await enqueueTask(env, task);

      // Update Vibe Kanban status
      await vibeClient.updateTaskStatus(task.id, 'in_progress', {
        agent: 'ralph-code',
        startedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Ralph cycle failed', error);
  }
}

/**
 * Enqueue a task to the Durable Object
 */
async function enqueueTask(env: Env, task: Task): Promise<void> {
  const id = env.RALPH_STATE.idFromName(env.VIBE_PROJECT_NAME);
  const stub = env.RALPH_STATE.get(id);

  const response = await stub.fetch('https://fake/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });

  if (!response.ok) {
    throw new Error(`Failed to enqueue task: ${await response.text()}`);
  }

  logger.info('Task enqueued', { taskId: task.id });
}

/**
 * Handle execution callback from Execution Server
 */
async function handleExecutionCallback(request: Request, env: Env): Promise<Response> {
  try {
    const result: ExecutionResult = await request.json();

    logger.info('Received execution callback', {
      taskId: result.taskId,
      success: result.success
    });

    // Get Durable Object
    const id = env.RALPH_STATE.idFromName(env.VIBE_PROJECT_NAME);
    const stub = env.RALPH_STATE.get(id);

    if (result.success) {
      // Create GitHub PR
      const github = new GitHubClient(env.GITHUB_TOKEN);

      try {
        // Get task details from Durable Object
        const prdResponse = await stub.fetch('https://fake/get-prd');
        const prd = await prdResponse.json();
        const task = prd.tasks[result.taskId];

        if (!task) {
          throw new Error(`Task ${result.taskId} not found in PRD`);
        }

        // Create PR (cross-repo from fork to upstream)
        const pr = await github.createPullRequest({
          owner: env.GITHUB_UPSTREAM_OWNER || env.GITHUB_REPO_OWNER,
          repo: env.GITHUB_UPSTREAM_REPO || env.GITHUB_REPO_NAME,
          title: task.description.split('\n')[0], // First line as title
          body: generatePRBody({
            description: task.description,
            learnings: result.learnings
          }),
          head: `${env.GITHUB_REPO_OWNER}:${task.branchName}`, // Cross-repo format: user:branch
          base: 'main',
          draft: false
        });

        // Update result with PR URL
        result.prUrl = pr.html_url;

        logger.info('PR created', {
          taskId: result.taskId,
          prNumber: pr.number,
          prUrl: pr.html_url
        });

        // Mark task as complete in Durable Object
        await stub.fetch('https://fake/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: result.taskId, result })
        });

        // Update Vibe Kanban
        const vibeClient = new VibeKanbanClient(
          env.VIBE_KANBAN_MCP_URL,
          env.VIBE_KANBAN_API_KEY,
          env.VIBE_PROJECT_NAME
        );

        await vibeClient.completeTask(result.taskId, pr.html_url);

      } catch (error) {
        logger.error('Failed to create PR', error, { taskId: result.taskId });

        // Mark as failed
        await stub.fetch('https://fake/fail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: result.taskId,
            error: error instanceof Error ? error.message : 'Failed to create PR'
          })
        });
      }
    } else {
      // Mark task as failed
      await stub.fetch('https://fake/fail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: result.taskId,
          error: result.error || 'Execution failed'
        })
      });

      // Update Vibe Kanban
      const vibeClient = new VibeKanbanClient(
        env.VIBE_KANBAN_MCP_URL,
        env.VIBE_KANBAN_API_KEY,
        env.VIBE_PROJECT_NAME
      );

      await vibeClient.failTask(result.taskId, result.error || 'Execution failed');
    }

    return Response.json({ ok: true });
  } catch (error) {
    logger.error('Callback handling failed', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Get current status (PRD and progress)
 */
async function getStatus(env: Env): Promise<Response> {
  try {
    const id = env.RALPH_STATE.idFromName(env.VIBE_PROJECT_NAME);
    const stub = env.RALPH_STATE.get(id);

    const prdResponse = await stub.fetch('https://fake/get-prd');
    const prd = await prdResponse.json();

    const progressResponse = await stub.fetch('https://fake/get-progress');
    const progressData = await progressResponse.json();

    return Response.json({
      prd,
      progress: progressData.progress,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get status', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
