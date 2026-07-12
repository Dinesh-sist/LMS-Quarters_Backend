const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };
sql.connect(config).then(pool => pool.request().query("SELECT * FROM dbo.Quarter_Applications WHERE QtrRequested = '41' AND Status = 'approved'")).then(res => { console.log('41 Apps:', res.recordset); process.exit(0); });
