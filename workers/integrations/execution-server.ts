/**
 * Execution Server Client
 * Communicates with the remote execution server to trigger task execution
 */

import { ExecutionRequest, ExecutionResult } from '../utils/types';
import { logger, retryWithBackoff } from '../utils/common';

export class ExecutionServerClient {
  constructor(
    private serverUrl: string,
    private token: string
  ) {}

  /**
   * Trigger task execution on the remote server
   */
  async triggerExecution(request: ExecutionRequest): Promise<{ executionId: string }> {
    logger.info('Triggering execution', {
      taskId: request.taskId,
      branch: request.branchName
    });

    try {
      const response = await fetch(`${this.serverUrl}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Execution server error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      logger.info('Execution triggered', {
        taskId: request.taskId,
        executionId: data.executionId
      });

      return data as { executionId: string };
    } catch (error) {
      logger.error('Failed to trigger execution', error, {
        taskId: request.taskId
      });
      throw error;
    }
  }

  /**
   * Get execution status
   */
  async getExecutionStatus(executionId: string): Promise<ExecutionResult | null> {
    try {
      const response = await fetch(`${this.serverUrl}/status/${executionId}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get execution status: ${response.statusText}`);
      }

      return await response.json() as ExecutionResult;
    } catch (error) {
      logger.error('Failed to get execution status', error, { executionId });
      return null;
    }
  }

  /**
   * Cancel a running execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    try {
      const response = await fetch(`${this.serverUrl}/cancel/${executionId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel execution: ${response.statusText}`);
      }

      logger.info('Execution cancelled', { executionId });
    } catch (error) {
      logger.error('Failed to cancel execution', error, { executionId });
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      return response.ok;
    } catch (error) {
      logger.error('Health check failed', error);
      return false;
    }
  }
}
