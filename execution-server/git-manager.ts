/**
 * Git Worktree Manager
 * Handles git operations including worktree creation, commits, and pushes
 */

import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';

export class GitManager {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  /**
   * Create a new worktree for a task
   */
  async createWorktree(branchName: string, baseBranch: string = 'main'): Promise<string> {
    const worktreePath = path.join(this.repoPath, '.worktrees', branchName);

    // Ensure worktrees directory exists
    await fs.mkdir(path.join(this.repoPath, '.worktrees'), { recursive: true });

    // Remove worktree if it already exists
    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
    } catch (error) {
      // Ignore if worktree doesn't exist
    }

    // Fetch latest changes
    await this.git.fetch('origin');

    // Create worktree
    try {
      await this.git.raw([
        'worktree',
        'add',
        '-B',
        branchName,
        worktreePath,
        `origin/${baseBranch}`
      ]);
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`);
    }

    return worktreePath;
  }

  /**
   * Delete a worktree
   */
  async deleteWorktree(worktreePath: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
    } catch (error) {
      console.error('Failed to delete worktree:', error);
    }
  }

  /**
   * Commit changes in worktree
   */
  async commit(worktreePath: string, message: string): Promise<void> {
    const worktreeGit = simpleGit(worktreePath);

    // Configure git identity for this worktree
    const authorName = process.env.GIT_AUTHOR_NAME || 'seecretly';
    const authorEmail = process.env.GIT_AUTHOR_EMAIL || 'seecretly@users.noreply.github.com';

    await worktreeGit.addConfig('user.name', authorName);
    await worktreeGit.addConfig('user.email', authorEmail);

    // Stage all changes
    await worktreeGit.add('.');

    // Check if there are changes to commit
    const status = await worktreeGit.status();
    if (status.files.length === 0) {
      throw new Error('No changes to commit');
    }

    // Commit with explicit author
    await worktreeGit.commit(message, undefined, {
      '--author': `${authorName} <${authorEmail}>`
    });
  }

  /**
   * Push branch to remote
   */
  async push(worktreePath: string, branchName: string): Promise<void> {
    const worktreeGit = simpleGit(worktreePath);

    await worktreeGit.push('origin', branchName, ['--set-upstream', '--force']);
  }

  /**
   * Get list of changed files
   */
  async getChangedFiles(worktreePath: string): Promise<string[]> {
    const worktreeGit = simpleGit(worktreePath);
    const status = await worktreeGit.status();

    return status.files.map(file => file.path);
  }

  /**
   * Check if repository is clean
   */
  async isClean(worktreePath: string): Promise<boolean> {
    const worktreeGit = simpleGit(worktreePath);
    const status = await worktreeGit.status();

    return status.isClean();
  }

  /**
   * Clone repository if it doesn't exist
   */
  static async cloneIfNeeded(repoUrl: string, targetPath: string): Promise<void> {
    try {
      await fs.access(path.join(targetPath, '.git'));
      console.log('Repository already exists');

      // Pull latest changes
      const git = simpleGit(targetPath);
      await git.fetch('origin');
    } catch (error) {
      console.log('Cloning repository...');
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await simpleGit().clone(repoUrl, targetPath);
    }
  }
}
