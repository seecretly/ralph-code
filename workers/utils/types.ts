/**
 * Shared TypeScript types for Ralph Code Workers
 */

export interface Env {
  // Bindings
  RALPH_STATE: DurableObjectNamespace;

  // Environment variables
  VIBE_PROJECT_NAME: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  EXECUTION_SERVER_URL: string;

  // Secrets
  VIBE_KANBAN_API_KEY: string;
  VIBE_KANBAN_MCP_URL: string;
  GITHUB_TOKEN: string;
  EXECUTION_SERVER_TOKEN: string;
  ANTHROPIC_API_KEY?: string;
}

/**
 * Task representation (from Vibe Kanban)
 */
export interface Task {
  id: string;
  title: string;
  description: string;
  branch: string;
  status: 'pending' | 'in_progress' | 'review' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  acceptanceCriteria?: string[];
  tags?: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * PRD entry (Ralph's task format)
 */
export interface PRDEntry {
  description: string;
  branchName: string;
  passes: boolean;
  prUrl?: string;
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}

/**
 * PRD document
 */
export interface PRD {
  projectName: string;
  tasks: Record<string, PRDEntry>;
  version: number;
  updatedAt: string;
}

/**
 * Execution request sent to Execution Server
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

/**
 * Execution result received from Execution Server
 */
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

/**
 * Progress log entry
 */
export interface ProgressEntry {
  timestamp: string;
  taskId: string;
  description: string;
  learnings: string[];
  filesChanged: string[];
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Tool call result
 */
export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * GitHub PR creation options
 */
export interface GitHubPROptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

/**
 * GitHub PR response
 */
export interface GitHubPR {
  number: number;
  html_url: string;
  state: string;
  title: string;
}
