import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // The repo root AGENTS.md covers this app.
  agentRules: false,
  reactStrictMode: true,
};

export default withMDX(config);
