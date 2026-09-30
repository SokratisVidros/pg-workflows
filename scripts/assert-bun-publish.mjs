// npm publish ships `catalog:` and `workspace:` ranges verbatim, which makes the
// package uninstallable. bun publish (and `bun pm pack`) rewrite them to real ranges.
if (!process.env.npm_config_user_agent?.startsWith('bun/')) {
  console.error(
    'Publish with `bun publish`, or `npm publish <tarball>` on a tarball from `bun pm pack`.',
  );
  process.exit(1);
}
