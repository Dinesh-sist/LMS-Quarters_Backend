const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };

async function run() {
    const pool = await sql.connect(config);
    try {
        const result = await pool.request().query(`
            INSERT INTO dbo.Quarter_Emp_Class (Class_ID, Class, Class_PRIORITY, QTR_ID, class_name)
            VALUES (12, 'SR-CLASS-I', 1, 6, 'CLASS-I')
        `);
        console.log('Inserted SR-CLASS-I mapping for QTR_ID 6 (D TYPE):', result);
    } catch (e) {
        console.error('Failed to insert mapping:', e);
    }
    process.exit(0);
}
run();
