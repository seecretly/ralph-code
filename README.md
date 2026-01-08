# Ralph Code

Autonomous AI agent orchestration system using Claude Code, Ralph loop pattern, and Vibe Kanban for continuous task execution.

## Overview

Ralph Code is a hybrid cloud system that:
- Polls Vibe Kanban for new coding tasks
- Executes tasks using Claude Code CLI in isolated git worktrees
- Runs quality checks (tests, typecheck) before committing
- Creates GitHub pull requests for review
- Tracks progress and learnings across iterations

## Architecture

```
Cloudflare Workers (24/7)          Execution Server (VM)
┌─────────────────────┐           ┌──────────────────────┐
│ Ralph Coordinator   │──HTTP────▶│ Execution Agent      │
│ - Poll Vibe Kanban  │           │ - Run Claude Code    │
│ - Manage state (DO) │           │ - Git worktrees      │
│ - Create GitHub PRs │           │ - Quality checks     │
└─────────────────────┘           └──────────────────────┘
```

### Components

1. **Ralph Coordinator Worker** (Cloudflare Workers)
   - Polls Vibe Kanban MCP server for new tasks
   - Manages task state in Durable Objects
   - Creates GitHub PRs for completed tasks

2. **Ralph State Durable Object** (Cloudflare)
   - Stores `prd.json` (task list with completion status)
   - Stores `progress.txt` (learnings log)
   - Persistent state across executions

3. **Execution Server** (Node.js on VM)
   - Runs Claude Code CLI in isolated worktrees
   - Manages git operations
   - Runs quality checks (tests, typecheck, lint)
   - Reports results back to Coordinator

## Setup

### Prerequisites

- Node.js 20+
- Claude Code CLI installed
- Git
- Cloudflare account (for Workers)
- GitHub account with personal access token
- Vibe Kanban account or local instance

### Installation

#### 1. Install Dependencies

```bash
# Root
npm install

# Workers
cd workers && npm install

# Execution Server
cd execution-server && npm install
```

#### 2. Configure Secrets

**Cloudflare Workers** (via wrangler):
```bash
cd workers
npx wrangler secret put VIBE_KANBAN_API_KEY
npx wrangler secret put VIBE_KANBAN_MCP_URL
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put EXECUTION_SERVER_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY  # optional
```

**Execution Server** (.env):
```bash
cd execution-server
cp ../.env.example .env
# Edit .env with your credentials
```

#### 3. Deploy Coordinator Worker

```bash
cd workers
npm run deploy
```

#### 4. Run Execution Server

**Development**:
```bash
cd execution-server
npm run dev
```

**Production** (systemd service):
```bash
sudo cp systemd/ralph-execution.service /etc/systemd/system/
sudo systemctl enable ralph-execution
sudo systemctl start ralph-execution
```

### Cloud Deployment (Execution Server)

#### Option 1: Hetzner/DigitalOcean VM

```bash
# Provision VM (Ubuntu 22.04)
# 2 vCPU, 4GB RAM, 80GB SSD

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Claude CLI
curl -fsSL https://deb.anthropic.com/deb/anthropic.gpg | sudo tee /etc/apt/trusted.gpg.d/anthropic.gpg > /dev/null
echo "deb [arch=amd64] https://deb.anthropic.com/deb stable main" | sudo tee /etc/apt/sources.list.d/anthropic.list
sudo apt-get update && sudo apt-get install -y claude

# Clone and setup
git clone https://github.com/naturaumana-ai/ralph-code.git /opt/ralph-code
cd /opt/ralph-code/execution-server
npm install
npm run build

# Configure environment
cp ../.env.example .env
# Edit .env

# Setup systemd service
sudo systemctl enable /opt/ralph-code/systemd/ralph-execution.service
sudo systemctl start ralph-execution
```

#### Option 2: Docker

```bash
# Build image
docker build -t ralph-execution -f Dockerfile.execution .

# Run container
docker run -d \
  --name ralph-execution \
  -p 3000:3000 \
  -v /workspace:/workspace \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -e EXECUTION_SERVER_TOKEN=$EXECUTION_SERVER_TOKEN \
  ralph-execution
```

## Usage

### Creating Tasks in Vibe Kanban

1. Open Vibe Kanban: `npx vibe-kanban`
2. Create a new task:
   - **Title**: Brief description
   - **Description**: Detailed requirements
   - **Branch**: `task/your-feature-name`
   - **Assignee**: Set to `ralph-bot`
3. Task will be automatically picked up by Ralph Coordinator

### Monitoring

**Check status**:
```bash
curl https://ralph-coordinator.your-workers.dev/status
```

**View Cloudflare Workers logs**:
```bash
cd workers
npx wrangler tail
```

**View Execution Server logs**:
```bash
# If using systemd
sudo journalctl -u ralph-execution -f

# If running manually
npm start
```

### Manual Trigger

```bash
curl -X POST https://ralph-coordinator.your-workers.dev/trigger
```

## Configuration

### Environment Variables

**Coordinator Worker** (wrangler.jsonc):
- `VIBE_PROJECT_NAME`: Vibe Kanban project name
- `GITHUB_REPO_OWNER`: GitHub repository owner
- `GITHUB_REPO_NAME`: GitHub repository name
- `EXECUTION_SERVER_URL`: URL of execution server

**Execution Server** (.env):
- `PORT`: Server port (default: 3000)
- `WORKSPACE_ROOT`: Root directory for repositories
- `EXECUTION_SERVER_TOKEN`: Authentication token
- `ANTHROPIC_API_KEY`: Claude API key
- `GITHUB_TOKEN`: GitHub personal access token

### Task Configuration

Tasks support the following fields in Vibe Kanban:
- `title`: Short task description
- `description`: Detailed requirements
- `branch`: Git branch name (e.g., `task/add-feature`)
- `acceptanceCriteria`: List of criteria for completion
- `tags`: Task tags
- `priority`: low, medium, high, urgent

## Development

### Running Tests

```bash
# Workers
cd workers && npm test

# Execution Server
cd execution-server && npm test
```

### Local Development

```bash
# Start Vibe Kanban
npx vibe-kanban

# Run Execution Server locally
cd execution-server
npm run dev

# Deploy Workers to dev environment
cd workers
npm run deploy:dev
```

## Troubleshooting

### Common Issues

**1. Claude CLI not found**
```bash
which claude
# If not found, install Claude CLI
```

**2. Authentication errors**
```bash
# Check tokens are set correctly
npx wrangler secret list
cat execution-server/.env
```

**3. Git worktree conflicts**
```bash
# Clean up worktrees manually
cd /workspace/rocket
git worktree list
git worktree remove .worktrees/task-name --force
```

**4. Tests failing**
```bash
# Check if dependencies are installed
cd /workspace/rocket/.worktrees/task-name
npm install
npm test
```

## Cost Estimate

| Component | Service | Monthly Cost |
|-----------|---------|--------------|
| Coordinator | Cloudflare Workers | $0-10 |
| State Storage | Durable Objects | $5-10 |
| Execution Server | Hetzner VPS | €5 (~$5.50) |
| Claude API | Anthropic | $50-100 (usage-based) |
| **Total** | | **~$60-125/month** |

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit: `git commit -m "Add my feature"`
6. Push: `git push origin feature/my-feature`
7. Create a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details

## Credits

- Inspired by [Ralph](https://github.com/snarktank/ralph) by SnarktTank
- Built for [Vibe Kanban](https://vibekanban.com)
- Powers [Rocket](https://github.com/naturaumana-ai/rocket) development

## Support

- **Documentation**: [Plan File](/.claude/plans/gentle-greeting-wozniak.md)
- **Issues**: [GitHub Issues](https://github.com/naturaumana-ai/ralph-code/issues)
- **Community**: [Discussions](https://github.com/naturaumana-ai/ralph-code/discussions)
