const sql = require('mssql');
require('dotenv').config();
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE,
    options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' }
};
sql.connect(config).then(pool => {
    return pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Quarter_Applications'");
}).then(result => {
    console.log(result.recordset.map(r => r.COLUMN_NAME));
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
