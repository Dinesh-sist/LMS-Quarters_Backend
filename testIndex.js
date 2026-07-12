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

async function testIndex() {
    try {
        const pool = await sql.connect(config);
        
        console.log("Testing indexed query...");
        const start = Date.now();
        const result = await pool.request().query(`
          SELECT TOP 5
              eq.OBJECTID,
              eq.CATEGORY,
              eq.AREA_TYPE,
              eq.[QUARTER NUMBER],
              eq.STATUS1
          FROM dbo.[Estate_Quarters] eq
          WHERE
              eq.STATUS1 = 'VACANT'
              AND (
                  (eq.CATEGORY = 'C TYPE (MODIFIED)' AND eq.AREA_TYPE = 'GC' AND eq.[QUARTER NUMBER] = '11')
                  OR (eq.CATEGORY = 'D TYPE' AND eq.AREA_TYPE = 'SO' AND eq.[QUARTER NUMBER] = '7')
              )
        `);
        console.log("Time: " + (Date.now() - start) + "ms");
        console.log("Rows:", result.recordset);

    } catch(e) {
        console.error("Error:", e.message);
    } finally {
        process.exit();
    }
}
testIndex();
