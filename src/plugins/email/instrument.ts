import { load } from 'cheerio';

export function instrumentHtml(
  html: string,
  opts: { openToken: string; clickToken: string; trackerUrl: string },
): string {
  const base = opts.trackerUrl.replace(/\/$/, '');
  const $ = load(html);

  const firstLink = $('a[href]').first();
  if (firstLink.length) {
    const href = firstLink.attr('href')!;
    firstLink.attr('href', `${base}/r/${opts.clickToken}?url=${encodeURIComponent(href)}`);
  }

  $('body').append(
    `<img src="${base}/t/${opts.openToken}.gif" width="1" height="1" alt="" />`,
  );

  return $.html();
}
