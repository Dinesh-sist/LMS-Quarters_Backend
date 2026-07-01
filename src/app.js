const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const { allowedOrigins } = require("./config");



const health = require("./routes/health");
const auth = require("./routes/auth");
const quarters = require("./routes/quarters");
const applications = require("./routes/applications");
const admin = require("./routes/admin");
const allotmentCategories = require("./routes/allotmentCategories");
const allotmentHods = require("./routes/allotmentHods");
const employee = require("./routes/employee");
const estateQuarters = require("./routes/estateQuarters");
const map = require("./routes/map");

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error("CORS blocked"));
      },
      credentials: true
    })
  );

  app.get("/", (req, res) => res.json({ name: "lms-quarters-backend" }));
  app.use("/health", health);

  // Serve uploaded attachment files
  const uploadsDir = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));

  app.use("/api/auth", auth);
  app.use("/api/quarters", quarters);
  app.use("/api/applications", applications);
  app.use("/api/admin", admin);
  app.use("/api/allotment-categories", allotmentCategories);
  app.use("/api/allotment-hods", allotmentHods);
  app.use("/api/employee", employee);
  app.use("/api/estate-quarters", estateQuarters);
  app.use("/api/map", map);

  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-unused-vars
    const _next = next;
    const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return res.status(status).json({ error: "Server error" });
  });

  return app;
}

module.exports = { createApp };
