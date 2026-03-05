import type { Duration } from '../../duration';

export type EmailPluginConfig = {
  trackerUrl: string;
  secret: string;
  apiKey: string;
  send: (opts: SendEmailOpts) => Promise<unknown>;
};

export type SendEmailOpts = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailStepOpts = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  openStepId: string;
  clickStepId: string;
};

export type EmailOpenedData = {
  openedAt: string;
  userAgent?: string;
  ipAddress?: string;
  language?: string;
  os?: string;
  deviceType?: 'mobile' | 'desktop' | 'tablet';
  location?: { country?: string; city?: string; region?: string };
  referrer?: string;
};

export type EmailClickedData = {
  clickedAt: string;
  url: string;
  userAgent?: string;
  ipAddress?: string;
  language?: string;
  os?: string;
  deviceType?: 'mobile' | 'desktop' | 'tablet';
  location?: { country?: string; city?: string; region?: string };
  referrer?: string;
};

export type WaitForOpenResult =
  | { done: true; data: EmailOpenedData }
  | { done: false; state: 'timeout'; duration: Duration };

export type WaitForClickResult =
  | { done: true; data: EmailClickedData }
  | { done: false; state: 'timeout'; duration: Duration };

export type EmailStepMethods = {
  sendEmail: (stepId: string, opts: SendEmailStepOpts) => Promise<void>;
  waitForOpen: (stepId: string, duration: Duration) => Promise<WaitForOpenResult>;
  waitForClick: (stepId: string, duration: Duration) => Promise<WaitForClickResult>;
};

/**
 * Raw event record as returned by the tracker admin API (GET /api/events/<token>).
 * Field names match the API response (snake_case).
 */
export type TrackerAdminEventRecord = {
  event: 'open' | 'click';
  url?: string;
  user_agent?: string;
  ip?: string;
  language?: string;
  os?: string;
  device_type?: string;
  location?: { country?: string; city?: string; region?: string };
  referrer?: string;
  fired_at: string;
};

/**
 * Response shape of the tracker admin API method GET /api/events/<token>.
 */
export type TrackerAdminEventResponse =
  | { found: true; data: TrackerAdminEventRecord }
  | { found: false };
