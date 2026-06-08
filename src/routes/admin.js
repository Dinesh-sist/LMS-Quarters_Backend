const express = require("express");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");


const router = express.Router();



router.use(requireAuth);
router.use(requireRole("admin", "employee"));


router.get("/applications", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(
    "SELECT a.Id, a.Status, a.Notes, a.CreatedAt, a.UpdatedAt, u.Username, u.Role, q.QuarterNo, q.QuarterType, q.Location FROM Quarter_Applications a JOIN dbo.Users u ON u.Id=a.UserId LEFT JOIN dbo.Quarters q ON q.Id=a.QuarterId ORDER BY a.Id DESC"
  );
  return res.json({ items: result.recordset });
});


router.get("/verify-quarter-applications", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      id,
      appNo,
      empId,
      empName,
      [class],
      CONVERT(varchar(10), gradDate, 23) AS gradDate,
      CONVERT(varchar(10), dateOfJoin, 23) AS dateOfJoin,
      basic,
      CONVERT(varchar(10), dob, 23) AS dob,
      dept,
      casteID,
      currentQtr,
      currentQtrType,
      requestedQtr,
      requestedQtrLocation,
      requestedQtrType,
      exchangeQtr,
      proofFile,
      CONVERT(varchar(10), requestedDate, 23) AS requestedDate,
      stage
    FROM dbo.VerifyQuarterApplications
    ORDER BY appNo DESC
  `);
  return res.json({ items: result.recordset });
});

router.get("/check-approval", async (req, res) => {
  try {
    const userId = Number(req.user.sub);
    const pool = await getPool();

    const result = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT
          [Id],
          [AppNo],
          [PriorityNo]                          AS Priority,
          [UserId],
          [EmpId],
          [EmpName],
          [Class],
          [Caste]                               AS cast,
          [AllotCatId],
          [EmailId],
          CONVERT(varchar(10), [ReqDate], 23)   AS reqdate,
          [QtrRequested],
          [QtrLocation],
          [QtrType]                             AS Qtrtype,
          [Reason],
          [ExchangeReason],
          [AttachmentPath],
          [Status],
          [CreatedAt],
          [UpdatedAt]
        FROM dbo.Quarter_Applications
        WHERE [UserId] = @UserId
        ORDER BY [Id] DESC
      `);

    return res.json({ items: result.recordset });

  } catch (err) {
    console.error("Error fetching check-approval:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/check-approval 
router.post("/checkapprovalsave", async (req, res) => {
  try {
    const userId = Number(req.user.sub);
    const {
      quarterId,
      reason = null,
      exchangeReason = null,
    } = req.body;

    if (!quarterId) {
      return res.status(400).json({ error: "quarterId is required" });
    }

    const pool = await getPool();
    const empResult = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT
          [EmployeeId]   AS EmpId,
          [EmployeeName] AS EmpName,
          [ClassName]    AS Class,
          [Email]        AS EmailId,
          [DateOfBirth]  AS DOB,
          [DateOfJoining] AS DOJ
        FROM dbo.UserDetails
        WHERE UserId = @UserId
      `);

    const emp = empResult.recordset[0];
    if (!emp) {
      console.error(`Employee not found for UserId: ${userId}`);
      return res.status(404).json({ error: "Employee record not found. Please contact administrator." });
    }


    const qtrResult = await pool
      .request()
      .input("QuarterId", sql.Int, parseInt(quarterId))
      .query(`
        SELECT
          CAST([QUARTER NUMBER] AS NVARCHAR(64)) AS QuarterNo,
          CAST(CATEGORY         AS NVARCHAR(64)) AS QuarterType,
          CAST(AREA_TYPE        AS NVARCHAR(64)) AS Location
        FROM [LMSQuarters].[dbo].[Estate_Quarters]
        WHERE OBJECTID = @QuarterId
      `);
    const qtr = qtrResult.recordset[0] || {};


    const appNo = "APP-" + Date.now();

    const result = await pool
      .request()
      .input("AppNo", sql.NVarChar(50), appNo)
      .input("UserId", sql.Int, userId)
      .input("EmpId", sql.NVarChar(100), emp.EmpId)
      .input("EmpName", sql.NVarChar(200), emp.EmpName)
      .input("Class", sql.NVarChar(100), emp.Class)
      .input("Caste", sql.NVarChar(100), null)
      .input("AllotCatId", sql.Int, null)
      .input("EmailId", sql.NVarChar(200), emp.EmailId)
      .input("QtrRequested", sql.NVarChar(64), qtr.QuarterNo || null)
      .input("QtrLocation", sql.NVarChar(64), qtr.Location || null)
      .input("QtrType", sql.NVarChar(64), qtr.QuarterType || null)
      .input("Reason", sql.NVarChar(100), reason)
      .input("ExchangeReason", sql.NVarChar(400), exchangeReason)
      .query(`
        INSERT INTO dbo.Quarter_Applications (
          AppNo, UserId, EmpId, EmpName, Class, Caste,
          AllotCatId, EmailId, ReqDate, QtrRequested,
          QtrLocation, QtrType, Reason, ExchangeReason,
          Status, CreatedAt, UpdatedAt
        )
        OUTPUT INSERTED.Id, INSERTED.AppNo
        VALUES (
          @AppNo, @UserId, @EmpId, @EmpName, @Class, @Caste,
          @AllotCatId, @EmailId, GETDATE(), @QtrRequested,
          @QtrLocation, @QtrType, @Reason, @ExchangeReason,
          'pending', GETDATE(), GETDATE()
        )
      `);

    const inserted = result.recordset[0];
    return res.status(201).json({
      id: inserted?.Id,
      appNo: inserted?.AppNo,
    });

  } catch (err) {
    console.error("Error saving application:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/status-of-applications", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      id,
      appNo,
      empId,
      empName,
      [class],
      CONVERT(varchar(10), gradDate, 23) AS gradDate,
      CONVERT(varchar(10), dateOfJoin, 23) AS dateOfJoin,
      basic,
      CONVERT(varchar(10), dob, 23) AS dob,
      dept,
      casteId,
      currentQtr,
      currentQtyType,
      reqQtr,
      reqQtrLocation,
      reqQtrType,
      exchange,
      proofFile,
      CONVERT(varchar(10), reqDate, 23) AS reqDate,
      rosterNo,
      result
    FROM dbo.StatusOfApplications
    ORDER BY appNo DESC
  `);
  return res.json({ items: result.recordset });
});

// router.get("/house-allotment-committee-history", async (req, res) => {
//   const pool = await getPool();
//   const result = await pool.request().query(`
//     SELECT
//       id,
//       CONVERT(varchar(10), committeeHeld, 23) AS committeeHeld,
//       remarks
//     FROM dbo.HistoryofAllotment
//     ORDER BY committeeHeld DESC
//   `);
//   return res.json({ items: result.recordset });
// });
router.post("/publish", async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;

    // Validate required fields
    if (!fromDate || !toDate) {
      return res.status(400).json({
        error: "Both From Date and To Date are required."
      });
    }

    // Normalize dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);

    const to = new Date(toDate);
    to.setHours(0, 0, 0, 0);

    // Validation: From Date cannot be in the past
    if (from < today) {
      return res.status(400).json({
        error: "From Date cannot be earlier than today's date."
      });
    }

    // Validation: To Date must be after From Date
    if (to <= from) {
      return res.status(400).json({
        error: "To Date must be later than From Date."
      });
    }

    const pool = await getPool();

    // Check if a publication is already active
    const existingPublication = await pool.request().query(`
      SELECT TOP 1 PublishID
      FROM dbo.Publish
      WHERE Current_State = 'Published'
    `);

    if (existingPublication.recordset.length > 0) {
      return res.status(400).json({
        error: "A publication is already active. Stop the current publication before creating a new one."
      });
    }

    // Create new publication
    await pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate)
      .query(`
        INSERT INTO dbo.Publish
        (
          From_Date,
          To_Date,
          Current_State
        )
        VALUES
        (
          @fromDate,
          @toDate,
          'Published'
        )
      `);

    return res.json({
      success: true,
      message: "Publication created successfully."
    });

  } catch (err) {
    console.error("Publish Error:", err);

    return res.status(500).json({
      error: "Failed to publish"
    });
  }
});
router.get("/publication/latest", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT TOP 1
        PublishID,
        From_Date,
        To_Date,
        Current_State
      FROM dbo.Publish
      ORDER BY PublishID DESC
    `);

    res.json(result.recordset[0] || null);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to load publication"
    });
  }
});

const UpdateStatusSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  notes: z.string().max(400).optional()
});

router.post("/stop-publication", async (req, res) => {
  try {
    const pool = await getPool();

    await pool.request().query(`
      UPDATE dbo.Publish
      SET Current_State = 'Closed'
      WHERE PublishID = (
        SELECT TOP 1 PublishID
        FROM dbo.Publish
        ORDER BY PublishID DESC
      )
    `);

    res.json({
      success: true,
      message: "Publication stopped successfully"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to stop publication"
    });
  }
});
router.put("/publication/update", async (req, res) => {
  try {
    const { toDate } = req.body;

    if (!toDate) {
      return res.status(400).json({
        error: "To Date is required."
      });
    }

    const pool = await getPool();

    const currentPublication = await pool.request().query(`
      SELECT TOP 1 *
      FROM dbo.Publish
      WHERE Current_State = 'Published'
      ORDER BY PublishID DESC
    `);

    if (currentPublication.recordset.length === 0) {
      return res.status(404).json({
        error: "No active publication found."
      });
    }

    const publication = currentPublication.recordset[0];

    const fromDate = new Date(publication.From_Date);
    const newToDate = new Date(toDate);

    fromDate.setHours(0, 0, 0, 0);
    newToDate.setHours(0, 0, 0, 0);

    if (newToDate <= fromDate) {
      return res.status(400).json({
        error: "To Date must be later than From Date."
      });
    }

    await pool.request()
      .input("ToDate", sql.Date, toDate)
      .input("PublishID", sql.Int, publication.PublishID)
      .query(`
        UPDATE dbo.Publish
        SET To_Date = @ToDate
        WHERE PublishID = @PublishID
      `);

    res.json({
      success: true
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to update publication"
    });
  }
});
router.patch("/applications/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });


  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const { status, notes } = parsed.data;
  const pool = await getPool();


  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .input("Status", sql.NVarChar(24), status)
    .input("Notes", sql.NVarChar(400), notes ?? null)
    .query(
      "UPDATE Quarter_Applications SET Status=@Status, Notes=COALESCE(@Notes, Notes), UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id; SELECT @@ROWCOUNT AS Affected"
    );

  const affected = result.recordset[0]?.Affected ?? 0;
  if (!affected) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

module.exports = router;
