const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");


const router = express.Router();

// ── File upload (multer) setup ───────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});



const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    // Allow common document & image types
    const allowed = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".gif"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, Word and image files are allowed"));
    }
  },
});



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
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        qa.[Id],
        qa.[AppNo],
        qa.[UserId],
        qa.[EmpId],
        qa.[EmpName],
        qa.[Class],
        qa.[Caste],
        qa.[EmailId],
        CONVERT(varchar(10), qa.[ReqDate], 23)    AS ReqDate,
        qa.[QtrRequested],
        qa.[QtrLocation],
        qa.[QtrType],
        qa.[Reason],
        qa.[ExchangeReason],
        qa.[AttachmentPath],
        qa.[Status],
        CONVERT(varchar(10), ud.DateOfJoining, 23) AS DateOfJoining,
        CONVERT(varchar(10), ud.GradDate, 23) AS GradDate,
        CONVERT(varchar(19), qa.[CreatedAt], 120)  AS CreatedAt,
        CONVERT(varchar(19), qa.[UpdatedAt], 120)  AS UpdatedAt
      FROM dbo.Quarter_Applications qa
      LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
      ORDER BY qa.[Id] DESC
    `);
    return res.json({ items: result.recordset });
  } catch (err) {
    console.error("verify-quarter-applications error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
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
          qa.[Id],
          qa.[AppNo],
          qa.[PriorityNo],
          qa.[UserId],
          qa.[EmpId],
          qa.[EmpName],
          qa.[Class],
          qa.[Caste],
          qa.[AllotCatId],
          qa.[EmailId],
          CONVERT(varchar(10), qa.[ReqDate], 23)   AS ReqDate,
          qa.[QtrRequested],
          qa.[QtrLocation],
          qa.[QtrType],
          qa.[Reason],
          qa.[ExchangeReason],
          qa.[AttachmentPath],
          qa.[Status],
          CONVERT(varchar(10), ud.GradDate, 23) AS GradDate,
          qa.[CreatedAt],
          qa.[UpdatedAt]
        FROM dbo.Quarter_Applications qa
        LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
        WHERE qa.[UserId] = @UserId
        ORDER BY qa.[Id] DESC
      `);

    return res.json({ items: result.recordset });

  } catch (err) {
    console.error("Error fetching check-approval:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/upload-attachment/:id  — attach a file to an existing application
router.post("/upload-attachment/:id", upload.single("attachment"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "Invalid application ID" });

    if (!req.file)
      return res.status(400).json({ error: "No file uploaded" });

    // Store just the filename so it can be served via /uploads/<filename>
    const attachmentPath = req.file.filename;

    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("AttachmentPath", sql.NVarChar(500), attachmentPath)
      .query(`
        UPDATE dbo.Quarter_Applications
        SET AttachmentPath = @AttachmentPath, UpdatedAt = GETDATE()
        WHERE Id = @Id;
        SELECT @@ROWCOUNT AS Affected
      `);

    const affected = result.recordset[0]?.Affected ?? 0;
    if (!affected) return res.status(404).json({ error: "Application not found" });

    return res.json({ ok: true, filename: attachmentPath });
  } catch (err) {
    console.error("Upload attachment error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
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
    const publicationResult = await pool.request().query(`
  SELECT TOP 1
    PublishID,
    From_Date,
    To_Date,
    Current_State
  FROM dbo.Publish
  ORDER BY PublishID DESC
`);

    const publication = publicationResult.recordset[0];

    if (!publication) {
      return res.status(400).json({
        error: "Application portal is currently closed."
      });
    }

    if (publication.Current_State !== "Published") {
      return res.status(400).json({
        error: "Application portal is currently closed."
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fromDate = new Date(publication.From_Date);
    const toDate = new Date(publication.To_Date);

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(0, 0, 0, 0);

    if (today < fromDate || today > toDate) {
      return res.status(400).json({
        error: "Application period has ended."
      });
    }
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
          [DateOfJoining] AS DOJ,
          [Caste]
        FROM dbo.UserDetails
        WHERE UserId = @UserId
      `);

    const emp = empResult.recordset[0];
    if (!emp) {
      console.error(`Employee not found for UserId: ${userId}`);
      return res.status(404).json({ error: "Employee record not found. Please contact administrator." });
    }

    // ── Resolve caste from UserDetails directly ──────────────────────────────────
    let casteValue = emp.Caste || "GENERAL";
    // ────────────────────────────────────────────────────────────────────────

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
      .input("Caste", sql.NVarChar(100), casteValue)
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
      qa.[Id] AS id,
      qa.[AppNo] AS appNo,
      qa.[EmpId] AS empId,
      qa.[EmpName] AS empName,
      qa.[Class] AS class,
      CONVERT(varchar(10), ud.GradDate, 23) AS gradDate,
      CONVERT(varchar(10), ud.DateOfJoining, 23) AS dateOfJoin,
      '' AS basic,
      CONVERT(varchar(10), ud.DateOfBirth, 23) AS dob,
      '' AS dept,
      qa.[Caste] AS casteId,
      '' AS currentQtr,
      (
        SELECT TOP 1 qa2.[QtrType]
        FROM dbo.Quarter_Applications qa2
        WHERE qa2.[UserId] = qa.[UserId]
          AND LOWER(qa2.[Status]) = 'approved'
        ORDER BY qa2.[Id] DESC
      ) AS currentQtyType,
      qa.[QtrRequested] AS reqQtr,
      qa.[QtrLocation] AS reqQtrLocation,
      qa.[QtrType] AS reqQtrType,
      qa.[ExchangeReason] AS exchange,
      qa.[AttachmentPath] AS proofFile,
      CONVERT(varchar(10), qa.[ReqDate], 23) AS reqDate,
      '' AS rosterNo,
      qa.[Status] AS result
    FROM dbo.Quarter_Applications qa
    LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
    ORDER BY qa.[Id] DESC
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

  const { status } = parsed.data;
  const pool = await getPool();

  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .input("Status", sql.NVarChar(24), status)
    .query(
      "UPDATE Quarter_Applications SET Status=@Status, UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id; SELECT @@ROWCOUNT AS Affected"
    );

  const affected = result.recordset[0]?.Affected ?? 0;
  if (!affected) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
});

module.exports = router;
