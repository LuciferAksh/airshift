import assets from 'airshift-assets';
import { webApp } from './http.mjs';

const handle = webApp(assets);

export default {
  fetch(request, env) {
    return handle(request, { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  },
};
