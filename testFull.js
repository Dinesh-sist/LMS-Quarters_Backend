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

async function testFull() {
    try {
        const pool = await sql.connect(config);
        
        let publishedTypes = [];
        let quarterTypesParam = null;
        let assignmentConditions = null;
        
        const pubResult = await pool.request().query(`
            SELECT QuarterTypes, Assignments 
            FROM dbo.Publish 
            WHERE Current_State = 'Published' 
            ORDER BY PublishId DESC 
        `);

        if (pubResult.recordset.length > 0) {
            const rawTypes = pubResult.recordset[0].QuarterTypes;
            if (rawTypes) {
                publishedTypes = rawTypes.split(',').map(t => t.trim()).filter(Boolean);
                quarterTypesParam = publishedTypes.length > 0 ? publishedTypes.join(",") : null;
            }
            
            const rawAssignments = pubResult.recordset[0].Assignments;
            if (rawAssignments) {
                const assignments = JSON.parse(rawAssignments);
                const conditions = assignments.flatMap(a => {
                    if (!a.category || !a.area || !a.quarterNos) return [];
                    const cat = a.category.replace(/'/g, "''");
                    const area = a.area.replace(/'/g, "''");
                    return a.quarterNos.filter(Boolean).map(q => {
                        const qno = q.replace(/'/g, "''");
                        return `(eq.CATEGORY = '\${cat}' AND eq.AREA_TYPE = '\${area}' AND eq.[QUARTER NUMBER] = '\${qno}')`;
                    });
                });
                if (conditions.length > 0) {
                    assignmentConditions = `AND (\${conditions.join(' OR ')})`;
                }
            }
        }

        console.log("assignmentConditions:", assignmentConditions);
        
        // Find user ID for J.PANIGRAHI (from screenshot, employee ID A488)
        const userResult = await pool.request().query("SELECT Id FROM dbo.Users WHERE Username = 'A488'");
        const userId = userResult.recordset.length > 0 ? userResult.recordset[0].UserId : 1;
        console.log("UserId:", userId);

        const result = await pool
            .request()
            .input("ClassName", sql.NVarChar(60), "CLASS-II")
            .input("UserId", sql.Int, userId)
            .query(`
        SELECT
            CAST(FLOOR(eq.OBJECTID) AS BIGINT)             AS Id,
            CAST(eq.CATEGORY AS NVARCHAR(64))          AS QuarterType,
            CAST(eq.AREA_TYPE AS NVARCHAR(64))         AS Location,
            CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))  AS QuarterNo,
            (COALESCE(app.ApplicationCount, 0) % 60) + 1 AS NextRosterNo,
            'available' AS Status
        FROM dbo.[Estate_Quarters] eq
        LEFT JOIN (
            SELECT
                CAST(QtrRequested AS NVARCHAR(64)) AS QuarterNo,
                COUNT(*) AS ApplicationCount
            FROM dbo.Quarter_Applications
            GROUP BY CAST(QtrRequested AS NVARCHAR(64))
        ) app
            ON app.QuarterNo = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
        WHERE
            eq.STATUS1 = 'VACANT'
            AND eq.CATEGORY IN (
                SELECT CAST(qat.QTR_TYPE AS NVARCHAR(64))
                FROM dbo.[Quarter_Emp_Class] qec
                JOIN dbo.[Quarter_Allotment_Type] qat
                    ON qat.QTR_ID = qec.QTR_ID
                WHERE UPPER(LTRIM(RTRIM(qec.[Class]))) = UPPER(LTRIM(RTRIM(@ClassName)))
            )
            ${quarterTypesParam ? `AND eq.CATEGORY IN (${publishedTypes.map(t => "'" + t.replace(/'/g, "''") + "'").join(',')})` : ''}
            ${assignmentConditions ? assignmentConditions : ''}
            AND NOT EXISTS (
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) = 'approved'
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
            )
            AND NOT EXISTS (
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE qa.UserId = @UserId
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
                  AND LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) NOT IN ('rejected', 'cancelled', 'vacated')
            )
        ORDER BY eq.OBJECTID DESC
            `);
            
        console.log("Returned rows:", result.recordset);

    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
testFull();
