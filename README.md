# claude-autopilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Fully automated development orchestrator — from plan to PR with zero human intervention.

Feed it a plan (markdown checklist or GitHub Issues), and it will implement each task using `claude -p`, run tests, create PRs, and merge them automatically. Independent tasks run in parallel, rate limits are handled gracefully, and interrupted runs resume from where they left off.

## How It Works

```
[Input]      plan.md or GitHub Issues
                 ↓
[Parser]     Extract tasks: id, description, mode, dependencies
                 ↓
[Validator]  Plan quality gate: pass / warn / fail per task
                 ↓
[Queue]      Dependency analysis → parallel groups
                 ↓
[Executor]   claude -p sessions (parallel within groups)
                 ↓  (rate limit → auto-wait → health check → resume)
[Validator]  tsc + test + build
                 ↓  (fail → retry up to 3x)
[Publisher]  Branch + PR
                 ↓
             auto → merge → next task
             review → wait for approval → next task
```

**Key principle**: Plan validation runs before any execution — vague or broken tasks are caught upfront, not after wasting tokens.

## Installation

```bash
npm install -g claude-auto-pilot
```

## Quick Start

### 1. Write a plan

```markdown
# Feature Plan

## Phase 1: Auth
- [ ] [id: auth-ui] [auto] Social login UI — Add Apple/Google/Kakao buttons
- [ ] [id: auth-flow] [review] (depends: auth-ui) Auth flow — Connect AuthService

## Phase 2: Profile
- [ ] [id: profile-ui] [auto] (depends: auth-flow) Profile screen — Name, image
```

### 2. Run

```bash
claude-auto-pilot run plan.md
```

### 3. Check progress

```bash
claude-auto-pilot status
```

### 4. Resume interrupted runs

```bash
claude-auto-pilot resume
```

## Task Format

```
- [ ] [id: <task-id>] [auto|review] (depends: <id1>, <id2>) <description> — <detail>
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique task identifier |
| `auto\|review` | Yes | `auto` = merge after tests pass; `review` = wait for human approval |
| `depends` | No | Comma-separated IDs of tasks this depends on |
| `description` | Yes | What to implement |
| `detail` | No | Additional specification (after `—`) |

## GitHub Issues Mode

```bash
claude-auto-pilot run --github owner/repo
```

- Issues with `autopilot` label are treated as tasks
- `auto` / `review` labels set the execution mode
- `depends: issue-1, issue-2` in the issue body declares dependencies

## Architecture

CLI orchestrator that parses tasks, manages execution order, and coordinates `claude -p` sessions.

```
src/
├── parser/
│   ├── markdown.ts        # Markdown checklist parser
│   └── github.ts          # GitHub Issues parser
├── validator/
│   ├── plan-validator.ts  # Pre-execution plan quality check
│   └── validator.ts       # Post-execution code validation (tsc + test + build)
├── queue/queue.ts         # Dependency analysis + parallel grouping
├── executor/executor.ts   # claude -p stdin pipe execution
├── publisher/publisher.ts # Branch + commit + PR + merge
├── reviewer/reviewer.ts   # PR approval polling
├── rate-limiter/limiter.ts # Rate limit detection + health check recovery
├── state/state.ts         # Progress persistence (~/.claude-autopilot/state.json)
├── orchestrator.ts        # Main pipeline: group → execute → validate → publish
├── cli.ts                 # CLI entry point (run / status / resume)
└── types.ts               # Shared types
```

### Execution Modes

- **auto**: tests pass → auto-merge → move to next task
- **review**: create PR → poll for approval → merge on APPROVED → next task
- Tasks within the same parallel group run concurrently via `Promise.all`

### Resilience

- **Rate limit**: detect from stderr → save state → health-check loop → auto-resume
- **Retry**: validation failure → re-execute up to 3 times
- **State persistence**: `~/.claude-autopilot/state.json` — resume anytime with `claude-auto-pilot resume`

## Requirements

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command)
- [GitHub CLI](https://cli.github.com/) (`gh` command, authenticated)

## Development

```bash
git clone https://github.com/ybin4548/claude-autopilot.git
cd claude-autopilot
npm install
npm run build
npm test
```

## License

[MIT](LICENSE)
