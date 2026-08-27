#!/usr/bin/env node
/**
 * Standalone workflow-runs dashboard.
 *
 *   npx @pg-workflows/ui --database-url=postgres://… [--port=3777]
 *
 * Starts an engine against the given database, mounts the run adapter, and
 * serves the prebuilt SPA from `dist/standalone/`.
 *
 * Binds 127.0.0.1 only. There is no authentication and no `resolveContext`, so
 * every run in the database is readable and mutable by anyone who can reach the
 * port — localhost is the entire trust boundary. Do not expose it.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3777;
const BASE_PATH = '/workflow-runs';
const STATIC_ROOT = resolve(fileURLToPath(new URL('../dist/standalone', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, databaseUrl: process.env.DATABASE_URL };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'database-url') args.databaseUrl = value;
    else if (key === 'port') args.port = Number(value);
  }

  return args;
}

const USAGE = `
Usage: npx @pg-workflows/ui --database-url=<postgres-url> [--port=${DEFAULT_PORT}]

Options:
  --database-url=<url>  Postgres connection string (or set DATABASE_URL)
  --port=<number>       Port to listen on (default ${DEFAULT_PORT})
  -h, --help            Show this message

Serves a read/write dashboard on http://${HOST}:<port>, bound to localhost with
no authentication.
`;

async function serveStatic(req, res) {
  // Strip the query string and refuse to escape the bundle directory.
  const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
  const candidate = resolve(join(STATIC_ROOT, normalize(path)));
  const target =
    candidate.startsWith(STATIC_ROOT) && (await isFile(candidate))
      ? candidate
      : join(STATIC_ROOT, 'index.html'); // SPA fallback

  if (!(await isFile(target))) {
    res.statusCode = 500;
    res.end(
      'Standalone bundle is missing. If you are running from a clone, build it with `bun run build`.',
    );
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', MIME[extname(target)] ?? 'application/octet-stream');
  createReadStream(target).pipe(res);
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (!args.databaseUrl) {
    process.stderr.write(`Missing --database-url (or DATABASE_URL).\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    process.stderr.write(`Invalid --port: ${args.port}\n`);
    process.exitCode = 1;
    return;
  }

  // `pg-workflows` is a peer dependency, so it may genuinely be absent.
  let WorkflowEngine;
  try {
    ({ WorkflowEngine } = await import('pg-workflows'));
  } catch (cause) {
    process.stderr.write(
      'Could not load `pg-workflows`. Install it alongside this package:\n' +
        '  npm install pg-workflows pg\n' +
        `\n${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const { createWorkflowRunsApi, toNodeHandler } = await import('../dist/server/index.js');

  const engine = new WorkflowEngine({ connectionString: args.databaseUrl });

  // Starting the engine registers no workflows — this process only reads runs
  // and enqueues lifecycle actions for whichever app owns the definitions.
  await engine.start();

  const api = createWorkflowRunsApi({ engine, basePath: BASE_PATH });
  const apiHandler = toNodeHandler(api.fetch);

  const server = createServer((req, res) => {
    const handler = (req.url ?? '').startsWith(BASE_PATH) ? apiHandler : serveStatic;
    Promise.resolve(handler(req, res)).catch((error) => {
      process.stderr.write(`Request failed: ${error?.stack ?? error}\n`);
      if (!res.headersSent) res.statusCode = 500;
      res.end('Internal error');
    });
  });

  const shutdown = async () => {
    server.close();
    await engine.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(args.port, HOST, () => {
    process.stdout.write(`pg-workflows dashboard on http://${HOST}:${args.port}\n`);
    process.stdout.write('Localhost only, no authentication. Ctrl-C to stop.\n');
  });
}

await main();
