const express = require("express");
const { getPool, sql } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const TABLE_NAME = "[LMSQuartersNew].[dbo].[Estate_Quarters]";
const spatialColumnCache = new Map();

async function resolveSpatialColumn(pool, tableName) {
  const key = String(tableName || "").trim();
  if (!key) return null;
  if (spatialColumnCache.has(key)) return spatialColumnCache.get(key);

  try {
    const meta = await pool
      .request()
      .input("tableName", sql.NVarChar, key)
      .query(`
        SELECT TOP (1)
          c.[name] AS ColumnName,
          LOWER(t.[name]) AS TypeName
        FROM sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        WHERE c.[object_id] = OBJECT_ID(@tableName)
          AND (
            LOWER(t.[name]) IN ('geometry', 'geography')
            OR LOWER(c.[name]) IN ('shape', 'geom', 'geometry', 'geography', 'wkt')
          )
        ORDER BY
          CASE
            WHEN LOWER(c.[name]) = 'shape' THEN 0
            WHEN LOWER(t.[name]) IN ('geometry', 'geography') THEN 1
            WHEN LOWER(c.[name]) IN ('geom', 'geometry', 'geography') THEN 2
            WHEN LOWER(c.[name]) = 'wkt' THEN 3
            ELSE 4
          END,
          c.column_id
      `);

    const row = meta.recordset?.[0];
    const resolved = row
      ? {
        columnName: String(row.ColumnName || "").trim(),
        typeName: String(row.TypeName || "").trim().toLowerCase(),
      }
      : null;
    spatialColumnCache.set(key, resolved);
    return resolved;
  } catch (err) {
    console.error(`[MapWkt] Failed to resolve spatial column for table=${key}:`, err);
    spatialColumnCache.set(key, null);
    return null;
  }
}

function buildShapeWktExpression(shapeColumnName, shapeType) {
  const shapeRef = `[${shapeColumnName}]`;

  const geometryWktExpr = `
    CASE
      WHEN ${shapeRef}.MakeValid().STGeometryType() IN ('CurvePolygon', 'CircularString', 'CompoundCurve')
        THEN ${shapeRef}.MakeValid().STCurveToLine().MakeValid().STAsText()
      ELSE ${shapeRef}.MakeValid().STAsText()
    END
  `;

  const geographyWktExpr = `
    CASE
      WHEN ${shapeRef}.MakeValid().STGeometryType() IN ('CurvePolygon', 'CircularString', 'CompoundCurve')
        THEN ${shapeRef}.MakeValid().STCurveToLine().MakeValid().STAsText()
      ELSE ${shapeRef}.MakeValid().STAsText()
    END
  `;

  const varbinaryAsGeometryWktExpr = `
    CASE
      WHEN TRY_CONVERT(geometry, ${shapeRef}) IS NOT NULL THEN
        CASE
          WHEN TRY_CONVERT(geometry, ${shapeRef}).MakeValid().STGeometryType() IN ('CurvePolygon', 'CircularString', 'CompoundCurve')
            THEN TRY_CONVERT(geometry, ${shapeRef}).MakeValid().STCurveToLine().MakeValid().STAsText()
          ELSE TRY_CONVERT(geometry, ${shapeRef}).MakeValid().STAsText()
        END
      ELSE NULL
    END
  `;

  const varbinaryAsGeographyWktExpr = `
    CASE
      WHEN TRY_CONVERT(geography, ${shapeRef}) IS NOT NULL THEN
        CASE
          WHEN TRY_CONVERT(geography, ${shapeRef}).MakeValid().STGeometryType() IN ('CurvePolygon', 'CircularString', 'CompoundCurve')
            THEN TRY_CONVERT(geography, ${shapeRef}).MakeValid().STCurveToLine().MakeValid().STAsText()
          ELSE TRY_CONVERT(geography, ${shapeRef}).MakeValid().STAsText()
        END
      ELSE NULL
    END
  `;

  const hexStringToGeometryWktExpr = `
    CASE
      WHEN TRY_CONVERT(varbinary(max), ${shapeRef}, 1) IS NOT NULL
        AND TRY_CONVERT(geometry, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)) IS NOT NULL THEN
        CASE
          WHEN TRY_CONVERT(geometry, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)).MakeValid().STGeometryType() IN ('CurvePolygon', 'CircularString', 'CompoundCurve')
            THEN TRY_CONVERT(geometry, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)).MakeValid().STCurveToLine().MakeValid().STAsText()
          ELSE TRY_CONVERT(geometry, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)).MakeValid().STAsText()
        END
      ELSE NULL
    END
  `;

  const hexStringToGeographyWktExpr = `
    CASE
      WHEN TRY_CONVERT(varbinary(max), ${shapeRef}, 1) IS NOT NULL
        AND TRY_CONVERT(geography, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)) IS NOT NULL THEN
        CASE
          WHEN TRY_CONVERT(geography, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)).MakeValid().STGeometryType() IN ('CurvePolygon', 'CircularString', 'CompoundCurve')
            THEN TRY_CONVERT(geography, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)).MakeValid().STCurveToLine().MakeValid().STAsText()
          ELSE TRY_CONVERT(geography, TRY_CONVERT(varbinary(max), ${shapeRef}, 1)).MakeValid().STAsText()
        END
      ELSE NULL
    END
  `;

  if (shapeType === "geometry") return geometryWktExpr;
  if (shapeType === "geography") return geographyWktExpr;

  if (shapeType === "varbinary" || shapeType === "binary" || shapeType === "image") {
    return `COALESCE(${varbinaryAsGeometryWktExpr}, ${varbinaryAsGeographyWktExpr})`;
  }

  return `
    COALESCE(
      ${hexStringToGeometryWktExpr},
      ${hexStringToGeographyWktExpr},
      CASE
        WHEN TRY_CONVERT(nvarchar(max), ${shapeRef}) IS NOT NULL
          AND (
            UPPER(LTRIM(RTRIM(TRY_CONVERT(nvarchar(max), ${shapeRef})))) LIKE 'POLYGON%'
            OR UPPER(LTRIM(RTRIM(TRY_CONVERT(nvarchar(max), ${shapeRef})))) LIKE 'MULTIPOLYGON%'
            OR UPPER(LTRIM(RTRIM(TRY_CONVERT(nvarchar(max), ${shapeRef})))) LIKE 'LINESTRING%'
            OR UPPER(LTRIM(RTRIM(TRY_CONVERT(nvarchar(max), ${shapeRef})))) LIKE 'POINT%'
            OR UPPER(LTRIM(RTRIM(TRY_CONVERT(nvarchar(max), ${shapeRef})))) LIKE 'GEOMETRYCOLLECTION%'
          )
          THEN TRY_CONVERT(nvarchar(max), ${shapeRef})
        ELSE NULL
      END
    )
  `;
}

router.get("/wkt", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const spatialColumn = await resolveSpatialColumn(pool, TABLE_NAME);
    if (!spatialColumn?.columnName) {
      return res.status(500).json({ error: "No spatial column found in Estate_Quarters" });
    }

    const shapeWktExpr = buildShapeWktExpression(spatialColumn.columnName, spatialColumn.typeName);

    const result = await pool.request().query(`
      WITH QuarterShapes AS (
        SELECT
          CAST([OBJECTID] AS INT) AS OBJECTID,
          CAST([QUARTER NUMBER] AS NVARCHAR(64)) AS QuarterNo,
          CAST([CATEGORY] AS NVARCHAR(64)) AS QuarterType,
          CAST([AREA_TYPE] AS NVARCHAR(64)) AS AreaType,
          CAST([STATUS1] AS NVARCHAR(64)) AS Status,
          ${shapeWktExpr} AS Shape
        FROM ${TABLE_NAME}
        WHERE [${spatialColumn.columnName}] IS NOT NULL
      )
      SELECT
        OBJECTID,
        QuarterNo,
        QuarterType,
        AreaType,
        Status,
        Shape
      FROM QuarterShapes
      WHERE Shape IS NOT NULL
      ORDER BY OBJECTID
    `);

    return res.json(result.recordset || []);
  } catch (err) {
    console.error("[MapWkt] Failed to fetch quarter shapes:", err);
    return res.status(500).json({ error: "Failed to fetch quarter map data" });
  }
});

module.exports = router;
