// Hosting (Render or any host with ONE public port in $PORT): runs the Supplier Network and the
// Korta console in one process. The console takes the public port; the Supplier Network stays on an
// internal port that only Korta calls (SUPPLIERS_BASE_URL). Locally, you can also run them separately.
// Ports are set before .env is loaded (dotenv never overrides them), so $PORT is the host's.
// Adapted from the EmpowerHer x402 workshop kit.
const publicPort = process.env.PORT || "4022";
const apiPort = new URL(process.env.SUPPLIERS_BASE_URL || "http://localhost:4021").port || "4021";

if (publicPort === apiPort) {
  console.error(`Public port and Supplier Network port are both ${apiPort}.`);
  console.error("→ On Render, delete PORT from your environment variables: Render sets it itself.");
  process.exit(1);
}

process.env.PORT = apiPort;
process.env.CONSOLE_PORT = publicPort;

// Dynamic imports, so the ports above are set before config.mjs reads them.
await import("../src/suppliers/server.mjs");
await import("../src/console/app.mjs");
