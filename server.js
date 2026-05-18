require("dotenv").config();
const { createApp } = require("./src/app");
const { port } = require("./src/config");
const { getPool } = require("./src/db");

async function main() {
  await getPool(); // fail-fast on DB connectivity
  const app = createApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

