const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sendQuarterApprovalEmail, sendCircularEmail } = require("../Mailer");


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

const committeeUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx"];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and Word documents are allowed"));
    }
  },
});

async function ensureQuarterApplicationPublishColumns(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Quarter_Applications', 'PublishedDateFrom') IS NULL
    BEGIN
      ALTER TABLE dbo.Quarter_Applications
      ADD PublishedDateFrom DATE NULL;
    END;

    IF COL_LENGTH('dbo.Quarter_Applications', 'PublishedDateTo') IS NULL
    BEGIN
      ALTER TABLE dbo.Quarter_Applications
      ADD PublishedDateTo DATE NULL;
    END;
  `);
}

async function ensureQuarterApplicationRosterColumn(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Quarter_Applications', 'RosterNo') IS NULL
    BEGIN
      ALTER TABLE dbo.Quarter_Applications
      ADD RosterNo INT NULL;
    END;
  `);
}

async function ensureQuarterApplicationPriorityColumn(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Quarter_Applications', 'PriorityNo') IS NULL
    BEGIN
      ALTER TABLE dbo.Quarter_Applications
      ADD PriorityNo INT NULL;
    END;
  `);
}

function normalizeText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function getClassPriorityRank(value) {
  const normalized = normalizeText(value);

  if (/^(CLASS\s*)?I(\s|$)/.test(normalized) || normalized === "1" || normalized === "CLASS 1") {
    return 1;
  }
  if (/^(CLASS\s*)?II(\s|$)/.test(normalized) || normalized === "2" || normalized === "CLASS 2") {
    return 2;
  }
  if (/^(CLASS\s*)?III(\s|$)/.test(normalized) || normalized === "3" || normalized === "CLASS 3") {
    return 3;
  }
  if (/^(CLASS\s*)?IV(\s|$)/.test(normalized) || normalized === "4" || normalized === "CLASS 4") {
    return 4;
  }

  return 99;
}

function getCastePriorityRank(value) {
  const normalized = normalizeText(value);
  if (normalized === "SC" || /\bSC\b/.test(normalized)) return 1;
  if (normalized === "ST" || /\bST\b/.test(normalized)) return 2;
  return 3;
}

function toTimeOrNull(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function compareNullableNumber(a, b) {
  const aMissing = a == null;
  const bMissing = b == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return a - b;
}

async function rebuildQuarterApplicationPriorityNumbers(db) {
  const result = await db.request().query(`
    SELECT
      qa.[Id],
      qa.[Class],
      qa.[Caste],
      qa.[ReqDate],
      qa.[CreatedAt],
      ud.[GradDate],
      ud.[DateOfJoining],
      ud.[DateOfBirth]
    FROM dbo.Quarter_Applications qa WITH (UPDLOCK, HOLDLOCK)
    LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
    ORDER BY qa.[Id] ASC
  `);

  const ranked = [...(result.recordset || [])].sort((a, b) => {
    const classDiff = getClassPriorityRank(a.Class) - getClassPriorityRank(b.Class);
    if (classDiff !== 0) return classDiff;

    const gradDiff = compareNullableNumber(toTimeOrNull(a.GradDate), toTimeOrNull(b.GradDate));
    if (gradDiff !== 0) return gradDiff;

    const dojDiff = compareNullableNumber(toTimeOrNull(a.DateOfJoining), toTimeOrNull(b.DateOfJoining));
    if (dojDiff !== 0) return dojDiff;

    const casteDiff = getCastePriorityRank(a.Caste) - getCastePriorityRank(b.Caste);
    if (casteDiff !== 0) return casteDiff;

    const dobDiff = compareNullableNumber(toTimeOrNull(a.DateOfBirth), toTimeOrNull(b.DateOfBirth));
    if (dobDiff !== 0) return dobDiff;

    const reqDiff = compareNullableNumber(toTimeOrNull(a.ReqDate), toTimeOrNull(b.ReqDate));
    if (reqDiff !== 0) return reqDiff;

    const createdDiff = compareNullableNumber(toTimeOrNull(a.CreatedAt), toTimeOrNull(b.CreatedAt));
    if (createdDiff !== 0) return createdDiff;

    return Number(a.Id) - Number(b.Id);
  });

  for (let i = 0; i < ranked.length; i += 1) {
    // Keep the update focused on the ranking column so timestamps remain meaningful.
    // eslint-disable-next-line no-await-in-loop
    await db.request()
      .input("Id", sql.Int, ranked[i].Id)
      .input("PriorityNo", sql.Int, i + 1)
      .query(`
        UPDATE dbo.Quarter_Applications
        SET PriorityNo = @PriorityNo
        WHERE Id = @Id
      `);
  }

  return ranked.length;
}

function isRosterCasteEligible(caste, quarterType, rosterNo) {
  const casteNorm = normalizeText(caste);

  const quarterNorm = normalizeText(quarterType);
  const roster = Number(rosterNo);
  if (!Number.isInteger(roster) || roster < 1 || roster > 60) {
    return { allowed: false, message: "Invalid roster number." };
  }

  if (!casteNorm) {
    return { allowed: false, message: "Employee caste is required to validate roster eligibility." };
  }

  const aLike = new Set(["A TYPE", "B TYPE", "B TYPE IIIR"]);
  const cLike = new Set(["C TYPE", "C TYPE MODIFIED", "D TYPE"]);

  if (aLike.has(quarterNorm)) {
    if ([10, 20, 40, 50].includes(roster)) {
      return casteNorm === "SC"
        ? { allowed: true }
        : { allowed: false, message: "This roster is reserved for SC applicants." };
    }
    if ([30, 60].includes(roster)) {
      return casteNorm === "ST"
        ? { allowed: true }
        : { allowed: false, message: "This roster is reserved for ST applicants." };
    }
    return { allowed: true };
  }

  if (cLike.has(quarterNorm)) {
    if ([20, 40].includes(roster)) {
      return casteNorm === "SC"
        ? { allowed: true }
        : { allowed: false, message: "This roster is reserved for SC applicants." };
    }
    if (roster === 60) {
      return casteNorm === "ST"
        ? { allowed: true }
        : { allowed: false, message: "This roster is reserved for ST applicants." };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

async function ensureHistoryOfAllotmentTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.HistoryofAllotment', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.HistoryofAllotment (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        committeeHeld DATE NOT NULL,
        downloadLink NVARCHAR(500) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END;

    IF COL_LENGTH('dbo.HistoryofAllotment', 'committeeHeld') IS NULL
    BEGIN
      ALTER TABLE dbo.HistoryofAllotment
      ADD committeeHeld DATE NULL;
    END;

    IF COL_LENGTH('dbo.HistoryofAllotment', 'downloadLink') IS NULL
    BEGIN
      ALTER TABLE dbo.HistoryofAllotment
      ADD downloadLink NVARCHAR(500) NULL;
    END;
  `);
}



router.use(requireAuth);
router.use(requireRole("admin", "employee"));


router.get("/applications", async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(
    "SELECT a.Id, a.Status, a.Notes, a.CreatedAt, a.UpdatedAt, a.PublishedDateFrom, a.PublishedDateTo, u.Username, u.Role, q.QuarterNo, q.QuarterType, q.Location FROM dbo.Quarter_Applications a JOIN dbo.Users u ON u.Id=a.UserId LEFT JOIN dbo.Quarters q ON q.Id=a.QuarterId ORDER BY a.Id DESC"
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
        qa.[PublishedDateFrom],
        qa.[PublishedDateTo],
        ud.[Basic] AS Basic,
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
          qa.[PublishedDateFrom],
          qa.[PublishedDateTo],
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
    await ensureQuarterApplicationPublishColumns(pool);
    await ensureQuarterApplicationRosterColumn(pool);
    await ensureQuarterApplicationPriorityColumn(pool);
    const empResult = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT
          [EmployeeId]   AS EmpId,
          [EmployeeName] AS EmpName,
          [EmpClass]    AS Class,
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

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const rosterRequest = new sql.Request(tx);
      const rosterLookup = await rosterRequest
        .input("QtrRequested", sql.NVarChar(64), qtr.QuarterNo || null)
        .query(`
          DECLARE @RosterNo INT;

          SELECT @RosterNo = (COUNT(*) % 60) + 1
          FROM dbo.Quarter_Applications WITH (UPDLOCK, HOLDLOCK)
          WHERE QtrRequested = @QtrRequested;

          SELECT @RosterNo AS RosterNo;
        `);

      const rosterNo = Number(rosterLookup.recordset[0]?.RosterNo || 1);

      const rosterEligibility = isRosterCasteEligible(casteValue, qtr.QuarterType, rosterNo);
      if (!rosterEligibility.allowed) {
        const rosterErr = new Error(rosterEligibility.message || "You cannot apply for this quarter at the current roster number.");
        rosterErr.statusCode = 400;
        throw rosterErr;
      }

      const insertRequest = new sql.Request(tx);
      const result = await insertRequest
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
        .input("PublishedDateFrom", sql.Date, publication.From_Date)
        .input("PublishedDateTo", sql.Date, publication.To_Date)
        .input("RosterNo", sql.Int, rosterNo)
        .input("Reason", sql.NVarChar(100), reason)
        .input("ExchangeReason", sql.NVarChar(400), exchangeReason)
        .query(`
          INSERT INTO dbo.Quarter_Applications (
            AppNo, UserId, EmpId, EmpName, Class, Caste,
            AllotCatId, EmailId, ReqDate, QtrRequested,
            QtrLocation, QtrType, PublishedDateFrom, PublishedDateTo,
            RosterNo, Reason, ExchangeReason, Status, CreatedAt, UpdatedAt
          )
          OUTPUT INSERTED.Id, INSERTED.AppNo, INSERTED.RosterNo
          VALUES (
            @AppNo, @UserId, @EmpId, @EmpName, @Class, @Caste,
            @AllotCatId, @EmailId, GETDATE(), @QtrRequested,
            @QtrLocation, @QtrType, @PublishedDateFrom, @PublishedDateTo,
          @RosterNo, @Reason, @ExchangeReason, 'pending', GETDATE(), GETDATE()
          )
        `);

      await rebuildQuarterApplicationPriorityNumbers(tx);

      await tx.commit();

      const inserted = result.recordset[0];
      return res.status(201).json({
        id: inserted?.Id,
        appNo: inserted?.AppNo,
        rosterNo: inserted?.RosterNo,
        publishedDateFrom: publication.From_Date,
        publishedDateTo: publication.To_Date,
      });
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch (rollbackErr) {
        console.error("Rollback error:", rollbackErr);
      }
      throw txErr;
    }
  } catch (err) {
    const statusCode = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return res.status(statusCode).json({
      error: err?.message || "Internal server error",
    });
  }
});

router.get("/status-of-applications", async (req, res) => {
  const pool = await getPool();
  await ensureQuarterApplicationPriorityColumn(pool);
  await rebuildQuarterApplicationPriorityNumbers(pool);
  const result = await pool.request().query(`
    SELECT
      qa.[PriorityNo] AS priorityNo,
      qa.[Id] AS id,
      qa.[UserId] AS userId,
      qa.[AppNo] AS appNo,
      qa.[EmpId] AS empId,
      qa.[EmpName] AS empName,
      qa.[Class] AS class,
      CONVERT(varchar(10), ud.GradDate, 23) AS gradDate,
      CONVERT(varchar(10), ud.DateOfJoining, 23) AS dateOfJoin,
      ud.[Basic] AS basic,
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
      qa.[PublishedDateFrom] AS publishedDateFrom,
      qa.[PublishedDateTo] AS publishedDateTo,
      qa.[ExchangeReason] AS exchange,
      qa.[AttachmentPath] AS proofFile,
      CONVERT(varchar(10), qa.[ReqDate], 23) AS reqDate,
      qa.[RosterNo] AS rosterNo,
      qa.[Status] AS result
    FROM dbo.Quarter_Applications qa
    LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
    ORDER BY qa.[Id] DESC
  `);
  return res.json({ items: result.recordset });
});

async function ensureUserDetailsDebarredColumns(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.UserDetails', 'DebarredFromDate') IS NULL
    BEGIN
      ALTER TABLE dbo.UserDetails
      ADD DebarredFromDate DATE NULL;
    END;

    IF COL_LENGTH('dbo.UserDetails', 'DebarredToDate') IS NULL
    BEGIN
      ALTER TABLE dbo.UserDetails
      ADD DebarredToDate DATE NULL;
    END;
  `);
}

router.post("/debar-user", async (req, res) => {
  try {
    const { userId, fromDate, toDate } = req.body;
    if (!userId || !fromDate || !toDate) {
      return res.status(400).json({ error: "userId, fromDate, and toDate are required." });
    }

    const pool = await getPool();
    await ensureUserDetailsDebarredColumns(pool);

    await pool.request()
      .input("UserId", sql.Int, userId)
      .input("FromDate", sql.Date, fromDate)
      .input("ToDate", sql.Date, toDate)
      .query(`
        UPDATE dbo.UserDetails
        SET DebarredFromDate = @FromDate, DebarredToDate = @ToDate
        WHERE UserId = @UserId
      `);

    return res.json({ success: true, message: "User has been debarred successfully." });
  } catch (err) {
    console.error("debar-user error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/house-allotment-committee-history", async (req, res) => {
  try {
    const pool = await getPool();
    await ensureHistoryOfAllotmentTable(pool);

    const result = await pool.request().query(`
      SELECT
        Id,
        CONVERT(varchar(10), committeeHeld, 23) AS committeeHeld,
        downloadLink
      FROM dbo.HistoryofAllotment
      ORDER BY committeeHeld DESC, Id DESC
    `);

    return res.json({ items: result.recordset });
  } catch (err) {
    console.error("house-allotment-committee-history error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const HistoryCommitteeSchema = z.object({
  committeeHeld: z.string().min(1, "committeeHeld is required"),
});

router.post("/house-allotment-committee-history", committeeUpload.single("file"), async (req, res) => {
  try {
    const parsed = HistoryCommitteeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "committeeHeld is required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const pool = await getPool();
    await ensureHistoryOfAllotmentTable(pool);

    const result = await pool
      .request()
      .input("committeeHeld", sql.Date, parsed.data.committeeHeld)
      .input("downloadLink", sql.NVarChar(500), req.file.filename)
      .query(`
        INSERT INTO dbo.HistoryofAllotment (committeeHeld, downloadLink)
        OUTPUT INSERTED.Id, INSERTED.committeeHeld, INSERTED.downloadLink
        VALUES (@committeeHeld, @downloadLink)
      `);

    const inserted = result.recordset[0];
    return res.status(201).json({
      id: inserted?.Id,
      committeeHeld: inserted?.committeeHeld,
      downloadLink: inserted?.downloadLink,
    });
  } catch (err) {
    console.error("house-allotment-committee-history upload error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

router.post("/publish", upload.any(), async (req, res) => {
  try {
    // Find the circular file if it exists
    const file = req.files && req.files.find(f => f.fieldname === "circular");
    if (file) req.file = file;

    const { fromDate, toDate } = req.body;

    // Validate required fields
    if (!fromDate || !toDate) {
      return res.status(400).json({
        error: "Both From Date and To Date are required."
      });
    }

    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);

    const to = new Date(toDate);
    to.setHours(0, 0, 0, 0);

    // Validation: From Date cannot be in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
      SELECT TOP 1 Current_State
      FROM dbo.Publish
      ORDER BY PublishID DESC
    `);

    if (existingPublication.recordset.length > 0 && existingPublication.recordset[0].Current_State === 'Published') {
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

    if (req.file) {
      try {
        const emailsResult = await pool.request().query(`
          SELECT EmailAddress FROM dbo.TestEmails
        `);
        const emails = emailsResult.recordset.map((row) => row.EmailAddress).filter(Boolean);
        
        if (emails.length > 0) {
          await sendCircularEmail(emails, req.file, fromDate, toDate);
        }
        
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Failed to delete temp circular file:", err);
        });
      } catch (emailErr) {
        console.error("Failed to send circular emails:", emailErr);
      }
    }

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
router.delete("/applications/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = await getPool();
    const current = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT TOP 1
          qa.[Id],
          qa.[UserId],
          qa.[Status]
        FROM dbo.Quarter_Applications qa
        WHERE qa.[Id] = @Id
      `);

    const row = current.recordset[0];
    if (!row) return res.status(404).json({ error: "Not found" });

    const userId = Number(req.user.sub);
    const isAdmin = String(req.user.role || "").toLowerCase() === "admin";
    if (!isAdmin && Number(row.UserId) !== userId) {
      return res.status(403).json({ error: "You can only delete your own application" });
    }

    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`
        DELETE FROM dbo.Quarter_Applications
        WHERE Id = @Id;
        SELECT @@ROWCOUNT AS Affected;
      `);

    const affected = result.recordset[0]?.Affected ?? 0;
    if (!affected) return res.status(404).json({ error: "Not found" });

    await ensureQuarterApplicationPriorityColumn(pool);
    await rebuildQuarterApplicationPriorityNumbers(pool);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete application error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/applications/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });


  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const { status } = parsed.data;
  const pool = await getPool();

  const existing = await pool
    .request()
    .input("Id", sql.Int, id)
    .query(`
      SELECT TOP 1
        qa.[Id],
        qa.[AppNo],
        qa.[UserId],
        qa.[EmpId],
        qa.[EmpName],
        qa.[EmailId],
        qa.[QtrRequested],
        qa.[QtrLocation],
        qa.[QtrType],
        qa.[ReqDate],
        qa.[Status],
        ud.[Email] AS UserEmail
      FROM dbo.Quarter_Applications qa
      LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
      WHERE qa.[Id] = @Id
    `);

  const current = existing.recordset[0];
  if (!current) return res.status(404).json({ error: "Not found" });

  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .input("Status", sql.NVarChar(24), status)
    .query(
      "UPDATE Quarter_Applications SET Status=@Status, UpdatedAt=SYSUTCDATETIME() WHERE Id=@Id; SELECT @@ROWCOUNT AS Affected"
    );

  const affected = result.recordset[0]?.Affected ?? 0;
  if (!affected) return res.status(404).json({ error: "Not found" });

  if (String(status).toLowerCase() === "approved" && String(current.Status || "").toLowerCase() !== "approved") {
    sendQuarterApprovalEmail({
      ...current,
      Status: status,
    }).catch((err) => {
      console.error(`Quarter approval email failed for application ${id}:`, err);
    });
  }

  return res.json({ ok: true });
});

module.exports = router;
