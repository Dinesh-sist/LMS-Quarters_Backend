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
            EXEC sp_who2
        `);
        // filter out sleeping processes or background processes
        const active = result.recordset.filter(r => r.Status.trim() !== 'sleeping' && r.Status.trim() !== 'BACKGROUND');
        console.table(active);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
