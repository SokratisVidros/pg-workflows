/**
 * bun pack skips a README.md symlink that points outside the package, so the
 * published tarball has no readme and npm renders an empty page.
 *
 * `materialize` replaces that symlink with the file it points at for the
 * duration of the pack. `restore` puts the symlink back. The original target
 * is stored outside the package so a crashed pack can still be repaired.
 */
import { lstat, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const readmePath = resolve(process.cwd(), 'README.md');
const markerPath = resolve(
  tmpdir(),
  `pg-workflows-readme-${Buffer.from(process.cwd()).toString('hex')}`,
);

const command = process.argv[2];

if (command === 'materialize') {
  await materialize();
} else if (command === 'restore') {
  await restore();
} else {
  console.error('Usage: package-readme.mjs <materialize|restore>');
  process.exit(1);
}

async function materialize() {
  let stat;
  try {
    stat = await lstat(readmePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isSymbolicLink()) return;

  const link = await readlink(readmePath);
  const contents = await readFile(resolve(dirname(readmePath), link));
  await writeFile(markerPath, link);
  await unlink(readmePath);
  await writeFile(readmePath, contents);
}

async function restore() {
  let link;
  try {
    link = await readFile(markerPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  await unlink(readmePath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await symlink(link, readmePath);
  await unlink(markerPath);
}
