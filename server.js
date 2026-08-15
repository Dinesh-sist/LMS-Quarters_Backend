require("dotenv").config();
const { createApp } = require("./src/app");
const { port } = require("./src/config");
const { getPool } = require("./src/db");
const adminRouter = require("./src/routes/admin");

async function main() {
  const pool = await getPool(); // fail-fast on DB connectivity

  // Ensure UserDetails UserId unique constraint allows multiple NULLs
  if (typeof adminRouter.ensureUserDetailsUserIdConstraint === "function") {
    await adminRouter.ensureUserDetailsUserIdConstraint(pool);
  }

  // Check and auto-close any expired publications on startup
  if (typeof adminRouter.autoCloseExpiredPublications === "function") {
    await adminRouter.autoCloseExpiredPublications(pool);
  }

  // Periodically check and auto-close expired publications every 60 seconds
  setInterval(async () => {
    try {
      if (typeof adminRouter.autoCloseExpiredPublications === "function") {
        await adminRouter.autoCloseExpiredPublications(pool);
      }
    } catch (err) {
      console.error("Periodic auto-close error:", err);
    }
  }, 60000);

  const app = createApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
  });
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception thrown:", error);
});

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


