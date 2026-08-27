/**
 * Rewrites relative import specifiers in the built output to carry explicit
 * extensions, so the package is importable by Node's ESM loader.
 *
 * `tsc` emits specifiers exactly as written in source, and the source uses
 * `moduleResolution: "Bundler"` (extensionless, e.g. `from './api'`). Bundlers
 * resolve that fine; Node does not, and `./server` is meant to run under plain
 * Node (Express, the standalone CLI). We can't simply switch the source to
 * NodeNext without rewriting every import in the package, and we can't bundle
 * instead, because bundling strips the `'use client'` directives that the
 * React Server Components boundary depends on.
 *
 * Each specifier is resolved against the emitted tree rather than pattern-matched,
 * so a directory import becomes `/index.js` and a file import becomes `.js`.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

/** Matches the specifier in static import/export and dynamic import() forms. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bexport\s*\*\s*from\s*)(['"])(\.[^'"]*)\2/g;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolves an extensionless relative specifier to a Node-loadable one. */
async function resolveSpecifier(specifier, fileDir, declaration) {
  // Already explicit — leave it alone.
  if (/\.(js|mjs|cjs|json|css)$/.test(specifier)) return specifier;

  const target = resolve(fileDir, specifier);
  const ext = declaration ? '.d.ts' : '.js';

  if (await exists(target + ext)) return `${specifier}.js`;
  if (await exists(join(target, `index${ext}`))) return `${specifier}/index.js`;

  // Unresolvable against the emitted tree: leave untouched rather than emit a
  // specifier that is confidently wrong, and let the caller report it.
  return null;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let rewritten = 0;
const unresolved = [];

for await (const file of walk(DIST)) {
  const declaration = file.endsWith('.d.ts');
  if (!declaration && !file.endsWith('.js')) continue;

  const source = await readFile(file, 'utf8');
  const fileDir = dirname(file);

  // Collect replacements first: the regex is global and the callback must be sync.
  const edits = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const [full, keyword, quote, specifier] = match;
    const next = await resolveSpecifier(specifier, fileDir, declaration);
    if (next === null) {
      unresolved.push(`${file}: ${specifier}`);
      continue;
    }
    if (next !== specifier) {
      edits.push([full, `${keyword}${quote}${next}${quote}`]);
    }
  }

  if (edits.length === 0) continue;

  let output = source;
  for (const [from, to] of edits) output = output.replace(from, to);
  await writeFile(file, output);
  rewritten += edits.length;
}

if (unresolved.length > 0) {
  process.stderr.write(`Could not resolve ${unresolved.length} specifier(s) against dist/:\n`);
  for (const line of unresolved) process.stderr.write(`  ${line}\n`);
  process.exit(1);
}

process.stdout.write(`Rewrote ${rewritten} relative specifier(s) for Node ESM.\n`);
