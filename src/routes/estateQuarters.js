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
            UPPER(LTRIM(RTRIM(CAST(eq.STATUS1 AS NVARCHAR(32))))) = 'VACANT'
            AND CAST(eq.CATEGORY AS NVARCHAR(64)) IN (
                SELECT CAST(qat.QTR_TYPE AS NVARCHAR(64))
                FROM dbo.[Quarter_Emp_Class] qec
                JOIN dbo.[Quarter_Allotment_Type] qat
                    ON qat.QTR_ID = qec.QTR_ID
                WHERE qec.Class_ID = @ClassId
            )
            AND NOT EXISTS (
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) = 'approved'
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
            )
        ORDER BY eq.OBJECTID DESC
      `);

    const items = result.recordset.map((r) => ({
      Id: r.Id,
      QuarterType: r.QuarterType,
      Location: r.Location,
      QuarterNo: r.QuarterNo,
      NextRosterNo: r.NextRosterNo,
      Status: r.Status,
      IsAvailable: true
    }));

    return res.json({ items, total: items.length });

  } catch (err) {
    console.error("Error fetching vacant quarters:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/total-count", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
  SELECT COUNT(*) AS total
  FROM dbo.[Estate_Quarters]
  WHERE NULLIF(LTRIM(RTRIM(CAST([QUARTER NUMBER] AS NVARCHAR(MAX)))), '') IS NOT NULL
`);

    return res.json({
      total: result.recordset[0]?.total || 0,
    });
  } catch (err) {
    console.error("Error fetching total quarters count:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/status-counts", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(CAST([STATUS1] AS NVARCHAR(100))))) = 'OCCUPIED' THEN 1 ELSE 0 END) AS occupied,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(CAST([STATUS1] AS NVARCHAR(100))))) = 'VACANT' THEN 1 ELSE 0 END) AS vacant,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(CAST([STATUS1] AS NVARCHAR(100))))) = 'BEYOND REPAIR' THEN 1 ELSE 0 END) AS beyondRepair
      FROM dbo.[Estate_Quarters]
    `);

    const row = result.recordset[0] || {};

    return res.json({
      occupied: row.occupied || 0,
      vacant: row.vacant || 0,
      beyondRepair: row.beyondRepair || 0,
    });
  } catch (err) {
    console.error("Error fetching quarter status counts:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/areas", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT DISTINCT CAST(AREA_TYPE AS NVARCHAR(64)) AS AreaType
      FROM dbo.[Estate_Quarters]
      WHERE AREA_TYPE IS NOT NULL AND LTRIM(RTRIM(CAST(AREA_TYPE AS NVARCHAR(64)))) != ''
      ORDER BY AreaType
    `);
    const areas = result.recordset.map((r) => r.AreaType);
    return res.json({ areas });
  } catch (err) {
    console.error("Error fetching areas:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/numbers", requireAuth, async (req, res) => {
  const { areaType } = req.query;
  if (!areaType) {
    return res.status(400).json({ error: "areaType is required" });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("AreaType", sql.NVarChar(64), areaType)
      .query(`
        SELECT DISTINCT CAST([QUARTER NUMBER] AS NVARCHAR(64)) AS QuarterNo
        FROM dbo.[Estate_Quarters]
        WHERE CAST(AREA_TYPE AS NVARCHAR(64)) = @AreaType
          AND [QUARTER NUMBER] IS NOT NULL 
          AND LTRIM(RTRIM(CAST([QUARTER NUMBER] AS NVARCHAR(64)))) != ''
        ORDER BY QuarterNo
      `);
    const numbers = result.recordset.map((r) => r.QuarterNo);
    return res.json({ numbers });
  } catch (err) {
    console.error("Error fetching quarter numbers:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/update-status", requireAuth, async (req, res) => {
  const { area, quarterNumber, status } = req.body;
  if (!area || !quarterNumber || !status) {
    return res.status(400).json({ error: "area, quarterNumber, and status are required" });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("p_Area", sql.NVarChar(64), area)
      .input("p_QuarterNo", sql.NVarChar(64), quarterNumber)
      .input("p_Status", sql.NVarChar(32), status)
      .query(`
        UPDATE dbo.[Estate_Quarters]
        SET STATUS1 = @p_Status
        WHERE CAST(AREA_TYPE AS NVARCHAR(64)) = @p_Area
          AND CAST([QUARTER NUMBER] AS NVARCHAR(64)) = @p_QuarterNo
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Quarter not found with given area and number" });
    }

    return res.json({ success: true, message: "Status updated successfully" });
  } catch (err) {
    console.error("Error updating quarter status:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
