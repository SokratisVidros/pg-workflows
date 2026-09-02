/**
 * Shared workflow refs - imported by both API and worker services.
 *
 * These carry only the workflow ID and input schema.
 * No handler code, no heavy dependencies.
 */
import { createWorkflowRef } from 'pg-workflows/client';
import { z } from 'zod';

export const onboardUser = createWorkflowRef('onboard-user', {
  inputSchema: z.object({
    email: z.string().email(),
    name: z.string().min(1),
  }),
});

export const processPayment = createWorkflowRef('process-payment', {
  inputSchema: z.object({
    orderId: z.string(),
    amount: z.number().positive(),
    currency: z.string().default('USD'),
  }),
});
