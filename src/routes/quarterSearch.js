const express = require("express");
const { getPool, sql } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Gives the location of the building(s) for one quarter.
// GET /api/quarter-search/location?category=D TYPE&area=MV&quarterNumber=5
// Read only. Used by the map search.
router.get("/location", requireAuth, async (req, res) => {
  const { category, area, quarterNumber } = req.query;
  if (!category || !area || !quarterNumber) {
    return res.status(400).json({ error: "category, area and quarterNumber are required" });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Category", sql.NVarChar(64), category)
      .input("Area", sql.NVarChar(64), area)
      .input("QNo", sql.NVarChar(64), quarterNumber)
      .query(`
        SELECT
          MIN(Shape.STEnvelope().STPointN(1).STX) AS minLon,
          MIN(Shape.STEnvelope().STPointN(1).STY) AS minLat,
          MAX(Shape.STEnvelope().STPointN(3).STX) AS maxLon,
          MAX(Shape.STEnvelope().STPointN(3).STY) AS maxLat
        FROM dbo.[Estate_Quarters]
        WHERE Shape IS NOT NULL
          AND CAST(CATEGORY AS NVARCHAR(64)) = @Category
          AND CAST(AREA_TYPE AS NVARCHAR(64)) = @Area
          AND CAST([QUARTER NUMBER] AS NVARCHAR(64)) = @QNo
        GROUP BY CONVERT(VARBINARY(MAX), Shape)
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Quarter not found" });
    }

    // One item per building (normally one; D TYPE, MV, 5 has two)
    const buildings = result.recordset.map((r) => ({
      minLon: r.minLon,
      minLat: r.minLat,
      maxLon: r.maxLon === null ? r.minLon : r.maxLon,
      maxLat: r.maxLat === null ? r.minLat : r.maxLat,
    }));
    return res.json({ buildings });
  } catch (err) {
    console.error("Error fetching quarter location:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;