import { createHmac } from 'node:crypto';

export function createToken(runId: string, stepId: string, secret: string): string {
  const payload = `${runId}:${stepId}`;
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const hmac = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 12);
  return `${encoded}-${hmac}`;
}

