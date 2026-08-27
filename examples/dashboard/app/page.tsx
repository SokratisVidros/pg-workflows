import { WorkflowRunsDashboard } from '@pg-workflows/ui';

/**
 * A server component rendering the dashboard. The components carry their own
 * `'use client'` directives, so importing them from here is the whole point of
 * the package preserving module structure instead of bundling.
 */
export default function Page() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Workflow runs</h1>
        <p className="text-sm text-pgw-muted-fg">
          Seed data with <code className="font-mono">npm run seed</code>.
        </p>
      </header>
      <WorkflowRunsDashboard baseUrl="/workflow-runs" />
    </main>
  );
}
