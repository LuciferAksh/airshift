import { appServer } from './app.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4176);
const server = await appServer({ key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
server.listen(port, host, () => console.log(`AirShift is listening at http://${host}:${port}`));
