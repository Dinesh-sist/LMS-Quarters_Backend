const express = require("express");
const { getPool, sql } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/vacant", requireAuth, async (req, res) => {
  const { classId } = req.query;

  if (!classId) {
    return res.status(400).json({ error: "classId is required" });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("ClassId", sql.Int, parseInt(classId))
      .query(`
        SELECT
            CAST(eq.OBJECTID AS INT)                   AS Id,
            CAST(eq.CATEGORY AS NVARCHAR(64))          AS QuarterType,
            CAST(eq.AREA_TYPE AS NVARCHAR(64))         AS Location,
            CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))  AS QuarterNo,
            'available' AS Status
        FROM [LMSQuarters].[dbo].[Estate_Quarters] eq
        WHERE 
            UPPER(LTRIM(RTRIM(CAST(eq.STATUS1 AS NVARCHAR(32))))) = 'VACANT'
            AND CAST(eq.CATEGORY AS NVARCHAR(64)) IN (
                SELECT CAST(qat.QTR_TYPE AS NVARCHAR(64))
                FROM [LMSQuarters].[dbo].[Quarter_Emp_Class] qec
                JOIN [LMSQuarters].[dbo].[Quarter_Allotment_Type] qat
                    ON qat.QTR_ID = qec.QTR_ID
                WHERE qec.Class_ID = @ClassId
            )
        ORDER BY eq.OBJECTID DESC
      `);

    const items = result.recordset.map((r) => ({
      Id: r.Id,
      QuarterType: r.QuarterType,
      Location: r.Location,
      QuarterNo: r.QuarterNo,
      Status: r.Status,
      IsAvailable: true
    }));

    return res.json({ items, total: items.length });

  } catch (err) {
    console.error("Error fetching vacant quarters:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;