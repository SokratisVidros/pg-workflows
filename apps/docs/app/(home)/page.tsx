import {
  Activity,
  BookOpen,
  Boxes,
  Clock,
  LayoutDashboard,
  type LucideIcon,
  Rocket,
  Sparkles,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { CopyPrompt } from '@/components/copy-prompt';

const sections: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  {
    title: 'Quickstart',
    description: 'Run your first durable workflow against Postgres in about two minutes.',
    href: '/docs/quickstart',
    icon: Rocket,
  },
  {
    title: 'Install with an agent',
    description: 'What the install skill does, and how to add it to your agent.',
    href: '/docs/install-with-agent',
    icon: Sparkles,
  },
  {
    title: 'Deployment layouts',
    description: 'One service, a web app plus a worker, or many services.',
    href: '/docs/layouts',
    icon: Boxes,
  },
  {
    title: 'Workflows and steps',
    description: 'Durable steps, events, timers, polling, and child workflows.',
    href: '/docs/concepts/workflows',
    icon: Workflow,
  },
  {
    title: 'Recurring schedules',
    description: 'Cron expressions and fixed intervals, with singleton overlap control.',
    href: '/docs/concepts/recurring-schedules',
    icon: Clock,
  },
  {
    title: 'Dashboard',
    description: 'Browse, inspect, and control runs with @pg-workflows/ui.',
    href: '/docs/ui',
    icon: LayoutDashboard,
  },
  {
    title: 'Tracing',
    description: 'OpenTelemetry spans for every execution and step.',
    href: '/docs/observability/tracing',
    icon: Activity,
  },
  {
    title: 'API reference',
    description: 'WorkflowEngine, WorkflowClient, workflow(), and every type.',
    href: '/docs/reference/api',
    icon: BookOpen,
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
      <section className="mx-auto max-w-3xl text-center">
        <p className="mb-4 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-fd-muted-foreground">
          Open source · MIT · PostgreSQL ≥ 10
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Durable workflows on the Postgres you already run
        </h1>
        <p className="mt-5 text-lg text-fd-muted-foreground">
          pg-workflows saves every step's result in PostgreSQL, retries from the step that failed,
          and pauses for events, timers, or polled conditions. No Redis, no broker, no scheduler.
        </p>
      </section>

      <section className="mx-auto mt-10 max-w-3xl">
        <CopyPrompt />
        <div className="mt-4 flex flex-col items-center justify-center gap-3 text-sm text-fd-muted-foreground sm:flex-row">
          <span>Or install it yourself:</span>
          <code className="rounded-md border bg-fd-muted/50 px-2.5 py-1 font-mono text-[13px] text-fd-foreground">
            npm install pg-workflows pg zod
          </code>
          <Link
            href="/docs/quickstart"
            className="font-medium text-fd-foreground underline underline-offset-4"
          >
            Quickstart →
          </Link>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-fd-muted-foreground">
          Explore the docs
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map(({ title, description, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-xl border bg-fd-card p-5 transition-colors hover:bg-fd-accent"
            >
              <Icon className="mb-4 size-5 text-fd-primary" aria-hidden />
              <h3 className="font-medium">{title}</h3>
              <p className="mt-1.5 text-sm text-fd-muted-foreground">{description}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
