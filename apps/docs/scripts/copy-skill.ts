/**
 * Publishes `skills/pg-workflows-install` into `public/` so the static site
 * serves it next to the docs:
 *
 * - `/skill/SKILL.md` and `/skill/references/*.md` mirror the skill folder, so
 *   its relative links keep working.
 * - `/skill.md` is the short URL the copy-prompt points at. It lives one level
 *   up, so its `references/…` links are rewritten to absolute URLs.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentPrompt, siteUrl } from '../lib/site';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = join(root, '../../skills/pg-workflows-install');
const publicDir = join(root, 'public');

await rm(join(publicDir, 'skill'), { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await cp(skillDir, join(publicDir, 'skill'), { recursive: true });

const skill = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
const rewritten = skill.replaceAll('](references/', `](${siteUrl}/skill/references/`);
await writeFile(join(publicDir, 'skill.md'), rewritten);

// The README repeats the home page's prompt. Fail the build if they drift apart.
const readme = await readFile(join(root, '../../README.md'), 'utf8');
if (!readme.includes(agentPrompt)) {
  throw new Error(
    'README.md no longer contains agentPrompt from lib/site.ts. Update one to match the other.',
  );
}

process.stdout.write('Copied skills/pg-workflows-install to public/skill and public/skill.md\n');
