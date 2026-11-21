import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { files } from '../server/http.mjs';

const entries = await Promise.all(Object.entries(files).map(async ([route, [file, type]]) => {
  const bytes = await readFile(new URL(`../public/${file}`, import.meta.url));
  const content = file === 'index.html'
    ? Buffer.from(bytes.toString('utf8').replace('data-forecast-transport="server"', 'data-forecast-transport="browser"'))
    : bytes;
  return `${JSON.stringify(route)}:{type:${JSON.stringify(type)},content:Uint8Array.from(atob(${JSON.stringify(content.toString('base64'))}), (character) => character.charCodeAt(0))}`;
}));

await build({
  entryPoints: ['server/worker.mjs'], outfile: 'dist/server/index.js', platform: 'browser', format: 'esm', bundle: true,
  plugins: [{
    name: 'airshift-assets',
    setup(builder) {
      builder.onResolve({ filter: /^airshift-assets$/ }, ({ path }) => ({ path, namespace: 'assets' }));
      builder.onLoad({ filter: /.*/, namespace: 'assets' }, () => ({ contents: `export default {${entries.join(',')}};`, loader: 'js' }));
    },
  }],
});

const hostingManifest = await readFile('.openai/hosting.json').catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (hostingManifest) {
  await mkdir('dist/.openai', { recursive: true });
  await writeFile('dist/.openai/hosting.json', hostingManifest);
}
