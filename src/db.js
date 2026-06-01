const sql = require("mssql");
const { db } = require("./config");

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: db.server,
      port: db.port,
      database: db.database,
      user: db.user,
      password: db.password,
      options: {
        encrypt: db.encrypt,
        trustServerCertificate: db.trustServerCertificate
      },

      

      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };

