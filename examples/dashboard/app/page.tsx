import { WorkflowRunsDashboard } from '@pg-workflows/ui';

/**
 * A server component rendering the dashboard. The components carry their own
 * `'use client'` directives, so importing them from here is the whole point of
 * the package preserving module structure instead of bundling.
 */
export default function Page() {
  return (
    <main className="mx-auto min-h-screen w-full px-[clamp(1rem,3vw,2.5rem)] py-[clamp(1.25rem,3vw,2.5rem)]">
      <header className="mb-6 flex items-end justify-between gap-3 sm:mb-8">
        <div>
          <p className="text-xs font-medium text-pgw-muted-fg">pg-workflows</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Workflows</h1>
        </div>
      </header>
      <WorkflowRunsDashboard baseUrl="/workflow-runs" />
    </main>
  );
}
