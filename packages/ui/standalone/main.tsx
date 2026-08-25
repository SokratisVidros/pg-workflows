import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowRunsDashboard } from '../src/index';
import './styles.css';

/**
 * Entry point for the `npx` standalone. The CLI serves this bundle and mounts
 * the run adapter at the same origin, so a relative `baseUrl` is all we need.
 */
const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing #root');
}

createRoot(container).render(
  <StrictMode>
    <main className="pgw-root min-h-screen">
      <div className="mx-auto max-w-7xl p-6">
        <h1 className="mb-6 text-xl font-semibold">Workflow runs</h1>
        <WorkflowRunsDashboard baseUrl="/workflow-runs" />
      </div>
    </main>
  </StrictMode>,
);
