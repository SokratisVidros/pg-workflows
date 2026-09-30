# Dashboard with Express, Fastify, Hono, TanStack Start, Bun, or Deno

`@pg-workflows/ui` has two halves:

- **Server:** `createWorkflowRunsApi` exposes runs over HTTP under a base path (default `/workflow-runs`). Mount it on the server.
- **Browser:** `<WorkflowRunsDashboard/>`, a React component that calls that API. Render it in the React frontend.

The adapter sends no CORS headers, so the browser must reach the API on the same origin as the page. In development, proxy the path from the frontend's dev server (see step 5).

Requirements for the frontend: React >= 18, Tailwind CSS v4, and `@tanstack/react-query` >= 5. If the frontend has no Tailwind v4, tell the user you'll add it before continuing. If it's on Tailwind v3, ask before upgrading.

## 1. Install

In the server package (it already has `pg-workflows` and `pg`):

```bash
npm install @pg-workflows/ui
```

In the React frontend, if it's a separate package:

```bash
npm install @pg-workflows/ui @tanstack/react-query
```

## 2. Create the API

```typescript
// src/workflows/runs-api.ts
import { createWorkflowRunsApi } from '@pg-workflows/ui/server'
import { getEngine } from './engine' // monolith

export const runsApi = createWorkflowRunsApi({ engine: getEngine(), basePath: '/workflow-runs' })
```

In the web app plus worker and microservices layouts, pass the service's `WorkflowClient` as `engine`. Don't create a `WorkflowEngine` just for the dashboard: its workers would pull runs for workflows it hasn't registered. With a client, the runs table shows progress only from each run's saved timeline.

`basePath` must equal the public path you mount it on.

## 3. Mount it

**Express**

```typescript
import { toNodeHandler } from '@pg-workflows/ui/server'
import { runsApi } from './workflows/runs-api'

app.use('/workflow-runs', requireAdmin, toNodeHandler(runsApi))
```

Register this before any global `express.json()`, or exclude this path from it. The adapter reads the raw body itself, and a body parser that runs first leaves it empty.

**Fastify.** Fastify parses JSON bodies before the handler runs, so rebuild the Web `Request` from the parsed body:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify'
import { runsApi } from './workflows/runs-api'

async function handleRuns(req: FastifyRequest, reply: FastifyReply) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key === 'content-length') continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined
  const response = await runsApi.fetch(
    new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : undefined,
    }),
  )
  reply.status(response.status)
  response.headers.forEach((value, key) => reply.header(key, value))
  return reply.send(Buffer.from(await response.arrayBuffer()))
}

app.all('/workflow-runs', { preHandler: requireAdmin }, handleRuns)
app.all('/workflow-runs/*', { preHandler: requireAdmin }, handleRuns)
```

**Hono**

```typescript
app.use('/workflow-runs/*', requireAdmin)
app.all('/workflow-runs', (c) => runsApi.fetch(c.req.raw))
app.all('/workflow-runs/*', (c) => runsApi.fetch(c.req.raw))
```

**TanStack Start.** The list path and the splat need separate route files, because `/workflow-runs/$` doesn't match `GET /workflow-runs`:

```typescript
// src/routes/workflow-runs.index.ts
import { createFileRoute } from '@tanstack/react-router'
import { runsApi } from '../workflows/runs-api'

export const Route = createFileRoute('/workflow-runs')({
  server: { handlers: { GET: ({ request }) => runsApi.fetch(request) } },
})
```

```typescript
// src/routes/workflow-runs/$.ts
import { createFileRoute } from '@tanstack/react-router'
import { runsApi } from '../../workflows/runs-api'

const handle = ({ request }: { request: Request }) => runsApi.fetch(request)

export const Route = createFileRoute('/workflow-runs/$')({
  server: { handlers: { GET: handle, POST: handle } },
})
```

**Bun and Deno.** Route the base path to the API, and everything else to the existing handler:

```typescript
Bun.serve({
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === '/workflow-runs' || pathname.startsWith('/workflow-runs/')) {
      return runsApi.fetch(request)
    }
    return app.fetch(request)
  },
})
```

`requireAdmin` stands for the server's existing auth middleware. Use whatever its other internal routes use.

## 4. Scope to tenants when the database is shared

Without `resolveContext`, the API reads and changes **every** run in the database. If several tenants share it, return the caller's tenant:

```typescript
createWorkflowRunsApi({
  engine: getEngine(),
  basePath: '/workflow-runs',
  // Throw to respond with 401.
  resolveContext: async (req) => ({ resourceId: await getTenantId(req) }),
})
```

`getTenantId` stands for the app's own session lookup. Runs must be started with the same `resourceId` for this to match them.

## 5. Render the dashboard

Add the styles to the global stylesheet that imports Tailwind:

```css
@import 'tailwindcss';
@import '@pg-workflows/ui/styles.css';

@source '../node_modules/@pg-workflows/ui/dist';
```

The `@source` path is relative to the CSS file. Adjust it to reach `node_modules/@pg-workflows/ui/dist` (the root `node_modules` if dependencies are hoisted).

Render the component on an internal page:

```tsx
import { WorkflowRunsDashboard } from '@pg-workflows/ui'

export function WorkflowsPage() {
  return <WorkflowRunsDashboard baseUrl="/workflow-runs" />
}
```

If the frontend runs on its own dev server (Vite, for example), proxy the API path to the backend:

```typescript
// vite.config.ts
export default defineConfig({
  server: { proxy: { '/workflow-runs': 'http://localhost:3000' } },
})
```

Use the backend's real port. In production, serve the frontend and the API from the same origin, or put the same path rule on the reverse proxy.

## 6. Verify

Open the dashboard page and check that it lists the run from the engine step, and that opening the run shows its step output. Then request `/workflow-runs` without a session and confirm the auth middleware rejects it, unless the user accepted an open dashboard.
