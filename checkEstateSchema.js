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
        
        // Check if it's a table or view
        const objResult = await pool.request().query(`
            SELECT type_desc, object_id 
            FROM sys.objects 
            WHERE name = 'Estate_Quarters'
        `);
        console.log("Object Type:", objResult.recordset);

        if (objResult.recordset.length > 0) {
            const objectId = objResult.recordset[0].object_id;
            
            // Check indexes
            const idxResult = await pool.request().query(`
                SELECT i.name as index_name, c.name as column_name, i.type_desc
                FROM sys.indexes i
                JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.object_id = ${objectId}
            `);
            console.log("Indexes:", idxResult.recordset);
            
            // Check columns
            const colResult = await pool.request().query(`
                SELECT c.name, t.name as type, c.max_length
                FROM sys.columns c
                JOIN sys.types t ON c.user_type_id = t.user_type_id
                WHERE c.object_id = ${objectId}
            `);
            console.log("Columns:", colResult.recordset);
        }

    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
