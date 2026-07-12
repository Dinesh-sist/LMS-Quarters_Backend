require('dotenv').config();
const sql = require('mssql');

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true'
    }
};

async function check() {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
          SELECT TOP 5 OBJECTID FROM dbo.[Estate_Quarters]
        `);
        console.log("Top 5 IDs:", result.recordset);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
