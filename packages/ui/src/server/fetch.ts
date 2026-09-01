export type FetchHandler = (request: Request) => Promise<Response>;

export type FetchHandlerSource = { fetch: FetchHandler } | FetchHandler;

export function toFetchHandler(source: FetchHandlerSource): FetchHandler {
  return typeof source === 'function' ? source : (request) => source.fetch(request);
}
