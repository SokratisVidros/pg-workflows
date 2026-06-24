// Re-export WorkflowRun from pg-workflows/client. The runtime shape is
// documented in the "pg-workflows engine API reference" section at the
// top of this plan. Downstream files import `WorkflowRun` from this
// module rather than reaching directly into pg-workflows, so swapping
// transports later (gRPC, tRPC, etc.) only touches this file.
export type { WorkflowRun } from 'pg-workflows/client';
