const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };

async function run() {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('ClassName', sql.NVarChar(60), 'SR-CLASS-I')
      .query(`
        SELECT qec.[Class], qat.QTR_TYPE 
        FROM dbo.[Quarter_Emp_Class] qec
        JOIN dbo.[Quarter_Allotment_Type] qat
            ON qat.QTR_ID = qec.QTR_ID
        WHERE UPPER(LTRIM(RTRIM(qec.[Class]))) = UPPER(LTRIM(RTRIM(@ClassName)))
      `);
    console.log('Eligibility for SR-CLASS-I:', result.recordset);
    
    const result2 = await pool.request().query("SELECT DISTINCT Class FROM dbo.[Quarter_Emp_Class]");
    console.log('All Classes in DB:', result2.recordset);
    process.exit(0);
}
run();
