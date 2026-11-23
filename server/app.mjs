import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { files, webApp } from './http.mjs';

/** @param {import('./http.mjs').ModelSettings & import('./http.mjs').HandlerOptions} [config] */
export async function appServer({ key, model, ...options } = {}) {
  const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([route, [file, type]]) => {
    const content = await readFile(new URL(`../public/${file}`, import.meta.url));
    return [route, { content, type }];
  })));
  const handle = webApp(assets, options);

  return createServer({ requestTimeout: 20000, headersTimeout: 10000 }, async (incoming, outgoing) => {
    try {
      const { method, headers, url } = incoming;
      if (!url?.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
        outgoing.writeHead(400).end();
        return;
      }
      const requestHeaders = new Headers();
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const entry of Array.isArray(value) ? value : [value]) requestHeaders.append(name, entry);
      }
      // Node and the DOM lib describe the same Web stream with different types.
      const body = method === 'POST'
        ? /** @type {ReadableStream<Uint8Array>} */ (/** @type {unknown} */ (Readable.toWeb(incoming)))
        : undefined;
      /** @type {RequestInit & {duplex: 'half'}} */
      const init = { method, headers: requestHeaders, body, duplex: 'half' };
      const request = new Request(`http://${headers.host ?? '127.0.0.1'}${url}`, init);
      const response = await handle(request, { key, model });
      const content = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)).end(content);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  });
}
