import { createAppRouterHandler } from '@pg-workflows/ui/next';
import { runsApi } from '@/lib/runs-api';

// Optional catch-all: GET /workflow-runs (list) and POST /workflow-runs/:id/* share one file.
export const { GET, POST } = createAppRouterHandler(runsApi);
