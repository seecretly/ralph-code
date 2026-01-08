/**
 * Types for Execution Server
 */

export interface ExecutionRequest {
  taskId: string;
  repoUrl: string;
  baseBranch: string;
  branchName: string;
  prompt: string;
  maxIterations: number;
  callbackUrl: string;
}

export interface ExecutionResult {
  taskId: string;
  success: boolean;
  prUrl?: string;
  error?: string;
  logs: string;
  learnings: string[];
  testsPass: boolean;
  typecheckPass: boolean;
  duration: number;
}

export interface ExecutionState {
  id: string;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  worktreePath?: string;
  logs: string[];
  learnings: string[];
}

export interface ClaudeRunResult {
  success: boolean;
  output: string;
  completed: boolean;
  iterationsUsed: number;
}

export interface QualityCheckResult {
  typecheck: boolean;
  tests: boolean;
  lint: boolean;
  errors: string[];
}
