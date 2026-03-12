/**
 * Drip Email Campaign (simplified) — pg-workflows + email plugin + React Email + Mailgun
 *
 * Three steps:
 *   1. Send one welcome email
 *   2. Wait for open (e.g. up to 5 days)
 *   3. Mock action based on open result (engaged vs not-opened)
 *
 * Required env: DATABASE_URL, MAILGUN_*, TRACKER_SECRET, TRACKER_API_KEY
 * Run: npm run example:drip-campaign
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { render } from '@react-email/render'
import FormData from 'form-data'
import Mailgun from 'mailgun.js'
import pg from 'pg'
import { PgBoss } from 'pg-boss'
import {
  type WorkflowDefinition,
  WorkflowEngine,
  type WorkflowRunProgress,
  workflow,
} from 'pg-workflows'
import { createEmailPlugin } from '../dist/plugins/email/index'

// ─── Design tokens ────────────────────────────────────────────────────────────

const brand = {
  purple: '#6366f1',
  text: '#1a1a1a',
  muted: '#6b7280',
  bg: '#f9fafb',
  cardBg: '#ffffff',
  border: '#e5e7eb',
}

// ─── Welcome email ────────────────────────────────────────────────────────────

function WelcomeEmail({ name }: { name: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Welcome to Acme, {name}!</Preview>
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
              Welcome to Acme
            </Heading>
          </Section>
          <Section style={{ padding: '32px' }}>
            <Heading style={{ fontSize: 22, color: brand.text, margin: '0 0 16px' }}>
              Hey {name}, you're in!
            </Heading>
            <Text style={{ color: brand.text, lineHeight: 1.6, margin: '0 0 16px' }}>
              We're glad you're here. Get started with your free trial below.
            </Text>
            <Section style={{ margin: '24px 0' }}>
              <Button
                href="https://app.acme.com/start"
                style={{
                  background: brand.purple,
                  color: '#fff',
                  padding: '12px 24px',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                Start your free trial →
              </Button>
            </Section>
            <Text style={{ color: brand.muted, fontSize: 13, margin: 0 }}>
              — The Acme team
            </Text>
          </Section>
        </Container>
        <Section style={{ textAlign: 'center', padding: '16px 0' }}>
          <Text style={{ fontSize: 12, color: brand.muted, margin: 0 }}>
            <Link href="https://app.acme.com/unsubscribe" style={{ color: brand.muted }}>
              Unsubscribe
            </Link>
          </Text>
        </Section>
      </Body>
    </Html>
  )
}

// ─── Mailgun client ───────────────────────────────────────────────────────────

const mailgun = new Mailgun(FormData)
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY ?? '',
  url: 'https://api.eu.mailgun.net',
})

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN ?? ''
const MAILGUN_FROM = process.env.MAILGUN_FROM ?? 'Acme <hi@acme.com>'

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
    })
  },
})

// ─── Drip campaign workflow (3 steps) ──────────────────────────────────────────

type CampaignInput = {
  name: string
  email: string
}

const dripCampaign = workflow.use(emailPlugin)('drip-campaign', async ({ step, input, logger }) => {
  const { name, email } = input as CampaignInput

  // Step 1: Send welcome email
  await step.sendEmail('email-send', {
    to: email,
    subject: `Welcome to Acme, ${name}!`,
    html: await render(<WelcomeEmail name={name} />),
    text: `Welcome to Acme, ${name}! Start your free trial: https://app.acme.com/start`,
    openStepId: 'email-open',
    clickStepId: 'email-click',
  })

  // Step 2: Wait for open (e.g. 5 days)
  const opened = await step.waitForOpen('email-open', '5 days')

  // Step 3: Mock action based on open result
  const outcome = await step.run('mock-action', async () => {
    if (opened.done) {
      logger.log(`[drip] Opened — device=${opened.data.deviceType ?? 'unknown'} at ${opened.data.openedAt}`)
      return { action: 'mark_engaged', openedAt: opened.data.openedAt }
    }
    logger.log('[drip] Not opened within 5 days')
    return { action: 'mark_not_engaged', reason: 'no_open' }
  })

  return outcome
})

// ─── Engine bootstrap ─────────────────────────────────────────────────────────

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/pg_workflows_example'

  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
  })

  const engine = new WorkflowEngine({ boss, workflows: [dripCampaign as WorkflowDefinition] })
  await engine.start()

  console.log('\n=== Drip Campaign (simplified) ===\n')
  console.log('Three steps: 1) Send email  2) Wait for open  3) Mock action based on result\n')
  console.log('Starting campaign…\n')

  const run = await engine.startWorkflow({
    workflowId: 'drip-campaign',
    resourceId: 'cafebabe',
    input: { name: 'Alice', email: 'sokratis.vidros@gmail.com' },
  })

  console.log(`Run ID: ${run.id}\n`)

  let progress: WorkflowRunProgress
  do {
    await new Promise((r) => setTimeout(r, 1000))
    progress = await engine.checkProgress({ runId: run.id, resourceId: 'cafebabe' })
    console.log(
      `  Progress: ${progress.completionPercentage}% (${progress.completedSteps}/${progress.totalSteps}) - ${progress.status}`,
    )
  } while (progress.status === 'running' || progress.status === 'paused')

  console.log('\nFinal output:', progress.output)

  await engine.stop()
  await pool.end()
}

main().catch((err) => {
  console.error('Example failed:', err)
  process.exit(1)
})
