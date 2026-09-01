import type { IncomingMessage, ServerResponse } from 'node:http';
import { toErrorResponse } from './errors';
import { type FetchHandlerSource, toFetchHandler } from './fetch';

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

type NodeReq = IncomingMessage & { originalUrl?: string };

export function toNodeHandler(source: FetchHandlerSource) {
  const fetchHandler = toFetchHandler(source);
  return async (req: NodeReq, res: ServerResponse): Promise<void> => {
    try {
      const host = req.headers.host ?? 'localhost';
      const url = `http://${host}${req.originalUrl ?? req.url ?? '/'}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const body = await readBody(req);
      const request = new Request(url, { method: req.method, headers, body: body as BodyInit });
      const response = await fetchHandler(request);
      await writeResponse(res, response);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      await writeResponse(res, toErrorResponse(err));
    }
  };
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
