const sql = require("mssql");
const { db } = require("./config");

let poolPromise;

function getPool() {
  if (!poolPromise) {
    const config = {
      server: db.server,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      options: {
        encrypt: db.encrypt,
        trustServerCertificate: db.trustServerCertificate,
        connectTimeout: 30000,
        requestTimeout: 30000,
        enableArithAbort: true,
      },
      pool: {
        max: 20,
        min: 0,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 30000,
      },
    };

    poolPromise = sql.connect(config).catch((err) => {
      console.error("SQL Pool connection error:", err.message);
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };

