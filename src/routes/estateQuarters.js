const express = require("express");
const { getPool, sql } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/vacant", requireAuth, async (req, res) => {
  const { className } = req.query;

  if (!className || !className.trim()) {
    return res.status(400).json({ error: "className is required" });
  }

  try {
    const pool = await getPool();

    // ── Fetch active publication's allowed quarter types & assignments ──────────────────────
    let publishedTypes = [];
    let quarterTypesParam = null;
    let assignmentConditions = null;
    let pubResult = null;
    
    try {
      pubResult = await pool.request().query(`
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
                return `(eq.CATEGORY = '${cat}' AND eq.AREA_TYPE = '${area}' AND eq.[QUARTER NUMBER] = '${qno}')`;
            });
          });
          if (conditions.length > 0) {
            assignmentConditions = `AND (${conditions.join(' OR ')})`;
          }
        }
      }
    } catch (e) {
      console.error("Error reading circular:", e);
    }

    const result = await pool
      .request()
      .input("ClassName", sql.NVarChar(60), className.trim())
      .input("UserId", sql.Int, Number(req.user.sub))
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
                -- Hide quarters that the CURRENT user has already applied for (if not rejected/cancelled)
                SELECT 1
                FROM dbo.Quarter_Applications qa
                WHERE qa.UserId = @UserId
                  AND CAST(qa.[QtrRequested] AS NVARCHAR(64)) = CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64))
                  AND CAST(qa.[QtrLocation] AS NVARCHAR(64)) = CAST(eq.AREA_TYPE AS NVARCHAR(64))
                  AND CAST(qa.[QtrType] AS NVARCHAR(64)) = CAST(eq.CATEGORY AS NVARCHAR(64))
                  AND LOWER(LTRIM(RTRIM(CAST(qa.[Status] AS NVARCHAR(24))))) NOT IN ('rejected', 'cancelled', 'vacated')
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

    console.log("=== /vacant API CALLED ===");
    console.log("className:", className);
    console.log("quarterTypesParam:", quarterTypesParam);
    console.log("assignmentConditions:", assignmentConditions);
    console.log("items.length:", items.length);
    console.log("items:", items);
    console.log("==========================");

    res.json({
      items,
      publishedTypes
    });

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
router.get("/categories", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT DISTINCT CAST(CATEGORY AS NVARCHAR(64)) AS Category
      FROM dbo.[Estate_Quarters]
      WHERE CATEGORY IS NOT NULL AND LTRIM(RTRIM(CAST(CATEGORY AS NVARCHAR(64)))) != ''
      ORDER BY Category
    `);
    const categories = result.recordset.map((r) => r.Category);
    return res.json({ categories });
  } catch (err) {
    console.error("Error fetching categories:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/areas", requireAuth, async (req, res) => {
  const { category } = req.query;
  try {
    const pool = await getPool();
    let query = `
      SELECT DISTINCT CAST(AREA_TYPE AS NVARCHAR(64)) AS AreaType
      FROM dbo.[Estate_Quarters]
      WHERE AREA_TYPE IS NOT NULL AND LTRIM(RTRIM(CAST(AREA_TYPE AS NVARCHAR(64)))) != ''
    `;
    if (category) {
      query += ` AND CAST(CATEGORY AS NVARCHAR(64)) = @Category`;
    }
    query += ` ORDER BY AreaType`;

    const request = pool.request();
    if (category) {
      request.input("Category", sql.NVarChar(64), category);
    }
    
    const result = await request.query(query);
    const areas = result.recordset.map((r) => r.AreaType);
    return res.json({ areas });
  } catch (err) {
    console.error("Error fetching areas:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/employee-lookup/:employeeId", requireAuth, async (req, res) => {
  const { employeeId } = req.params;
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("employeeId", sql.NVarChar(64), employeeId)
      .query(`
        SELECT EmployeeName, EmpClass, Category, Area_type, Quarter_no,
               DateOfBirth, DateOfJoining, GradDate, Mobile, Email, Caste, DPT_NM
        FROM dbo.UserDetails
        WHERE EmployeeId = @employeeId
      `);
      
    if (result.recordset.length === 0) {
      return res.json({ exists: false });
    }
    
    const userDetailsData = result.recordset[0];
    
    const estateResult = await pool
      .request()
      .input("employeeId", sql.NVarChar(64), employeeId)
      .query(`
        SELECT CAST(CATEGORY AS NVARCHAR(64)) AS CATEGORY, 
               CAST(AREA_TYPE AS NVARCHAR(64)) AS AREA_TYPE, 
               CAST([QUARTER NUMBER] AS NVARCHAR(64)) AS QUARTER_NUMBER
        FROM dbo.[Estate_Quarters]
        WHERE EMP_OTH = @employeeId
      `);

    const estateData = estateResult.recordset.length > 0 ? estateResult.recordset[0] : null;

    return res.json({
      exists: true,
      name: userDetailsData.EmployeeName,
      empClass: userDetailsData.EmpClass,
      userDetailsQuarter: {
        category: userDetailsData.Category,
        areaType: userDetailsData.Area_type,
        quarterNo: userDetailsData.Quarter_no
      },
      estateQuarter: estateData ? {
        category: estateData.CATEGORY,
        areaType: estateData.AREA_TYPE,
        quarterNo: estateData.QUARTER_NUMBER
      } : null,
      dateOfBirth: userDetailsData.DateOfBirth ? 
        `${userDetailsData.DateOfBirth.getFullYear()}-${String(userDetailsData.DateOfBirth.getMonth() + 1).padStart(2, '0')}-${String(userDetailsData.DateOfBirth.getDate()).padStart(2, '0')}` : "",
      dateOfJoining: userDetailsData.DateOfJoining ? 
        `${userDetailsData.DateOfJoining.getFullYear()}-${String(userDetailsData.DateOfJoining.getMonth() + 1).padStart(2, '0')}-${String(userDetailsData.DateOfJoining.getDate()).padStart(2, '0')}` : "",
      gradDate: userDetailsData.GradDate ? 
        `${userDetailsData.GradDate.getFullYear()}-${String(userDetailsData.GradDate.getMonth() + 1).padStart(2, '0')}-${String(userDetailsData.GradDate.getDate()).padStart(2, '0')}` : "",
      mobile: userDetailsData.Mobile || "",
      email: userDetailsData.Email || "",
      caste: userDetailsData.Caste || "",
      department: userDetailsData.DPT_NM || ""
    });
  } catch (err) {
    console.error("Error looking up employee:", err);
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


router.get("/current-status", requireAuth, async (req, res) => {
  const { area, quarterNumber } = req.query;
  if (!area || !quarterNumber) {
    return res.status(400).json({ error: "area and quarterNumber are required" });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("p_Area", sql.NVarChar(64), area)
      .input("p_QuarterNo", sql.NVarChar(64), quarterNumber)
      .query(`
        SELECT TOP 1 
          CAST(eq.STATUS1 AS NVARCHAR(64)) AS Status,
          CAST(eq.NAME AS NVARCHAR(255)) AS EmployeeName,
          CAST(eq.EMP_OTH AS NVARCHAR(64)) AS EmployeeId,
          CAST(ud.EmpClass AS NVARCHAR(64)) AS EmployeeClass,
          CAST(eq.[ALLOTMENT ORDER] AS NVARCHAR(255)) AS AllotmentId,
          eq.ALT_DT AS AllotmentDate
        FROM dbo.[Estate_Quarters] eq
        LEFT JOIN dbo.UserDetails ud 
          ON CAST(eq.EMP_OTH AS NVARCHAR(64)) = CAST(ud.EmployeeId AS NVARCHAR(64))
        WHERE CAST(eq.AREA_TYPE AS NVARCHAR(64)) = @p_Area
          AND CAST(eq.[QUARTER NUMBER] AS NVARCHAR(64)) = @p_QuarterNo
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Quarter not found" });
    }

    const record = result.recordset[0];
    let parsedDate = "";
    if (record.AllotmentDate) {
      const d = new Date(record.AllotmentDate);
      if (!isNaN(d.getTime())) {
        parsedDate = d.toISOString().split('T')[0];
      }
    }
    return res.json({ 
      status: record.Status || "",
      employeeName: record.EmployeeName || "",
      employeeId: record.EmployeeId || "",
      employeeClass: record.EmployeeClass || "",
      allotmentId: record.AllotmentId || "",
      allotmentDate: parsedDate
    });
  } catch (err) {
    console.error("Error fetching current quarter status:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/update-status", requireAuth, async (req, res) => {
  const { area, quarterNumber, status, employeeId, employeeName, employeeClass, allotmentId, allotmentDate } = req.body;
  if (!area || !quarterNumber || !status) {
    return res.status(400).json({ error: "area, quarterNumber, and status are required" });
  }

  try {
    const pool = await getPool();

    const currentQtrRes = await pool
      .request()
      .input("p_Area_Lookup", sql.NVarChar(64), area)
      .input("p_QuarterNo_Lookup", sql.NVarChar(64), quarterNumber)
      .query(`
        SELECT EMP_OTH, CAST(CATEGORY AS NVARCHAR(64)) AS CATEGORY
        FROM dbo.[Estate_Quarters]
        WHERE CAST(AREA_TYPE AS NVARCHAR(64)) = @p_Area_Lookup
          AND CAST([QUARTER NUMBER] AS NVARCHAR(64)) = @p_QuarterNo_Lookup
      `);
      
    if (currentQtrRes.recordset.length === 0) {
      return res.status(404).json({ error: "Quarter not found with given area and number" });
    }
    
    const existingEmpOth = currentQtrRes.recordset[0].EMP_OTH;
    const targetCategory = currentQtrRes.recordset[0].CATEGORY;
    
    if (status.toUpperCase() !== 'OCCUPIED' && existingEmpOth) {
      await pool
        .request()
        .input("existingEmpOth", sql.NVarChar(255), existingEmpOth)
        .query(`
          UPDATE dbo.UserDetails 
          SET Category = NULL, Area_type = NULL, Quarter_no = NULL 
          WHERE EmployeeId = @existingEmpOth
        `);
    }

    if (status.toUpperCase() === 'OCCUPIED' && employeeId) {
      // Find and clear any other quarter currently assigned to this employee
      await pool
        .request()
        .input("employeeId", sql.NVarChar(64), employeeId)
        .input("targetArea", sql.NVarChar(64), area)
        .input("targetQuarterNo", sql.NVarChar(64), quarterNumber)
        .query(`
          UPDATE dbo.[Estate_Quarters]
          SET STATUS1 = 'VACANT', NAME = NULL, EMP_OTH = NULL, [ALLOTMENT ORDER] = NULL, ALT_DT = NULL
          WHERE EMP_OTH = @employeeId 
            AND (CAST(AREA_TYPE AS NVARCHAR(64)) != @targetArea OR CAST([QUARTER NUMBER] AS NVARCHAR(64)) != @targetQuarterNo)
        `);

      // Update UserDetails for this employee with the new quarter details
      await pool
        .request()
        .input("employeeId", sql.NVarChar(64), employeeId)
        .input("targetCategory", sql.NVarChar(64), targetCategory || null)
        .input("targetArea", sql.NVarChar(64), area)
        .input("targetQuarterNo", sql.NVarChar(64), quarterNumber)
        .query(`
          UPDATE dbo.UserDetails 
          SET Category = @targetCategory, Area_type = @targetArea, Quarter_no = @targetQuarterNo 
          WHERE EmployeeId = @employeeId
        `);
    }

    const result = await pool
      .request()
      .input("p_Area", sql.NVarChar(64), area)
      .input("p_QuarterNo", sql.NVarChar(64), quarterNumber)
      .input("p_Status", sql.NVarChar(32), status)
      .input("p_EmployeeName", sql.NVarChar(255), employeeName || null)
      .input("p_EmployeeId", sql.NVarChar(64), employeeId || null)
      .input("p_AllotmentId", sql.NVarChar(255), allotmentId || null)
      .input("p_AllotmentDate", sql.Date, allotmentDate || null)
      .query(`
        UPDATE dbo.[Estate_Quarters]
        SET 
          STATUS1 = @p_Status,
          NAME = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_EmployeeName END,
          EMP_OTH = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_EmployeeId END,
          [ALLOTMENT ORDER] = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_AllotmentId END,
          ALT_DT = CASE WHEN UPPER(LTRIM(RTRIM(@p_Status))) != 'OCCUPIED' THEN NULL ELSE @p_AllotmentDate END
        WHERE CAST(AREA_TYPE AS NVARCHAR(64)) = @p_Area
          AND CAST([QUARTER NUMBER] AS NVARCHAR(64)) = @p_QuarterNo
      `);

    return res.json({ success: true, message: "Status updated successfully" });
  } catch (err) {
    console.error("Error updating quarter status:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;



















































