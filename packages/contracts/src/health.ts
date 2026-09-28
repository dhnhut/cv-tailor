import * as z from 'zod';
import { contracts } from './registry.ts';

export const HealthResponse = z
  .strictObject({ status: z.literal('ok').describe('Always "ok" when the service is up.') })
  .describe('Liveness check response.'); // .describe() becomes "description" in JSON Schema, and then a docstring on the Python class.
HealthResponse.register(contracts, { id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponse>;
