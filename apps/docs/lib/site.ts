export const siteUrl = 'https://pgworkflows.dev';

export const skillUrl = `${siteUrl}/skill.md`;

/** The prompt the home page's main CTA copies. The README links to the same skill. */
export const agentPrompt = `Add pg-workflows to this project. Fetch ${skillUrl} and follow it step by step: pick the right layout for this codebase (monolith, web app plus worker, or microservices), install and verify the engine, add the @pg-workflows/ui dashboard for our stack, then ask me whether to add OpenTelemetry tracing.`;
