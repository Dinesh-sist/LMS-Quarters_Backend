const jwt = require('jsonwebtoken');
const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE,
    options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' }
};

async function run() {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT Id FROM dbo.Users WHERE Username = 'A488'");
    const userId = 1;
    
    const token = jwt.sign(
        { sub: userId, role: 'employee', username: 'A488' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    
    console.log("Generated Token:", token);
    
    fetch('http://localhost:5000/api/estate-quarters/vacant?className=CLASS-II', {
        headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(res => res.text())
    .then(text => {
        console.log("API RESPONSE:");
        console.log(text);
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
}
run();
