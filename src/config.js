const env = (key, fallback) => {
  const value = process.env[key];
  return value == null || value === "" ? fallback : value;
};

const envBool = (key, fallback) => {
  const value = env(key, "");
  if (value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
};

// ✅ define it as a variable FIRST
const allowedOrigins = env("ALLOWED_ORIGINS", "http://localhost:5174")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);


module.exports = {
  port: Number(env("PORT", "5000")),
  nodeEnv: env("NODE_ENV", "development"),
  jwtSecret: env("JWT_SECRET", ""),
  allowedOrigins, // ✅ just reference the variable
  db: {
    
    server: env("DB_SERVER", "localhost"),
    port: Number(env("DB_PORT", "1433")),
    database: env("DB_DATABASE", "LMSQuarters"),
    user: env("DB_USER", "lms"),
    password: env("DB_PASSWORD", ""),
    encrypt: envBool("DB_ENCRYPT", false),
    trustServerCertificate: envBool("DB_TRUST_SERVER_CERT", true)
  }
};
