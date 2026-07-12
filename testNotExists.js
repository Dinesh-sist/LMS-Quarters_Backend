const sql = require('mssql');
require('dotenv').config();

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

async function run() {
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
        
        const result = await pool
            .request()
            .input("ClassName", sql.NVarChar(60), "CLASS-II")
            .input("UserId", sql.Int, 1) // Just hardcode UserId=1, since A488 user didn't apply for anything
            .query(`
        SELECT
            CAST(FLOOR(eq.OBJECTID) AS BIGINT)             AS Id,
            CAST(eq.CATEGORY AS NVARCHAR(64))          AS QuarterType,
            CAST(eq.AREA_TYPE AS NVARCHAR(64))         AS Location,
            CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))  AS QuarterNo,
            'available' AS Status
        FROM dbo.[Estate_Quarters] eq
        WHERE
            eq.STATUS1 = 'VACANT'
            AND eq.CATEGORY IN (
                SELECT CAST(qat.QTR_TYPE AS NVARCHAR(64))
                FROM dbo.[Quarter_Emp_Class] qec
                JOIN dbo.[Quarter_Allotment_Type] qat
                    ON qat.QTR_ID = qec.QTR_ID
                WHERE UPPER(LTRIM(RTRIM(qec.[Class]))) = UPPER(LTRIM(RTRIM(@ClassName)))
            )
            \${quarterTypesParam ? `AND eq.CATEGORY IN (\${publishedTypes.map(t => "'" + t.replace(/'/g, "''") + "'").join(',')})` : ''}
            \${assignmentConditions ? assignmentConditions : ''}
            AND NOT EXISTS (
                -- Globally hide quarters that are already approved for someone else
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) = 'approved'
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
                  AND CAST(qa.[QtrLocation] AS NVARCHAR(64)) = CAST(eq.AREA_TYPE AS NVARCHAR(64))
                  AND CAST(qa.[QtrType] AS NVARCHAR(64)) = CAST(eq.CATEGORY AS NVARCHAR(64))
            )
            AND NOT EXISTS (
                -- Hide quarters that the CURRENT user has already applied for (if not rejected/cancelled)
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE qa.UserId = @UserId
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
                  AND CAST(qa.[QtrLocation] AS NVARCHAR(64)) = CAST(eq.AREA_TYPE AS NVARCHAR(64))
                  AND CAST(qa.[QtrType] AS NVARCHAR(64)) = CAST(eq.CATEGORY AS NVARCHAR(64))
                  AND LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) NOT IN ('rejected', 'cancelled', 'vacated')
            )
            `);
            
        console.log("Returned rows:", result.recordset);
        
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
run();
