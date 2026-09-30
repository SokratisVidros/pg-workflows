import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Workflow } from 'lucide-react';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold">
          <span className="flex size-6 items-center justify-center rounded-md bg-fd-primary text-fd-primary-foreground">
            <Workflow className="size-3.5" aria-hidden />
          </span>
          {appName}
        </span>
      ),
    },
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'Skill', url: '/docs/install-with-agent' },
      { text: 'npm', url: 'https://www.npmjs.com/package/pg-workflows', external: true },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
