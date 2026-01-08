/**
 * GitHub API Integration
 * Handles PR creation and repository interactions
 */

import { GitHubPROptions, GitHubPR } from '../utils/types';
import { logger, retryWithBackoff } from '../utils/common';

export class GitHubClient {
  private baseUrl = 'https://api.github.com';

  constructor(private token: string) {}

  /**
   * Create a pull request
   */
  async createPullRequest(options: GitHubPROptions): Promise<GitHubPR> {
    const { owner, repo, title, body, head, base, draft = false } = options;

    logger.info('Creating GitHub PR', { owner, repo, head, base });

    try {
      return await retryWithBackoff(
        async () => await this._createPullRequest(owner, repo, { title, body, head, base, draft }),
        { maxAttempts: 3, initialDelay: 2000 }
      );
    } catch (error) {
      logger.error('Failed to create PR', error, { owner, repo, head });
      throw error;
    }
  }

  private async _createPullRequest(
    owner: string,
    repo: string,
    data: { title: string; body: string; head: string; base: string; draft: boolean }
  ): Promise<GitHubPR> {
    const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const pr = await response.json() as GitHubPR;
    logger.info('PR created successfully', {
      number: pr.number,
      url: pr.html_url
    });

    return pr;
  }

  /**
   * Add comment to a pull request
   */
  async addPRComment(owner: string, repo: string, prNumber: number, comment: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: comment })
      });

      if (!response.ok) {
        throw new Error(`Failed to add comment: ${response.statusText}`);
      }

      logger.info('Added PR comment', { owner, repo, prNumber });
    } catch (error) {
      logger.error('Failed to add PR comment', error, { owner, repo, prNumber });
    }
  }

  /**
   * Get PR details
   */
  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPR | null> {
    try {
      const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get PR: ${response.statusText}`);
      }

      return await response.json() as GitHubPR;
    } catch (error) {
      logger.error('Failed to get PR', error, { owner, repo, prNumber });
      return null;
    }
  }

  /**
   * Check if branch exists
   */
  async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      return response.ok;
    } catch (error) {
      logger.error('Failed to check branch existence', error, { owner, repo, branch });
      return false;
    }
  }
}

/**
 * Generate PR body from task details
 */
export function generatePRBody(task: { description: string; acceptanceCriteria?: string[]; learnings?: string[] }): string {
  let body = `## Summary\n\n${task.description}\n\n`;

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    body += `## Acceptance Criteria\n\n`;
    for (const criterion of task.acceptanceCriteria) {
      body += `- [ ] ${criterion}\n`;
    }
    body += '\n';
  }

  if (task.learnings && task.learnings.length > 0) {
    body += `## Implementation Notes\n\n`;
    for (const learning of task.learnings) {
      body += `- ${learning}\n`;
    }
    body += '\n';
  }

  body += `## Test Plan\n\n`;
  body += `- [ ] All tests pass\n`;
  body += `- [ ] TypeScript compiles without errors\n`;
  body += `- [ ] Code follows repository patterns\n`;
  body += `\n`;

  body += `---\n\n`;
  body += `🤖 Generated with [Ralph Code](https://github.com/naturaumana-ai/ralph-code)\n\n`;
  body += `Co-Authored-By: Ralph Agent <ralph@naturaumana-ai.com>\n`;

  return body;
}
