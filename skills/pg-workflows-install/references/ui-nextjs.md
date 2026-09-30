# Dashboard in a Next.js app

`@pg-workflows/ui` adds React components plus a server adapter that exposes the runs over HTTP. The browser only talks to that API, never to the database.

Requirements: React >= 18, Tailwind CSS v4, and `@tanstack/react-query` >= 5. If the app has no Tailwind v4, tell the user you'll add it (`tailwindcss` and `@tailwindcss/postcss`, plus a `postcss.config.mjs`) before continuing. If it's on Tailwind v3, ask before upgrading.

## 1. Install

```bash
npm install @pg-workflows/ui @tanstack/react-query
```

`pg-workflows` and `pg` are already installed from the engine step.

## 2. Pick what backs the API

| Layout | Source for the adapter |
|--------|------------------------|
| Monolith | `getEngine` from the engine module. |
| Web app plus worker, or microservices | `getWorkflowClient`, a function that returns the app's `WorkflowClient`. Don't create a `WorkflowEngine` in the web app just for the dashboard: its workers would pull runs for workflows it hasn't registered. |

With a client, the runs table shows progress only from each run's saved timeline, because the client can't count a workflow's total steps.

## 3. Mount the API

**App Router.** Add one optional catch-all route:

```typescript
// app/workflow-runs/[[...path]]/route.ts
import { createAppRouterHandler } from '@pg-workflows/ui/next'
import { getEngine } from '@/workflows/engine' // or getWorkflowClient

export const { GET, POST } = createAppRouterHandler({ engine: getEngine })
```

Pass the function (`getEngine`), not its result (`getEngine()`). The adapter calls it on each request and awaits `start()` once, so `next build` can import the route without a database.

**Pages Router.** Set `basePath` to the public URL:

```typescript
// pages/api/workflow-runs/[[...path]].ts
import { createPagesApiHandler } from '@pg-workflows/ui/next'
import { getEngine } from '@/workflows/engine' // or getWorkflowClient

export default createPagesApiHandler({ engine: getEngine, basePath: '/api/workflow-runs' })
```

Use the app's `src/` and alias conventions for the paths.

## 4. Add the styles

In the global stylesheet that already imports Tailwind:

```css
@import 'tailwindcss';
@import '@pg-workflows/ui/styles.css';

@source '../node_modules/@pg-workflows/ui/dist';
```

The `@source` path is relative to the CSS file. Adjust it until it points at `node_modules/@pg-workflows/ui/dist` from there. In a monorepo with hoisted dependencies, that may be the root `node_modules`.

## 5. Render the dashboard

```tsx
// app/workflows/page.tsx
import { WorkflowRunsDashboard } from '@pg-workflows/ui'

export default function WorkflowsPage() {
  return <WorkflowRunsDashboard baseUrl="/workflow-runs" />
}
```

Use `baseUrl="/api/workflow-runs"` with the Pages Router. The components carry their own `'use client'` directives, so a Server Component can render them. Put the page wherever the app keeps its admin or internal pages.

## 6. Protect it

The adapter has no auth, and without `resolveContext` it reads and changes **every** run in the database.

- Put both the page and the API route behind the app's existing auth, using the same check its other admin or internal pages use.
- If several tenants share the database, scope every call to the caller's tenant:

  ```typescript
  createAppRouterHandler({
    engine: getEngine,
    // Return the caller's tenant. Throw to respond with 401.
    resolveContext: async (req) => ({ resourceId: await getTenantId(req) }),
  })
  ```

  `getTenantId` stands for the app's own session lookup. Runs must be started with the same `resourceId` for this to match them.

If the app has no auth at all, tell the user the dashboard is open to anyone who can reach the app, and let them decide.

## 7. Verify

Run the dev server, open the dashboard page, and check that it lists the run from the engine step. Open that run and confirm the step output shows. Then `curl` the API route (`/workflow-runs`) without a session and confirm it's rejected, unless the user accepted an open dashboard.
