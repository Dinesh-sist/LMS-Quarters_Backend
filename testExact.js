const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };

async function run() {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('ClassName', sql.NVarChar(60), 'CLASS-II')
      .input('UserId', sql.Int, 1)
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
            AND eq.CATEGORY IN ('D TYPE','C TYPE (MODIFIED)','C TYPE','B TYPE IIIR','B TYPE','A TYPE')
            AND ((eq.CATEGORY = 'D TYPE' AND eq.AREA_TYPE = 'SO' AND eq.[QUARTER NUMBER] = '7') OR (eq.CATEGORY = 'C TYPE (MODIFIED)' AND eq.AREA_TYPE = 'GC' AND eq.[QUARTER NUMBER] = '11') OR (eq.CATEGORY = 'C TYPE' AND eq.AREA_TYPE = 'JC' AND eq.[QUARTER NUMBER] = '41') OR (eq.CATEGORY = 'B TYPE IIIR' AND eq.AREA_TYPE = 'JB' AND eq.[QUARTER NUMBER] = '20') OR (eq.CATEGORY = 'B TYPE' AND eq.AREA_TYPE = 'M-II' AND eq.[QUARTER NUMBER] = '64') OR (eq.CATEGORY = 'A TYPE' AND eq.AREA_TYPE = 'FHC' AND eq.[QUARTER NUMBER] = '20'))
            -- AND NOT EXISTS (
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) = 'approved'
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
                  AND CAST(qa.[QtrLocation] AS NVARCHAR(64)) = CAST(eq.AREA_TYPE AS NVARCHAR(64))
                  AND CAST(qa.[QtrType] AS NVARCHAR(64)) = CAST(eq.CATEGORY AS NVARCHAR(64))
            )
            -- AND NOT EXISTS (
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE qa.UserId = @UserId
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
                  AND CAST(qa.[QtrLocation] AS NVARCHAR(64)) = CAST(eq.AREA_TYPE AS NVARCHAR(64))
                  AND CAST(qa.[QtrType] AS NVARCHAR(64)) = CAST(eq.CATEGORY AS NVARCHAR(64))
                  AND LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) NOT IN ('rejected', 'cancelled', 'vacated')
            )
      `);
    console.log('Result:', result.recordset);
    process.exit(0);
}
run();
