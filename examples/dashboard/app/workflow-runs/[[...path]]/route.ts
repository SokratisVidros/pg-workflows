import { createAppRouterHandler } from '@pg-workflows/ui/next';
import { getEngine } from '@/lib/engine';

// Optional catch-all: GET /workflow-runs (list) and POST /workflow-runs/:id/* share one file.
// Pass `getEngine`, not `getEngine()`. The handler calls it per request, awaits
// `engine.start()` once, and builds the run API from that engine.
export const { GET, POST } = createAppRouterHandler({ engine: getEngine });
