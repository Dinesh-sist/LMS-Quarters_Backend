const sql = require('mssql');
const config = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'Oasys@123',
    server: process.env.DB_HOST || '192.168.1.135',
    database: process.env.DB_NAME || 'LMS_Quarters',
    options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(config).then(pool => {
    return pool.request().query("SELECT qec.[Class], qat.QTR_TYPE FROM dbo.Quarter_Emp_Class qec JOIN dbo.Quarter_Allotment_Type qat ON qat.QTR_ID = qec.QTR_ID WHERE UPPER(LTRIM(RTRIM(qec.[Class]))) = 'SR-CLASS-I'");
}).then(result => {
    console.log(result.recordset);
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
