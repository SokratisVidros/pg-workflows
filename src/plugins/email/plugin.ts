import type { Duration } from '../../duration';
import type { StepBaseContext, WorkflowPlugin } from '../../types';
import { instrumentHtml } from './instrument';
import { createToken } from './token';
import type {
  EmailClickedData,
  EmailOpenedData,
  EmailPluginConfig,
  EmailStepMethods,
  SendEmailStepOpts,
  TrackerAdminEventRecord,
  TrackerAdminEventResponse,
  WaitForClickResult,
  WaitForOpenResult,
} from './types';

function isTrackerEventRecord(
  value: unknown,
): value is TrackerAdminEventRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'firedAt' in value &&
    typeof (value as TrackerAdminEventRecord).firedAt === 'string'
  )
}

function mapToOpenedData(record: TrackerAdminEventRecord): EmailOpenedData {
  const location =
    record.country != null || record.city != null || record.region != null
      ? {
          country: record.country,
          city: record.city,
          region: record.region,
        }
      : undefined
  return {
    openedAt: record.firedAt,
    userAgent: record.userAgent,
    ipAddress: record.ip,
    language: record.language,
    os: record.os,
    deviceType: record.deviceType as EmailOpenedData['deviceType'],
    location,
    referrer: record.referrer,
  }
}

function mapToClickedData(record: TrackerAdminEventRecord): EmailClickedData {
  const location =
    record.country != null || record.city != null || record.region != null
      ? {
          country: record.country,
          city: record.city,
          region: record.region,
        }
      : undefined
  return {
    clickedAt: record.firedAt,
    url: record.url ?? '',
    userAgent: record.userAgent,
    ipAddress: record.ip,
    language: record.language,
    os: record.os,
    deviceType: record.deviceType as EmailClickedData['deviceType'],
    location,
    referrer: record.referrer,
  }
}

export function createEmailPlugin(
  config: EmailPluginConfig,
): WorkflowPlugin<StepBaseContext, EmailStepMethods> {
  return {
    name: 'email',
    methods(step) {
      return {
        async sendEmail(stepId: string, opts: SendEmailStepOpts): Promise<void> {
          await step.run(stepId, async () => {
            const openToken = createToken(step.runId, opts.openStepId, config.secret);
            const clickToken = createToken(step.runId, opts.clickStepId, config.secret);
            const html = instrumentHtml(opts.html, {
              openToken,
              clickToken,
              trackerUrl: config.trackerUrl,
            });
            await config.send({ to: opts.to, subject: opts.subject, html, text: opts.text });
          });
        },

        async waitForOpen(stepId: string, duration: Duration): Promise<WaitForOpenResult> {
          const result = await step.poll(
            stepId,
            async (): Promise<TrackerAdminEventRecord | false> => {
              const token = createToken(step.runId, stepId, config.secret);
              const res = await fetch(`${config.trackerUrl}/api/events/${token}`, {
                headers: { Authorization: `Bearer ${config.apiKey}` },
              });
              const body = (await res.json()) as TrackerAdminEventResponse;
              const data = body.found ? body.data : undefined
              return data !== undefined && isTrackerEventRecord(data) ? data : false
            },
            { timeout: duration },
          );

          console.log('result >>>>>>>>>>>>', result);
          if (result.timedOut) {
            return { done: false, state: 'timeout', duration };
          }
          if (!isTrackerEventRecord(result.data)) {
            throw new Error(
              `Tracker API returned success but invalid or missing event data (expected object with firedAt). Got: ${typeof result.data === 'object' && result.data !== null ? JSON.stringify(result.data).slice(0, 200) : String(result.data)}`,
            )
          }
          return { done: true, data: mapToOpenedData(result.data) };
        },

        async waitForClick(stepId: string, duration: Duration): Promise<WaitForClickResult> {
          const result = await step.poll(
            stepId,
            async (): Promise<TrackerAdminEventRecord | false> => {
              const token = createToken(step.runId, stepId, config.secret);
              const res = await fetch(`${config.trackerUrl}/api/events/${token}`, {
                headers: { Authorization: `Bearer ${config.apiKey}` },
              });
              const body = (await res.json()) as TrackerAdminEventResponse;
              const data = body.found ? body.data : undefined
              return data !== undefined && isTrackerEventRecord(data) ? data : false
            },
            { timeout: duration },
          );
          if (result.timedOut) {
            return { done: false, state: 'timeout', duration };
          }
          if (!isTrackerEventRecord(result.data)) {
            throw new Error(
              `Tracker API returned success but invalid or missing event data (expected object with firedAt). Got: ${typeof result.data === 'object' && result.data !== null ? JSON.stringify(result.data).slice(0, 200) : String(result.data)}`,
            )
          }
          return { done: true, data: mapToClickedData(result.data) };
        },
      };
    },
  };
}
