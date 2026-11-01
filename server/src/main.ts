/** NOVA SWARM co-op relay entry point (Render runs this via `npm start`). */
import { createRelayServer } from "./server";

const relay = await createRelayServer(Number(process.env.PORT ?? 8787));
console.log(`novaswarm relay listening on :${relay.port}`);
