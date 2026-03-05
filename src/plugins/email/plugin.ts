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

function mapToOpenedData(record: TrackerAdminEventRecord): EmailOpenedData {
  return {
    openedAt: record.fired_at,
    userAgent: record.user_agent,
    ipAddress: record.ip,
    language: record.language,
    os: record.os,
    deviceType: record.device_type as EmailOpenedData['deviceType'],
    location: record.location,
    referrer: record.referrer,
  };
}

function mapToClickedData(record: TrackerAdminEventRecord): EmailClickedData {
  return {
    clickedAt: record.fired_at,
    url: record.url ?? '',
    userAgent: record.user_agent,
    ipAddress: record.ip,
    language: record.language,
    os: record.os,
    deviceType: record.device_type as EmailClickedData['deviceType'],
    location: record.location,
    referrer: record.referrer,
  };
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
              return body.found ? body.data : false;
            },
            { timeout: duration },
          );
          if (result.timedOut) {
            return { done: false, state: 'timeout', duration };
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
              return body.found ? body.data : false;
            },
            { timeout: duration },
          );
          if (result.timedOut) {
            return { done: false, state: 'timeout', duration };
          }
          return { done: true, data: mapToClickedData(result.data) };
        },
      };
    },
  };
}
