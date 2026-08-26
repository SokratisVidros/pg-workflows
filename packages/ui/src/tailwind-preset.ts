import type { Config } from 'tailwindcss';

const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        'pgw-bg': 'var(--pgw-bg)',
        'pgw-fg': 'var(--pgw-fg)',
        'pgw-muted': 'var(--pgw-muted)',
        'pgw-muted-fg': 'var(--pgw-muted-fg)',
        'pgw-border': 'var(--pgw-border)',
        'pgw-accent': 'var(--pgw-accent)',
        'pgw-status-completed': 'var(--pgw-status-completed)',
        'pgw-status-failed': 'var(--pgw-status-failed)',
        'pgw-status-running': 'var(--pgw-status-running)',
        'pgw-status-paused': 'var(--pgw-status-paused)',
        'pgw-status-cancelled': 'var(--pgw-status-cancelled)',
        'pgw-status-pending': 'var(--pgw-status-pending)',
      },
    },
  },
};

export default preset;
