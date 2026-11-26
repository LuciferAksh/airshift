import { appServer } from './server/app.mjs';

const server = await appServer({
  key: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
});

server.listen(Number(process.env.PORT || 3000), () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log(`AirShift listening on port ${address.port}`);
});
