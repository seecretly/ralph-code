/**
 * Vibe Kanban MCP Client
 * Integrates with Vibe Kanban's MCP server to poll for tasks and update status
 */

import { Task, MCPTool, MCPToolResult } from '../utils/types';
import { logger, retryWithBackoff } from '../utils/common';

export class VibeKanbanClient {
  constructor(
    private mcpUrl: string,
    private apiKey: string,
    private projectName: string
  ) {}

  /**
   * List pending tasks from Vibe Kanban
   */
  async listPendingTasks(): Promise<Task[]> {
    try {
      return await retryWithBackoff(
        async () => await this._listPendingTasks(),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      logger.error('Failed to list pending tasks', error, { projectName: this.projectName });
      return [];
    }
  }

  private async _listPendingTasks(): Promise<Task[]> {
    const result = await this.callTool('list_tasks', {
      projectId: this.projectName,
      status: ['pending', 'ready'],
      assignee: 'ralph-bot'
    });

    if (result.isError) {
      throw new Error(`Failed to list tasks: ${result.content[0]?.text}`);
    }

    const tasksData = result.content[0]?.text;
    if (!tasksData) {
      return [];
    }

    try {
      const parsed = JSON.parse(tasksData);
      return parsed.tasks || [];
    } catch (error) {
      logger.error('Failed to parse tasks response', error);
      return [];
    }
  }

  /**
   * Update task status in Vibe Kanban
   */
  async updateTaskStatus(taskId: string, status: Task['status'], metadata?: Record<string, unknown>): Promise<void> {
    try {
      await retryWithBackoff(
        async () => await this._updateTaskStatus(taskId, status, metadata),
        { maxAttempts: 3, initialDelay: 1000 }
      );
    } catch (error) {
      logger.error('Failed to update task status', error, { taskId, status });
    }
  }

  private async _updateTaskStatus(taskId: string, status: Task['status'], metadata?: Record<string, unknown>): Promise<void> {
    const result = await this.callTool('update_task_status', {
      taskId,
      status,
      ...metadata
    });

    if (result.isError) {
      throw new Error(`Failed to update task status: ${result.content[0]?.text}`);
    }
  }

  /**
   * Start a task attempt
   */
  async startTask(taskId: string): Promise<void> {
    try {
      await this.callTool('start_task_attempt', { taskId });
      logger.info('Started task attempt', { taskId });
    } catch (error) {
      logger.error('Failed to start task', error, { taskId });
    }
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string, prUrl: string): Promise<void> {
    try {
      await this.callTool('complete_task', {
        taskId,
        prUrl,
        status: 'review'
      });
      logger.info('Completed task', { taskId, prUrl });
    } catch (error) {
      logger.error('Failed to complete task', error, { taskId });
    }
  }

  /**
   * Mark task as failed
   */
  async failTask(taskId: string, errorMessage: string): Promise<void> {
    try {
      await this.callTool('update_task_status', {
        taskId,
        status: 'failed',
        error: errorMessage
      });
      logger.info('Marked task as failed', { taskId, errorMessage });
    } catch (error) {
      logger.error('Failed to mark task as failed', error, { taskId });
    }
  }

  /**
   * Call an MCP tool
   */
  private async callTool(toolName: string, input: Record<string, unknown>): Promise<MCPToolResult> {
    const response = await fetch(`${this.mcpUrl}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'X-MCP-Version': '2024-11-05'
      },
      body: JSON.stringify({
        name: toolName,
        arguments: input
      })
    });

    if (!response.ok) {
      throw new Error(`MCP tool call failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data as MCPToolResult;
  }

  /**
   * List available tools (for debugging)
   */
  async listTools(): Promise<MCPTool[]> {
    try {
      const response = await fetch(`${this.mcpUrl}/tools/list`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-MCP-Version': '2024-11-05'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to list tools: ${response.statusText}`);
      }

      const data = await response.json();
      return data.tools || [];
    } catch (error) {
      logger.error('Failed to list MCP tools', error);
      return [];
    }
  }
}

/**
 * Transform Vibe Kanban task to Ralph task format
 */
export function transformVibeTask(vibeTask: any): Task {
  return {
    id: vibeTask.id || vibeTask.taskId,
    title: vibeTask.title || vibeTask.name,
    description: vibeTask.description || '',
    branch: vibeTask.branch || `task/${vibeTask.id}`,
    status: vibeTask.status || 'pending',
    createdAt: vibeTask.createdAt || new Date().toISOString(),
    updatedAt: vibeTask.updatedAt || new Date().toISOString(),
    acceptanceCriteria: vibeTask.acceptanceCriteria || [],
    tags: vibeTask.tags || [],
    priority: vibeTask.priority || 'medium'
  };
}
