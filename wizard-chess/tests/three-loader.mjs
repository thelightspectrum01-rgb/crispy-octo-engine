// Lets Node resolve the browser import map entry 'three' to the vendored build.
import {register} from 'node:module';

const target = new URL('../web/vendor/three/three.module.min.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return {url: ${JSON.stringify(target)}, shortCircuit: true};
  return next(specifier, context);
}`));
