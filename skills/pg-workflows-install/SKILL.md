---
name: pg-workflows-install
description: Add pg-workflows (durable workflows on PostgreSQL) to an existing TypeScript project. Picks the layout from the architecture (monolith, web app plus worker, microservices), wires up the engine, mounts the @pg-workflows/ui dashboard for the project's stack, and optionally adds OpenTelemetry tracing with @pg-workflows/otel. Use when asked to install, set up, or add pg-workflows, its dashboard, or its tracing.
---

# Install pg-workflows

You are adding [pg-workflows](https://pgpworkflows.dev) to the user's project. pg-workflows is a TypeScript workflow engine that stores every step's result in PostgreSQL and uses PostgreSQL as its job queue. There's no Redis, broker, or separate scheduler.

Work through the steps in order. Each step ends on a **done when** line. Don't start the next step until it holds.

## Facts every layout depends on

- **Packages.** `pg-workflows` (engine and client), `pg` (peer dependency), and a Standard Schema library for typed input (use `zod` unless the project already uses Valibot or ArkType). The engine needs Node.js >= 18 and PostgreSQL >= 10.
- **Two entry points.** `WorkflowEngine` from `pg-workflows` registers workflows and **executes** them in-process workers. `WorkflowClient` from `pg-workflows/client` only starts, controls, and queries runs. It loads no handler code.
- **One queue per database.** Every engine that has called `start()` pulls from the same queue. An engine that picks up a run for a workflow it hasn't registered fails that attempt with `Workflow <id> not found`. So every process that runs `WorkflowEngine` workers must register **every** workflow definition in that database.
- **Long-lived process.** Engine workers poll the queue, so they need a process that stays up: a server, a container, or a VM. Serverless functions (Vercel, Netlify, AWS Lambda, Cloudflare Workers) can use `WorkflowClient`, but they can't host the engine's workers.
- **Migrations.** `engine.start()` and `client.start()` create `public.workflow_runs` and the `pgboss_v12_pgworkflow` schema on first run.
- **Connection string.** The engine doesn't read `DATABASE_URL` by itself. Pass `connectionString` or an existing `pg.Pool` to the constructor.

## 1. Inspect the project

Read the repo before asking anything. Find:

- **Package manager**, from the lockfile: `bun.lock` → `bun add`, `pnpm-lock.yaml` → `pnpm add`, `yarn.lock` → `yarn add`, otherwise `npm install`. In a monorepo, install into the package that uses it, not the root.
- **Services.** Which packages or apps run as their own process (`apps/*`, `services/*`, several Dockerfiles, `docker-compose.yml`, a `Procfile`), and which HTTP framework each uses (`next`, `express`, `fastify`, `hono`, `@tanstack/react-start`, `Bun.serve`, `Deno.serve`).
- **Hosting.** Serverless (`vercel.json`, `netlify.toml`, `serverless.yml`, `wrangler.toml`) or long-running (Dockerfile, Railway, Fly, Render, Kubernetes manifests).
- **Postgres.** An existing connection string (`DATABASE_URL` in `.env*`, Prisma, Drizzle, or Knex config) and a `docker-compose.yml` Postgres service.
- **Frontend.** React version and whether Tailwind CSS v4 is set up. The dashboard needs both.
- **Tracing.** Any existing OpenTelemetry setup: `@opentelemetry/*` packages, `@vercel/otel`, an `instrumentation.ts`, Sentry, or `dd-trace`.

**Done when** you can name the package manager, every service and its framework, where it's hosted, and the Postgres connection the workflows will use.

## 2. Pick the layout

| Layout | Pick it when | Reference |
|--------|--------------|-----------|
| **Monolith** | One long-running service does the work and can load the workflow code. | [references/monolith.md](references/monolith.md) |
| **Web app plus worker** | One codebase, but the web tier is serverless, or it shouldn't carry heavy workflow dependencies such as LLM SDKs, or you want to scale workflow execution separately. The same repo adds a worker process. | [references/worker.md](references/worker.md) |
| **Microservices** | Several separately deployed services start or control workflows. One worker service owns the workflow code. | [references/microservices.md](references/microservices.md) |

If the inspection points to one row, tell the user which layout you picked and why, in one sentence, and continue. If two rows fit, for example a monolith on a long-running host that the user might split later, ask the user one question with your recommendation first.

A monolith can later move to a worker layout without migrating any data. Both layouts use the same tables.

**Done when** the user has either confirmed the layout or not objected to your one-sentence choice.

## 3. Install the engine

Open the reference for the chosen layout and follow it end to end. Use the project's existing conventions for file locations, env loading, module format, and code style. The paths in the references are defaults.

Before the first `start()`, confirm with the user that the target database is theirs to change. Migrations create tables in it. If there is no database, offer the local Docker command in the reference.

**Done when** the reference's verification passes: a real run reaches `completed` against the project's database, and you've shown the user the output.

## 4. Add the dashboard

`@pg-workflows/ui` gives the user a page for browsing runs, inspecting step output, and cancelling, pausing, resuming, or triggering runs. Recommend it, and add it unless the user declines.

- **Next.js** (App Router or Pages Router): [references/ui-nextjs.md](references/ui-nextjs.md)
- **Express, Fastify, Hono, TanStack Start, Bun, or Deno**, with a React frontend: [references/ui-servers.md](references/ui-servers.md)
- **No React frontend.** Point the user to the standalone dashboard for local use: `npx @pg-workflows/ui --database-url=<url>`. It binds to `127.0.0.1` and has no auth, so it's for local databases only. Then skip to step 5.

Mount the dashboard's API in a service that talks to the database. In the worker and microservices layouts, that's a web or API service backed by a `WorkflowClient`, not the worker.

**Done when** the dashboard page loads in the running app and lists the run from step 3, and its API route sits behind the app's existing auth, or the user has explicitly accepted it being open.

## 5. Offer tracing (optional)

Ask the user whether they want OpenTelemetry traces for workflow runs and steps. If they do, follow [references/otel.md](references/otel.md). If they don't, skip this step.

**Done when** the user has declined, or a traced run's `pg_workflows.workflow.run` span and its step spans show up in their exporter or in the console.

## 6. Report

Tell the user:

- which layout you chose and every file you added or changed
- the commands to run the app, and the worker if there is one
- what each new process needs in production: `DATABASE_URL`, and a long-running host for the worker
- where to go next: https://pgpworkflows.dev/docs (the step types are `step.run`, `step.waitFor`, `step.delay`, `step.poll`, and `step.invokeChildWorkflow`)
