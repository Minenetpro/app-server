import { startServer } from "./src/server";

const server = await startServer();
console.log(`minenet app-server running on http://${server.hostname}:${server.port}`);
