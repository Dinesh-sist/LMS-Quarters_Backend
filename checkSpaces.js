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
            SELECT qec.[Class], qat.QTR_TYPE 
            FROM dbo.Quarter_Emp_Class qec 
            JOIN dbo.Quarter_Allotment_Type qat ON qat.QTR_ID = qec.QTR_ID 
            WHERE qat.QTR_TYPE = 'C TYPE (MODIFIED)'
        `);
        console.log("C TYPE (MODIFIED) mapped classes:", result.recordset);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
