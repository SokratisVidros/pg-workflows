import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // The repo root AGENTS.md covers this app.
  agentRules: false,
  // No image optimizer in a static export: serve images as plain files.
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default withMDX(config);
