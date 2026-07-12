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
            WHERE UPPER(LTRIM(RTRIM(qec.[Class]))) = 'SR-CLASS-I'
        `);
        console.log("Eligible for:", result.recordset);
        
        const q = `
          SELECT
              CAST(FLOOR(eq.OBJECTID) AS BIGINT)             AS Id,
              CAST(eq.CATEGORY AS NVARCHAR(64))          AS QuarterType,
              CAST(eq.AREA_TYPE AS NVARCHAR(64))         AS Location,
              CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))  AS QuarterNo,
              UPPER(LTRIM(RTRIM(CAST(eq.STATUS1 AS NVARCHAR(32))))) AS Status1
          FROM dbo.[Estate_Quarters] eq
          WHERE CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64)) IN ('7', '11', '41', '20', '64')
        `;
        const res2 = await pool.request().query(q);
        console.log("Quarters found for those numbers:", res2.recordset);
        
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
