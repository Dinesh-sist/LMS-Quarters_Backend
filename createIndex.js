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

async function createIndex() {
    try {
        const pool = await sql.connect(config);
        
        console.log("Creating index...");
        const start = Date.now();
        await pool.request().query(`
            CREATE NONCLUSTERED INDEX IX_Estate_Quarters_Status_Cat_Area_Qno 
            ON dbo.Estate_Quarters (STATUS1, CATEGORY, AREA_TYPE, [QUARTER NUMBER]);
        `);
        console.log("Index created in " + (Date.now() - start) + "ms!");

    } catch(e) {
        console.error("Error:", e.message);
    } finally {
        process.exit();
    }
}
createIndex();
