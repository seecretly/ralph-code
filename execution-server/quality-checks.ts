/**
 * Quality Checks
 * Runs tests, typecheck, and linting
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { QualityCheckResult } from './types';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export class QualityChecker {
  constructor(private worktreePath: string) {}

  /**
   * Run all quality checks
   */
  async runAll(): Promise<QualityCheckResult> {
    const results: QualityCheckResult = {
      typecheck: false,
      tests: false,
      lint: false,
      errors: []
    };

    // Check if package.json exists
    try {
      await fs.access(path.join(this.worktreePath, 'package.json'));
    } catch (error) {
      results.errors.push('No package.json found');
      return results;
    }

    // Run typecheck
    try {
      results.typecheck = await this.runTypecheck();
    } catch (error) {
      results.errors.push(`Typecheck failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Run tests
    try {
      results.tests = await this.runTests();
    } catch (error) {
      results.errors.push(`Tests failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Run lint (optional - don't fail if not configured)
    try {
      results.lint = await this.runLint();
    } catch (error) {
      console.warn('Lint check skipped or failed:', error);
      results.lint = true; // Don't fail on lint
    }

    return results;
  }

  /**
   * Run TypeScript type checking
   */
  private async runTypecheck(): Promise<boolean> {
    try {
      const { stdout, stderr } = await execAsync('npm run typecheck', {
        cwd: this.worktreePath,
        timeout: 120000 // 2 minutes
      });

      console.log('Typecheck output:', stdout);
      return true;
    } catch (error: any) {
      console.error('Typecheck failed:', error.stderr || error.stdout);

      // Some projects don't have typecheck script
      if (error.message?.includes('Missing script')) {
        // Try tsc directly
        try {
          await execAsync('npx tsc --noEmit', {
            cwd: this.worktreePath,
            timeout: 120000
          });
          return true;
        } catch (tscError) {
          throw tscError;
        }
      }

      throw error;
    }
  }

  /**
   * Run tests
   */
  private async runTests(): Promise<boolean> {
    try {
      const { stdout, stderr } = await execAsync('npm test', {
        cwd: this.worktreePath,
        timeout: 300000, // 5 minutes
        env: {
          ...process.env,
          CI: 'true',
          NODE_ENV: 'test'
        }
      });

      console.log('Test output:', stdout);
      return true;
    } catch (error: any) {
      console.error('Tests failed:', error.stderr || error.stdout);

      // Some projects don't have tests
      if (error.message?.includes('Missing script')) {
        console.warn('No test script found, skipping tests');
        return true; // Don't fail if tests don't exist
      }

      throw error;
    }
  }

  /**
   * Run linting
   */
  private async runLint(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('npm run lint', {
        cwd: this.worktreePath,
        timeout: 120000
      });

      console.log('Lint output:', stdout);
      return true;
    } catch (error: any) {
      // Lint is optional
      if (error.message?.includes('Missing script')) {
        return true;
      }

      console.warn('Lint warnings:', error.stdout);
      return true; // Don't fail on lint warnings
    }
  }

  /**
   * Install dependencies if needed
   */
  async installDependencies(): Promise<void> {
    try {
      // Check if node_modules exists
      try {
        await fs.access(path.join(this.worktreePath, 'node_modules'));
        console.log('Dependencies already installed');
        return;
      } catch {
        // node_modules doesn't exist, install
      }

      console.log('Installing dependencies...');
      const { stdout, stderr } = await execAsync('npm install', {
        cwd: this.worktreePath,
        timeout: 600000 // 10 minutes
      });

      console.log('Install output:', stdout);
    } catch (error) {
      console.error('Failed to install dependencies:', error);
      throw error;
    }
  }

  /**
   * Run build if needed
   */
  async runBuild(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('npm run build', {
        cwd: this.worktreePath,
        timeout: 300000 // 5 minutes
      });

      console.log('Build output:', stdout);
      return true;
    } catch (error: any) {
      // Build is optional
      if (error.message?.includes('Missing script')) {
        return true;
      }

      console.error('Build failed:', error);
      return false;
    }
  }
}
