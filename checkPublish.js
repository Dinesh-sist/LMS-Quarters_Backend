const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };

async function run() {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT * FROM dbo.Publish");
    console.log('Publish Table:', result.recordset);
    process.exit(0);
}
run();
