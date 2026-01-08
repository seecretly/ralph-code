/**
 * Execution Server
 * Express API server that receives execution requests and orchestrates task execution
 */

import express, { Request, Response } from 'express';
import { ExecutionAgent } from './agent';
import { ExecutionRequest } from './types';

const app = express();
const port = process.env.PORT || 3000;

// Initialize execution agent
const agent = new ExecutionAgent(process.env.WORKSPACE_ROOT || '/workspace');

// Middleware
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Authentication middleware
function authenticate(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.EXECUTION_SERVER_TOKEN;

  if (!expectedToken) {
    console.warn('EXECUTION_SERVER_TOKEN not set - authentication disabled!');
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
  }

  const token = authHeader.substring(7);
  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  next();
}

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    workspace: process.env.WORKSPACE_ROOT || '/workspace'
  });
});

/**
 * Execute task endpoint
 */
app.post('/execute', authenticate, async (req: Request, res: Response) => {
  try {
    const request: ExecutionRequest = req.body;

    // Validate request
    if (!request.taskId || !request.repoUrl || !request.branchName || !request.prompt) {
      return res.status(400).json({
        error: 'Missing required fields: taskId, repoUrl, branchName, prompt'
      });
    }

    console.log(`Received execution request for task ${request.taskId}`);

    // Start execution asynchronously
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Execute in background
    agent.execute(request).catch(error => {
      console.error('Background execution failed:', error);
    });

    // Return immediately
    res.json({
      executionId,
      message: 'Execution started',
      taskId: request.taskId
    });
  } catch (error) {
    console.error('Execution request failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get execution status endpoint
 */
app.get('/status/:executionId', authenticate, (req: Request, res: Response) => {
  const { executionId } = req.params;

  const status = agent.getStatus(executionId);

  if (!status) {
    return res.status(404).json({ error: 'Execution not found' });
  }

  res.json(status);
});

/**
 * Cancel execution endpoint
 */
app.post('/cancel/:executionId', authenticate, async (req: Request, res: Response) => {
  const { executionId } = req.params;

  try {
    await agent.cancel(executionId);
    res.json({ ok: true, message: 'Execution cancelled' });
  } catch (error) {
    console.error('Failed to cancel execution:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to cancel execution'
    });
  }
});

/**
 * Error handler
 */
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(port, () => {
  console.log(`Execution Server running on port ${port}`);
  console.log(`Workspace root: ${process.env.WORKSPACE_ROOT || '/workspace'}`);
  console.log(`Authentication: ${process.env.EXECUTION_SERVER_TOKEN ? 'enabled' : 'DISABLED'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
