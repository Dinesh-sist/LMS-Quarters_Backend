const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };
sql.connect(config).then(pool => pool.request().query("SELECT TOP 5 * FROM dbo.Users WHERE EmployeeId LIKE '%A488%' OR Username LIKE '%A488%'")).then(res => { console.log(JSON.stringify(res.recordset, null, 2)); process.exit(0); }).catch(e => { console.log(e); process.exit(1); });
