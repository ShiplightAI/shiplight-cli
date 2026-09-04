import { register } from 'node:module';

register(
  'data:application/javascript,' + encodeURIComponent(`
    import { readFileSync } from 'fs';
    import { fileURLToPath } from 'url';
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.tpl') || url.endsWith('.md')) {
        const content = readFileSync(fileURLToPath(url), 'utf-8');
        return { format: 'module', source: 'export default ' + JSON.stringify(content) + ';', shortCircuit: true };
      }
      return nextLoad(url, context);
    }
  `),
  import.meta.url
);
