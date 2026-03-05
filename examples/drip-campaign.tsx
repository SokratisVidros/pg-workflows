/**
 * Drip Email Campaign — pg-workflows + email plugin + React Email + Mailgun
 *
 * A four-email onboarding sequence that adapts in real time based on how the
 * subscriber interacts with each message:
 *
 *   Email 1  Welcome               → sent immediately on signup
 *     ↓ waitForOpen (5 days)
 *     ├─ opened  → Email 2  Getting Started       → sent immediately on open
 *     │              ↓ waitForClick (3 days)
 *     │              ├─ clicked CTA → delay 1 day  → Email 3a  Power User Tips
 *     │              └─ no click   → delay 2 days  → Email 3b  Gentle Nudge
 *     │                                delay 3 days → Email 4   Final Offer
 *     └─ not opened → Email 2alt  Re-engagement   → exit
 *
 * Required environment variables:
 *   DATABASE_URL        postgres://...
 *   MAILGUN_API_KEY     your Mailgun API key
 *   MAILGUN_DOMAIN      e.g. mg.acme.com
 *   MAILGUN_FROM        e.g. Acme <hi@mg.acme.com>
 *   TRACKER_SECRET      shared HMAC secret for pgpass.ai tokens
 *   TRACKER_API_KEY     pgpass.ai API key for polling
 *
 * Run:
 *   npm run example:drip-campaign
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import FormData from 'form-data';
import Mailgun from 'mailgun.js';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import {
  type WorkflowDefinition,
  WorkflowEngine,
  type WorkflowRunProgress,
  workflow,
} from 'pg-workflows';
import { createEmailPlugin } from '../dist/plugins/email/index';
import type { ReactNode } from 'react';

// ─── Design tokens ────────────────────────────────────────────────────────────

const brand = {
  purple: '#6366f1',
  green: '#16a34a',
  text: '#1a1a1a',
  muted: '#6b7280',
  bg: '#f9fafb',
  cardBg: '#ffffff',
  border: '#e5e7eb',
};

// ─── Shared layout ────────────────────────────────────────────────────────────

function EmailShell({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ background: brand.bg, fontFamily: 'sans-serif', margin: 0, padding: 0 }}>
        <Container
          style={{
            maxWidth: 560,
            margin: '40px auto',
            background: brand.cardBg,
            borderRadius: 8,
            border: `1px solid ${brand.border}`,
            overflow: 'hidden',
          }}
        >
          {children}
        </Container>

        <Section style={{ textAlign: 'center', padding: '16px 0' }}>
          <Text style={{ fontSize: 12, color: brand.muted, margin: 0 }}>
            Acme Inc. · 123 Startup Lane · San Francisco, CA 94107
          </Text>
          <Text style={{ fontSize: 12, color: brand.muted, margin: '4px 0 0' }}>
            <Link href="https://app.acme.com/unsubscribe" style={{ color: brand.muted }}>
              Unsubscribe
            </Link>
          </Text>
        </Section>
      </Body>
    </Html>
  );
}

function EmailHeader({ title }: { title: string }) {
  return (
    <Section style={{ background: brand.purple, padding: '24px 32px' }}>
      <Heading
        style={{
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          margin: 0,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
        }}
      >
        {title}
      </Heading>
    </Section>
  );
}

function EmailBody({ children }: { children: ReactNode }) {
  return <Section style={{ padding: '32px' }}>{children}</Section>;
}

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      href={href}
      style={{
        background: brand.purple,
        color: '#fff',
        padding: '12px 24px',
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 15,
        textDecoration: 'none',
        display: 'inline-block',
      }}
    >
      {children}
    </Button>
  );
}

function GreenButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      href={href}
      style={{
        background: brand.green,
        color: '#fff',
        padding: '12px 24px',
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 15,
        textDecoration: 'none',
        display: 'inline-block',
      }}
    >
      {children}
    </Button>
  );
}

function Signature() {
  return (
    <>
      <Hr style={{ borderColor: brand.border, margin: '24px 0' }} />
      <Text style={{ color: brand.muted, fontSize: 13, margin: 0 }}>— The Acme team</Text>
    </>
  );
}

// ─── Email 1: Welcome ─────────────────────────────────────────────────────────

function WelcomeEmail({ name }: { name: string }) {
  return (
    <EmailShell preview={`Welcome to Acme, ${name}! Your 14-day trial starts now.`}>
      <EmailHeader title="Welcome to Acme" />
      <EmailBody>
        <Heading style={{ fontSize: 22, color: brand.text, margin: '0 0 16px' }}>
          Hey {name}, you're in! 🎉
        </Heading>
        <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 16px' }}>
          We're so glad you're here. Acme helps teams ship faster by automating the repetitive parts
          of your workflow — no infrastructure required.
        </Text>
        <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 8px' }}>
          Here's what's waiting for you on the other side:
        </Text>

        {[
          'Unlimited projects during your 14-day trial',
          'One-click integrations with GitHub, Slack, and Jira',
          'Durable, observable workflows out of the box',
          'A dedicated onboarding guide',
        ].map((item) => (
          <Text key={item} style={{ color: brand.text, margin: '4px 0', paddingLeft: 16 }}>
            ✓ {item}
          </Text>
        ))}

        <Section style={{ margin: '28px 0' }}>
          <PrimaryButton href="https://app.acme.com/start">Start your free trial →</PrimaryButton>
        </Section>

        <Signature />
      </EmailBody>
    </EmailShell>
  );
}

// ─── Email 2a: Getting Started (opened path) ─────────────────────────────────

function GettingStartedEmail({ name }: { name: string }) {
  return (
    <EmailShell preview="Your personalised onboarding checklist is ready.">
      <EmailHeader title="Getting Started" />
      <EmailBody>
        <Heading style={{ fontSize: 22, color: brand.text, margin: '0 0 16px' }}>
          Nice, you opened our email, {name}!
        </Heading>
        <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 16px' }}>
          Most people who open this email complete their first automation in under five minutes.
          Here's your personalised checklist:
        </Text>

        {[
          ['1', 'Complete your profile', '2 min'],
          ['2', 'Connect your first integration', 'GitHub, Slack, or Jira'],
          ['3', 'Invite a teammate', 'collaboration is better together'],
          ['4', 'Run your first automation', 'the magic moment'],
        ].map(([num, title, subtitle]) => (
          <Section
            key={num}
            style={{ background: brand.bg, borderRadius: 6, padding: '12px 16px', marginBottom: 8 }}
          >
            <Text style={{ margin: 0, fontWeight: 600, color: brand.text }}>
              {num}. {title}
            </Text>
            <Text style={{ margin: '2px 0 0', color: brand.muted, fontSize: 13 }}>{subtitle}</Text>
          </Section>
        ))}

        <Section style={{ margin: '28px 0' }}>
          <PrimaryButton href="https://app.acme.com/checklist">
            Open your onboarding checklist →
          </PrimaryButton>
        </Section>

        <Signature />
      </EmailBody>
    </EmailShell>
  );
}

// ─── Email 2b: Re-engagement (not-opened path) ───────────────────────────────

function ReengagementEmail({ name }: { name: string }) {
  return (
    <EmailShell preview="Hey, did we lose you? Here's what you signed up for.">
      <EmailHeader title="We Miss You" />
      <EmailBody>
        <Heading style={{ fontSize: 22, color: brand.text, margin: '0 0 16px' }}>
          Hey {name}, did we lose you?
        </Heading>
        <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 16px' }}>
          You signed up a few days ago but haven't opened our welcome email yet. No hard feelings —
          inboxes get busy. Here's the short version:
        </Text>

        {[
          "Automate your team's repetitive tasks in minutes",
          'Zero infrastructure — just connect and go',
          '14-day free trial, no credit card required',
        ].map((item) => (
          <Text key={item} style={{ color: brand.text, margin: '6px 0', paddingLeft: 16 }}>
            → {item}
          </Text>
        ))}

        <Section style={{ margin: '28px 0' }}>
          <PrimaryButton href="https://app.acme.com/start">
            Pick up where you left off →
          </PrimaryButton>
        </Section>

        <Text style={{ color: brand.muted, fontSize: 13, lineHeight: 1.5 }}>
          P.S. This is the last email we'll send if you don't engage — we respect your inbox.
        </Text>

        <Signature />
      </EmailBody>
    </EmailShell>
  );
}

// ─── Email 3a: Power User Tips (clicked path) ────────────────────────────────

function PowerUserEmail({ name }: { name: string }) {
  return (
    <EmailShell preview="You clicked — here are the power features that pros use every day.">
      <EmailHeader title="Power Features" />
      <EmailBody>
        <Heading style={{ fontSize: 22, color: brand.text, margin: '0 0 16px' }}>
          You clicked — now let's go deeper, {name}
        </Heading>
        <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 20px' }}>
          You've already taken the first step. Here are three power features that customers like you
          use every single day:
        </Text>

        {[
          {
            icon: '⚡',
            title: 'Conditional branching',
            desc: 'Route work based on real-time data — no code, no glue scripts.',
          },
          {
            icon: '🔄',
            title: 'Durable retries',
            desc: 'Automatically recover from API failures with exponential backoff.',
          },
          {
            icon: '🪝',
            title: 'Event-driven triggers',
            desc: 'React to webhooks, database changes, and user actions instantly.',
          },
        ].map(({ icon, title, desc }) => (
          <Section key={title} style={{ marginBottom: 16 }}>
            <Text style={{ margin: '0 0 4px', fontWeight: 700, color: brand.text, fontSize: 15 }}>
              {icon} {title}
            </Text>
            <Text style={{ margin: 0, color: brand.muted, fontSize: 14, lineHeight: 1.5 }}>
              {desc}
            </Text>
          </Section>
        ))}

        <Hr style={{ borderColor: brand.border, margin: '20px 0' }} />

        <Text style={{ color: brand.text, lineHeight: 1.6 }}>
          Each of these is live on your account right now. Want a guided walkthrough?
        </Text>

        <Section style={{ margin: '20px 0' }}>
          <PrimaryButton href="https://app.acme.com/features">Explore all features →</PrimaryButton>
        </Section>

        <Signature />
      </EmailBody>
    </EmailShell>
  );
}

// ─── Email 3b: Gentle Nudge (no-click path) ──────────────────────────────────

function GentleNudgeEmail({ name }: { name: string }) {
  return (
    <EmailShell preview="Most teams see results in their first week. Let us show you how.">
      <EmailHeader title="Still Thinking?" />
      <EmailBody>
        <Heading style={{ fontSize: 22, color: brand.text, margin: '0 0 16px' }}>
          You haven't tried it yet, {name}
        </Heading>
        <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 16px' }}>
          Most teams see measurable results within their first week on Acme. The most common
          feedback we hear:
        </Text>
        <Section
          style={{
            background: brand.bg,
            borderLeft: `4px solid ${brand.purple}`,
            padding: '12px 16px',
            borderRadius: '0 6px 6px 0',
            margin: '0 0 20px',
          }}
        >
          <Text style={{ margin: 0, color: brand.text, fontSize: 15, fontStyle: 'italic' }}>
            "I wish I'd started sooner."
          </Text>
        </Section>
        <Text style={{ color: brand.text, lineHeight: 1.6 }}>
          Not sure where to begin? We'll walk you through it live — no commitment, no sales pitch.
        </Text>

        <Section style={{ margin: '24px 0' }}>
          <PrimaryButton href="https://app.acme.com/demo">
            Book a free 15-min walkthrough →
          </PrimaryButton>
        </Section>

        <Signature />
      </EmailBody>
    </EmailShell>
  );
}

// ─── Email 4: Final Offer ─────────────────────────────────────────────────────

function FinalOfferEmail({ name }: { name: string }) {
  return (
    <EmailShell preview="Last chance — 30% off your first 3 months, valid 48 hours.">
      <EmailHeader title="A Farewell Offer" />
      <EmailBody>
        <Heading style={{ fontSize: 22, color: brand.text, margin: '0 0 16px' }}>
          Our last email to you, {name}
        </Heading>
        <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 16px' }}>
          We don't believe in spamming. This is the final message in this sequence, and we want to
          make it count.
        </Text>

        <Section
          style={{
            background: '#f0fdf4',
            border: `1px solid #bbf7d0`,
            borderRadius: 8,
            padding: '20px 24px',
            margin: '0 0 24px',
          }}
        >
          <Text
            style={{
              margin: '0 0 4px',
              fontSize: 13,
              color: brand.green,
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
            }}
          >
            Limited-time offer
          </Text>
          <Text style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: brand.text }}>
            30% off your first 3 months
          </Text>
          <Text style={{ margin: 0, fontSize: 15, color: brand.text }}>
            Use code <strong>ONBOARD30</strong> at checkout — valid for the next 48 hours only.
          </Text>
        </Section>

        <Text style={{ color: brand.text, lineHeight: 1.6 }}>
          If Acme isn't for you, no worries at all. But if you're on the fence, this is the best
          offer we'll ever make you.
        </Text>

        <Section style={{ margin: '24px 0' }}>
          <GreenButton href="https://app.acme.com/upgrade?code=ONBOARD30">
            Claim 30% off now →
          </GreenButton>
        </Section>

        <Signature />
      </EmailBody>
    </EmailShell>
  );
}

// ─── Mailgun client ───────────────────────────────────────────────────────────

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY ?? '',
  // For EU region add: url: 'https://api.eu.mailgun.net'
  url: 'https://api.eu.mailgun.net',
});

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN ?? '';
const MAILGUN_FROM = process.env.MAILGUN_FROM ?? 'Acme <hi@acme.com>';

// ─── Email plugin ─────────────────────────────────────────────────────────────

const emailPlugin = createEmailPlugin({
  trackerUrl: 'https://crumb.sokratis-vidros.workers.dev',
  secret: process.env.TRACKER_SECRET ?? 'dev-secret',
  apiKey: process.env.TRACKER_API_KEY ?? 'dev-api-key',

  send: async ({ to, subject, html, text }) => {
    await mg.messages.create(MAILGUN_DOMAIN, {
      from: MAILGUN_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });
  },
});

// ─── Drip campaign workflow ───────────────────────────────────────────────────

type CampaignInput = {
  name: string;
  email: string;
};

const dripCampaign = workflow.use(emailPlugin)('drip-campaign', async ({ step, input, logger }) => {
  const { name, email } = input as CampaignInput;

  // ── Email 1: Welcome ────────────────────────────────────────────────────
  // render() converts the React tree to a full HTML string with inlined
  // styles (React Email's speciality). The plugin then instruments that
  // HTML: it injects a 1×1 open-tracking pixel tied to 'email-1-open' and
  // rewrites the first <a href> to a redirect URL tied to 'email-1-click'.
  await step.sendEmail('email-1-send', {
    to: email,
    subject: `Welcome to Acme, ${name}!`,
    html: await render(<WelcomeEmail name={name} />),
    text: `Welcome to Acme, ${name}! Start your free trial: https://app.acme.com/start`,
    openStepId: 'email-1-open',
    clickStepId: 'email-1-click',
  });

  logger.log(`[drip] Email 1 sent to ${email}. Waiting up to 5 days for open…`);

  // ── Wait for Email 1 open (up to 5 days) ────────────────────────────────
  // Polls pgpass.ai every 30 s. The run is suspended between ticks, holding
  // no database connections or memory while it waits.
  const opened = await step.waitForOpen('email-1-open', '5 days');

  if (!opened.done) {
    // Subscriber never opened — one last re-engagement nudge, then exit.
    logger.log('[drip] Email 1 not opened after 5 days — sending re-engagement email.');

    await step.sendEmail('email-reengagement-send', {
      to: email,
      subject: `Hey ${name}, did we lose you?`,
      html: await render(<ReengagementEmail name={name} />),
      text: `Hey ${name}, you signed up but haven't opened our email. Come back: https://app.acme.com/start`,
      openStepId: 'email-reengagement-open',
      clickStepId: 'email-reengagement-click',
    });

    return { outcome: 'no-open' };
  }

  logger.log(
    `[drip] Email 1 opened — ` +
      `device=${opened.data.deviceType ?? 'unknown'}  ` +
      `os=${opened.data.os ?? 'unknown'}  ` +
      `at=${opened.data.openedAt}`,
  );

  // ── Email 2: Getting Started — fires immediately on open ────────────────
  await step.sendEmail('email-2-send', {
    to: email,
    subject: `Here's how to get started, ${name}`,
    html: await render(<GettingStartedEmail name={name} />),
    text: `Here's your onboarding checklist: https://app.acme.com/checklist`,
    openStepId: 'email-2-open',
    clickStepId: 'email-2-click',
  });

  logger.log('[drip] Email 2 sent. Waiting up to 3 days for Email 1 CTA click…');

  // ── Wait for Email 1 CTA click (up to 3 days) ───────────────────────────
  // The click token was embedded in Email 1 at send-time for this step ID,
  // so this step resolves the moment the subscriber clicks that original
  // link — even though Email 2 is already in their inbox.
  const clicked = await step.waitForClick('email-1-click', '3 days');

  if (clicked.done) {
    logger.log(`[drip] Email 1 CTA clicked — url=${clicked.data.url}`);

    // High-intent path: wait one day then deliver power-user content.
    await step.delay('email-3-delay-after-clicked', { days: 1 });

    await step.sendEmail('email-3-send', {
      to: email,
      subject: `You're ready for the advanced stuff, ${name}`,
      html: await render(<PowerUserEmail name={name} />),
      text: `Explore all features: https://app.acme.com/features`,
      openStepId: 'email-3-open',
      clickStepId: 'email-3-click',
    });
  } else {
    logger.log('[drip] Email 1 CTA not clicked within 3 days — sending gentle nudge.');

    // Low-intent path: wait two days then send a softer nudge.
    await step.delay('email-3-delay-without-click', { days: 2 });

    await step.sendEmail('email-3-send', {
      to: email,
      subject: `You haven't tried it yet, ${name}`,
      html: await render(<GentleNudgeEmail name={name} />),
      text: `Book a free walkthrough: https://app.acme.com/demo`,
      openStepId: 'email-3-open',
      clickStepId: 'email-3-click',
    });
  }

  // ── Email 4: Final Offer — always 3 days after Email 3 ──────────────────
  // Regardless of which Email 3 branch ran, we wait 3 days and close with
  // a discount offer. step.delay is durable: a process restart after the
  // pg-boss wakeup job has been scheduled simply resumes at the next step.
  logger.log('[drip] Email 3 sent. Waiting 3 days before final offer…');

  await step.delay('email-4-delay', { days: 3 });

  await step.sendEmail('email-4-send', {
    to: email,
    subject: `Last chance, ${name} — 30% off inside`,
    html: await render(<FinalOfferEmail name={name} />),
    text: `Use code ONBOARD30 for 30% off: https://app.acme.com/upgrade?code=ONBOARD30`,
    openStepId: 'email-4-open',
    clickStepId: 'email-4-click',
  });

  logger.log('[drip] Email 4 sent. Campaign complete.');

  return {
    outcome: clicked.done ? 'opened-and-clicked' : 'opened-no-click',
  };
});

// ─── Engine bootstrap ─────────────────────────────────────────────────────────

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example';

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
  });

  const engine = new WorkflowEngine({ boss, workflows: [dripCampaign as WorkflowDefinition] });
  await engine.start();

  console.log('\n=== Drip Campaign Example ===\n');
  console.log('Starting campaign for alice@example.com…\n');

  const run = await engine.startWorkflow({
    workflowId: 'drip-campaign',
    resourceId: 'cafebabe',
    input: { name: 'Alice', email: 'sokratis.vidros@gmail.com' },
  });

  console.log(`Run ID: ${run.id}\n`);
  console.log('The workflow is now running. It will:');
  console.log('  1. Render Email 1 with React Email and send via Mailgun');
  console.log('  2. Poll pgpass.ai every 30 s for an open event (up to 5 days)');
  console.log('  3. On open  → send Email 2 immediately');
  console.log('  4. Poll for a click on Email 1 CTA (up to 3 days after open)');
  console.log('  5. On click → delay 1 day  → send Email 3 (power tips)');
  console.log('     No click → delay 2 days → send Email 3 (gentle nudge)');
  console.log('  6. Delay 3 days → send Email 4 (final offer)');
  console.log('\nAll waits are durable — process restarts resume exactly where they left off.\n');

  // Poll for progress until workflow completes (like basic.ts and polling.ts)
  let progress: WorkflowRunProgress;
  do {
    await new Promise((r) => setTimeout(r, 1000));
    progress = await engine.checkProgress({ runId: run.id, resourceId: 'cafebabe' });
    console.log(
      `  Progress: ${progress.completionPercentage}% (${progress.completedSteps}/${progress.totalSteps} steps) - ${progress.status}`,
    );
  } while (progress.status === 'running' || progress.status === 'paused');

  console.log('\nFinal output:', progress.output);

  await engine.stop();
  await pool.end();
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
