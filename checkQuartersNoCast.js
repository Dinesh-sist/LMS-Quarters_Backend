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
          SELECT
              CAST(FLOOR(eq.OBJECTID) AS BIGINT)             AS Id,
              CAST(eq.CATEGORY AS NVARCHAR(64))          AS QuarterType,
              CAST(eq.AREA_TYPE AS NVARCHAR(64))         AS Location,
              CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))  AS QuarterNo,
              eq.STATUS1
          FROM dbo.[Estate_Quarters] eq
          WHERE
              eq.CATEGORY = 'C TYPE (MODIFIED)'
              AND eq.[QUARTER NUMBER] IN ('7', '11', '41', '20', '64')
        `);
        console.log("Quarters found:", result.recordset);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
