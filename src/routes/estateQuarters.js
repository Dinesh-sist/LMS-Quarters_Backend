const express = require("express");
const { getPool } = require("../db");

const router = express.Router();

// Vacant estate quarters listing
router.get("/vacant", async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      `
SELECT
  CAST(OBJECTID AS INT) AS Id,
  CAST(CATEGORY AS NVARCHAR(64)) AS QuarterType,
  CAST(AREA_TYPE AS NVARCHAR(64)) AS AreaType,
  CAST([QUARTER NUMBER] AS NVARCHAR(64)) AS QuarterNo
FROM dbo.Estate_Quarters
WHERE UPPER(LTRIM(RTRIM(CAST(STATUS1 AS NVARCHAR(32))))) = 'VACANT'
ORDER BY OBJECTID DESC
`
    );

  // Keep compatibility with existing frontend table expectations (Location used as "Area Type")
  const items = result.recordset.map((r) => ({
    Id: r.Id,
    QuarterType: r.QuarterType,
    Location: r.AreaType,
    QuarterNo: r.QuarterNo,
    IsAvailable: true
  }));

  return res.json({ items });
});

module.exports = router;

