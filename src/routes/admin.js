const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const { z } = require("zod");
const { getPool, sql } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sendQuarterApprovalEmail, sendCircularEmail, sendCircularEmailWithBuffer } = require("../Mailer");


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

async function ensureQuarterApplicationDepartmentColumn(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Quarter_Applications', 'Department') IS NULL
    BEGIN
      ALTER TABLE dbo.Quarter_Applications
      ADD Department NVARCHAR(200) NULL;
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
    await ensureQuarterApplicationDepartmentColumn(pool);
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
        qa.[Department],
        qa.[AttachmentPath],
        qa.[Status],
        qa.[PublishedDateFrom],
        qa.[PublishedDateTo],
        ud.[Basic] AS Basic,
        CONVERT(varchar(10), ud.DateOfJoining, 23) AS DateOfJoining,
        CONVERT(varchar(10), ud.GradDate, 23) AS GradDate,
        CONVERT(varchar(10), ud.DateOfBirth, 23) AS DateOfBirth,
        ud.[area_type] AS CurrentAreaType,
        ud.[Quarter_no] AS CurrentQuarterNo,
        ud.[Category] AS CurrentQuarterType,
        CONVERT(varchar(19), qa.[CreatedAt], 120)  AS CreatedAt,
        CONVERT(varchar(19), qa.[UpdatedAt], 120)  AS UpdatedAt
      FROM dbo.Quarter_Applications qa
      LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
      ORDER BY qa.[Id] DESC
    `);
    const getClassRank = (cls) => {
      const norm = String(cls || "").toUpperCase().trim().replace(/[\s_-]+/g, "");
      // Check SR/JR first (most specific)
      if (norm.includes("SRCLASSI") || norm.includes("SRCLASS1")) return 1;
      if (norm.includes("JRCLASSI") || norm.includes("JRCLASS1")) return 2;
      // Check longer class names BEFORE shorter ones to avoid substring false matches:
      // e.g. "CLASSIII".includes("CLASSII") is TRUE — so CLASS-IV and CLASS-III must come first
      if (norm.includes("CLASSIV") || norm === "CLASS4" || norm === "4") return 5;
      if (norm.includes("CLASSIII") || norm === "CLASS3" || norm === "3") return 4;
      if (norm.includes("CLASSII") || norm === "CLASS2" || norm === "2") return 3;
      if (norm.includes("CLASSI") || norm === "CLASS1" || norm === "1") return 1.5;
      return 99;
    };

    // ── Verify Quarter Application: sort DIRECTLY by seniority only ──────────
    // No grouping by quarter number here. The admin sees all pending applications
    // ranked purely by class priority → grad date → DOJ → basic pay → DOB → request date.
    const sortedItems = [...(result.recordset || [])].sort((a, b) => {
      // 1. Class Priority (SR-CLASS-I → JR-CLASS-I → CLASS-II → CLASS-III → CLASS-IV)
      const rankA = getClassRank(a.Class);
      const rankB = getClassRank(b.Class);
      if (rankA !== rankB) return rankA - rankB;

      // 2. Graduation Date (earlier first)
      const gradA = toTimeOrNull(a.GradDate);
      const gradB = toTimeOrNull(b.GradDate);
      const gradDiff = compareNullableNumber(gradA, gradB);
      if (gradDiff !== 0) return gradDiff;

      // 3. Date of Joining (earlier first)
      const dojA = toTimeOrNull(a.DateOfJoining);
      const dojB = toTimeOrNull(b.DateOfJoining);
      const dojDiff = compareNullableNumber(dojA, dojB);
      if (dojDiff !== 0) return dojDiff;

      // 4. Basic Pay (higher first)
      const basicA = Number(a.Basic || 0);
      const basicB = Number(b.Basic || 0);
      if (basicA !== basicB) return basicB - basicA;

      // 5. Date of Birth (earlier/older first)
      const dobA = toTimeOrNull(a.DateOfBirth);
      const dobB = toTimeOrNull(b.DateOfBirth);
      const dobDiff = compareNullableNumber(dobA, dobB);
      if (dobDiff !== 0) return dobDiff;

      // 6. Request Date (earlier first)
      const reqA = toTimeOrNull(a.ReqDate);
      const reqB = toTimeOrNull(b.ReqDate);
      const reqDiff = compareNullableNumber(reqA, reqB);
      if (reqDiff !== 0) return reqDiff;

      // 7. ID Fallback
      return Number(a.Id) - Number(b.Id);
    });

    return res.json({ items: sortedItems });
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
      quarterNo = null,
      quarterType = null,
      location = null,
      department = null,
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
    await ensureQuarterApplicationDepartmentColumn(pool);
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

    let qtr = {};
    if (quarterNo && quarterType && location) {
      qtr = {
        QuarterNo: String(quarterNo),
        QuarterType: String(quarterType),
        Location: String(location)
      };
    } else {
      const qtrResult = await pool
        .request()
        .input("QuarterId", sql.Int, parseInt(quarterId))
        .query(`
          SELECT
            CAST([QUARTER NUMBER] AS NVARCHAR(64)) AS QuarterNo,
            CAST(CATEGORY         AS NVARCHAR(64)) AS QuarterType,
            CAST(AREA_TYPE        AS NVARCHAR(64)) AS Location
          FROM dbo.[Estate_Quarters]
          WHERE OBJECTID = @QuarterId
        `);
      qtr = qtrResult.recordset[0] || {};
    }


    const appNo = "APP-" + Date.now();

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      let rosterNo = null;

      if (reason !== "exchange") {
        const rosterRequest = new sql.Request(tx);
        const rosterLookup = await rosterRequest
          .input("QtrRequested", sql.NVarChar(64), qtr.QuarterNo || null)
          .query(`
            DECLARE @RosterNo INT;

            SELECT @RosterNo = (COUNT(*) % 60) + 1
            FROM dbo.Quarter_Applications WITH (UPDLOCK, HOLDLOCK)
            WHERE QtrRequested = @QtrRequested AND ISNULL(Reason, '') != 'exchange';

            SELECT @RosterNo AS RosterNo;
          `);

        rosterNo = Number(rosterLookup.recordset[0]?.RosterNo || 1);
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
        .input("Department", sql.NVarChar(200), department)
        .query(`
          INSERT INTO dbo.Quarter_Applications (
            AppNo, UserId, EmpId, EmpName, Class, Caste,
            AllotCatId, EmailId, ReqDate, QtrRequested,
            QtrLocation, QtrType, PublishedDateFrom, PublishedDateTo,
            RosterNo, Reason, ExchangeReason, Department, Status, CreatedAt, UpdatedAt
          )
          OUTPUT INSERTED.Id, INSERTED.AppNo, INSERTED.RosterNo
          VALUES (
            @AppNo, @UserId, @EmpId, @EmpName, @Class, @Caste,
            @AllotCatId, @EmailId, GETDATE(), @QtrRequested,
            @QtrLocation, @QtrType, @PublishedDateFrom, @PublishedDateTo,
            @RosterNo, @Reason, @ExchangeReason, @Department, 'pending', GETDATE(), GETDATE()
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
  try {
    const pool = await getPool();
    await ensureQuarterApplicationDepartmentColumn(pool);

    // ── Step 1: Get the currently active publication ───────────────────────
    let activePub = null;
    try {
      const pubResult = await pool.request().query(`
        SELECT TOP 1
          CONVERT(varchar(10), From_Date, 23) AS From_Date,
          CONVERT(varchar(10), To_Date,   23) AS To_Date
        FROM dbo.Publish
        WHERE Current_State = 'Published'
        ORDER BY PublishID DESC
      `);
      activePub = pubResult.recordset[0] || null;
    } catch (_) {
      // Publish table may not exist yet — return empty
    }

    if (activePub) {
      // ── Step 2: Fetch ALL applications for this active publication period ─────────
      const fetchResult = await pool
        .request()
        .input("PubFrom", sql.VarChar(10), activePub.From_Date)
        .input("PubTo",   sql.VarChar(10), activePub.To_Date)
        .query(`
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
            qa.[Department],
            qa.[Status],
            qa.[PublishedDateFrom],
            qa.[PublishedDateTo],
            ud.[Basic]                                 AS Basic,
            CONVERT(varchar(10), ud.DateOfJoining, 23) AS DateOfJoining,
            CONVERT(varchar(10), ud.GradDate, 23)      AS GradDate,
            CONVERT(varchar(10), ud.DateOfBirth, 23)   AS DateOfBirth,
            ud.[area_type]                             AS CurrentAreaType,
            ud.[Quarter_no]                            AS CurrentQuarterNo,
            ud.[Category]                              AS CurrentQuarterType,
            ''                                         AS RosterNo
          FROM dbo.Quarter_Applications qa
          LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
          WHERE
            CONVERT(varchar(10), qa.PublishedDateFrom, 23) = @PubFrom
            AND CONVERT(varchar(10), qa.PublishedDateTo, 23) = @PubTo
          ORDER BY qa.[Id] ASC
        `);

      const allApps = fetchResult.recordset || [];

      // ── Step 3: Separate pending vs already-approved ───────────────────────
      const pendingApps  = allApps.filter(r => (r.Status || "").toLowerCase() === "pending");
      const approvedApps = allApps.filter(r => (r.Status || "").toLowerCase() === "approved");

      // Track UserId of everyone already approved in this publication period
      const approvedUserIds = new Set(approvedApps.map(r => r.UserId));

      // Track Quarters that ALREADY have a winner, so we don't assign multiple winners
      const approvedQuarters = new Set(approvedApps.map(app => {
        return [
          String(app.QtrType      || "").trim().toLowerCase(),
          String(app.QtrLocation  || "").trim().toLowerCase(),
          String(app.QtrRequested || "").trim().toLowerCase(),
        ].join("|||");
      }));

      // ── Step 4: Group PENDING apps by (QtrType + QtrLocation + QtrRequested) ─
      const groups = {};
      for (const app of pendingApps) {
        const key = [
          String(app.QtrType      || "").trim().toLowerCase(),
          String(app.QtrLocation  || "").trim().toLowerCase(),
          String(app.QtrRequested || "").trim().toLowerCase(),
        ].join("|||");
        if (!groups[key]) groups[key] = [];
        groups[key].push(app);
      }

      // ── Step 5: Sort each group by seniority ──────────────────────────────
      const getClassRankSt = (cls) => {
        const norm = String(cls || "").toUpperCase().trim().replace(/[\s_-]+/g, "");
        if (norm.includes("SRCLASSI") || norm.includes("SRCLASS1")) return 1;
        if (norm.includes("JRCLASSI") || norm.includes("JRCLASS1")) return 2;
        if (norm.includes("CLASSIV")  || norm === "CLASS4" || norm === "4") return 5;
        if (norm.includes("CLASSIII") || norm === "CLASS3" || norm === "3") return 4;
        if (norm.includes("CLASSII")  || norm === "CLASS2" || norm === "2") return 3;
        if (norm.includes("CLASSI")   || norm === "CLASS1" || norm === "1") return 1.5;
        return 99;
      };

      const senioritySorter = (a, b) => {
        const rankA = getClassRankSt(a.Class);
        const rankB = getClassRankSt(b.Class);
        if (rankA !== rankB) return rankA - rankB;

        const gradDiff = compareNullableNumber(toTimeOrNull(a.GradDate), toTimeOrNull(b.GradDate));
        if (gradDiff !== 0) return gradDiff;

        const dojDiff = compareNullableNumber(toTimeOrNull(a.DateOfJoining), toTimeOrNull(b.DateOfJoining));
        if (dojDiff !== 0) return dojDiff;

        const basicA = Number(a.Basic || 0);
        const basicB = Number(b.Basic || 0);
        if (basicA !== basicB) return basicB - basicA;

        const dobDiff = compareNullableNumber(toTimeOrNull(a.DateOfBirth), toTimeOrNull(b.DateOfBirth));
        if (dobDiff !== 0) return dobDiff;

        const reqDiff = compareNullableNumber(toTimeOrNull(a.ReqDate), toTimeOrNull(b.ReqDate));
        if (reqDiff !== 0) return reqDiff;

        return Number(a.Id) - Number(b.Id);
      };

      for (const key of Object.keys(groups)) {
        groups[key].sort(senioritySorter);
      }

      // ── Step 6: Greedy winner selection ─────────────────────
      const newWinners = [];
      for (const key of Object.keys(groups).sort()) {
        if (approvedQuarters.has(key)) continue;

        const group = groups[key];
        const winner = group.find(app => !approvedUserIds.has(app.UserId));
        if (winner) {
          newWinners.push(winner);
          approvedUserIds.add(winner.UserId);
          approvedQuarters.add(key);
        }
      }

      // ── Step 7: Batch-update new winners to 'approved' in the DB ──────────
      for (const winner of newWinners) {
        await pool
          .request()
          .input("WinnerId", sql.Int, winner.Id)
          .query(`
            UPDATE dbo.Quarter_Applications
            SET    Status    = 'approved',
                   UpdatedAt = SYSUTCDATETIME()
            WHERE  Id     = @WinnerId
              AND  Status = 'pending'
          `);
      }
    }

    // ── Step 8: Fetch ALL approved applications (current & historical) ─────────────────────
    const allApprovedResult = await pool.request().query(`
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
        qa.[Department],
        qa.[Status],
        qa.[PublishedDateFrom],
        qa.[PublishedDateTo],
        ud.[Basic]                                 AS Basic,
        CONVERT(varchar(10), ud.DateOfJoining, 23) AS DateOfJoining,
        CONVERT(varchar(10), ud.GradDate, 23)      AS GradDate,
        CONVERT(varchar(10), ud.DateOfBirth, 23)   AS DateOfBirth,
        ud.[area_type]                             AS CurrentAreaType,
        ud.[Quarter_no]                            AS CurrentQuarterNo,
        ud.[Category]                              AS CurrentQuarterType,
        ''                                         AS RosterNo
      FROM dbo.Quarter_Applications qa
      LEFT JOIN dbo.UserDetails ud ON ud.UserId = qa.UserId
      WHERE qa.[Status] = 'approved'
      ORDER BY qa.[Id] DESC
    `);

    const allApprovedApps = allApprovedResult.recordset || [];

    // ── Step 9: Map to frontend keys ───────────────────────────────────────
    const items = allApprovedApps.map(r => ({
      id:                r.Id,
      userId:            r.UserId,
      appNo:             r.AppNo,
      empId:             r.EmpId,
      empName:           r.EmpName,
      class:             r.Class,
      gradDate:          r.GradDate,
      dept:              r.Department,
      casteId:           r.Caste,
      currentAreaType:   r.CurrentAreaType,
      currentQuarterNo:  r.CurrentQuarterNo,
      currentQtyType:    r.CurrentQuarterType,
      reqQtr:            r.QtrRequested,
      reqQtrLocation:    r.QtrLocation,
      reqQtrType:        r.QtrType,
      exchange:          r.ExchangeReason,
      rosterNo:          r.RosterNo,
      result:            r.Status || "approved",
      emailId:           r.EmailId,
      basic:             r.Basic,
      dateOfJoin:        r.DateOfJoining,
      reqDate:           r.ReqDate,
      reason:            r.Reason,
      publishedDateFrom: r.PublishedDateFrom,
      publishedDateTo:   r.PublishedDateTo,
    }));

    return res.json({ items });
  } catch (err) {
    console.error("status-of-applications error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
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

router.delete("/house-allotment-committee-history/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }
    const pool = await getPool();
    await pool.request().input("id", sql.Int, id).query(`
      DELETE FROM dbo.HistoryofAllotment WHERE Id = @id
    `);
    return res.json({ message: "Record deleted successfully" });
  } catch (err) {
    console.error("house-allotment-committee-history delete error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

async function ensurePublishQuarterTypesColumn(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Publish', 'QuarterTypes') IS NULL
    BEGIN
      ALTER TABLE dbo.Publish ADD QuarterTypes NVARCHAR(MAX) NULL;
    END;
  `);
}

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

    await ensurePublishQuarterTypesColumn(pool);

    // Parse published quarter types (sent as JSON string from FormData)
    let quarterTypesStr = null;
    const rawQTypes = req.body.quarterTypes;
    if (rawQTypes) {
      try {
        const parsed = Array.isArray(rawQTypes) ? rawQTypes : JSON.parse(rawQTypes);
        quarterTypesStr = parsed.filter(Boolean).join(",") || null;
      } catch {
        quarterTypesStr = String(rawQTypes).trim() || null;
      }
    }

    // Create new publication
    await pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate)
      .input("quarterTypes", sql.NVarChar(sql.MAX), quarterTypesStr)
      .query(`
        INSERT INTO dbo.Publish
        (
          From_Date,
          To_Date,
          Current_State,
          QuarterTypes
        )
        VALUES
        (
          @fromDate,
          @toDate,
          'Published',
          @quarterTypes
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
    // Build allotment order PDF then send approval email with attachment
    buildAllotmentOrderPDF({
      ...current,
      Status: status,
      IssueDate: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "/"),
    }).then((pdfBuffer) => {
      return sendQuarterApprovalEmail({ ...current, Status: status }, pdfBuffer);
    }).catch((err) => {
      console.error(`Quarter approval email/PDF failed for application ${id}:`, err);
    });
  }

  return res.json({ ok: true });
});

// ── GET /api/admin/quarter-types — distinct categories from Estate_Quarters ────
router.get("/quarter-types", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT DISTINCT LTRIM(RTRIM(CAST(CATEGORY AS NVARCHAR(100)))) AS QuarterType
      FROM dbo.[Estate_Quarters]
      WHERE CATEGORY IS NOT NULL 
        AND LTRIM(RTRIM(CAST(CATEGORY AS NVARCHAR(100)))) <> ''
        AND LTRIM(RTRIM(CAST(CATEGORY AS NVARCHAR(100)))) <> '.'
      ORDER BY QuarterType ASC
    `);
    const types = result.recordset.map((r) => r.QuarterType);
    return res.json({ types });
  } catch (err) {
    console.error("quarter-types error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/admin/area-types — distinct areas by quarter type(s) ──────────────
router.get("/area-types", async (req, res) => {
  const { quarterType, quarterTypes } = req.query;
  const targetTypes = quarterTypes || quarterType;
  if (!targetTypes) return res.status(400).json({ error: "quarterType(s) is required" });
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("QuarterTypes", sql.NVarChar(sql.MAX), targetTypes)
      .query(`
        SELECT DISTINCT LTRIM(RTRIM(CAST(AREA_TYPE AS NVARCHAR(100)))) AS AreaType
        FROM dbo.[Estate_Quarters]
        WHERE CATEGORY IN (SELECT value FROM STRING_SPLIT(@QuarterTypes, ','))
          AND AREA_TYPE IS NOT NULL 
          AND LTRIM(RTRIM(CAST(AREA_TYPE AS NVARCHAR(100)))) <> ''
        ORDER BY AreaType ASC
      `);
    const areas = result.recordset.map((r) => r.AreaType);
    return res.json({ areas });
  } catch (err) {
    console.error("area-types error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/admin/quarter-numbers — distinct numbers by type(s) and area(s) ─────
router.get("/quarter-numbers", async (req, res) => {
  const { quarterType, quarterTypes, areaType, areaTypes } = req.query;
  const targetTypes = quarterTypes || quarterType;
  const targetAreas = areaTypes || areaType;
  if (!targetTypes || !targetAreas) {
    return res.status(400).json({ error: "quarterType(s) and areaType(s) are required" });
  }
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("QuarterTypes", sql.NVarChar(sql.MAX), targetTypes)
      .input("AreaTypes", sql.NVarChar(sql.MAX), targetAreas)
      .query(`
        SELECT DISTINCT LTRIM(RTRIM(CAST([QUARTER NUMBER] AS NVARCHAR(100)))) AS QuarterNo
        FROM dbo.[Estate_Quarters]
        WHERE CATEGORY IN (SELECT value FROM STRING_SPLIT(@QuarterTypes, ','))
          AND AREA_TYPE IN (SELECT value FROM STRING_SPLIT(@AreaTypes, ','))
          AND [QUARTER NUMBER] IS NOT NULL
          AND LTRIM(RTRIM(CAST([QUARTER NUMBER] AS NVARCHAR(100)))) <> ''
        ORDER BY QuarterNo ASC
      `);
    const numbers = result.recordset.map((r) => r.QuarterNo);
    return res.json({ numbers });
  } catch (err) {
    console.error("quarter-numbers error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



// ── Allotment Order PDF ────────────────────────────────────────────
async function buildAllotmentOrderPDF(application) {
  const LOGO_PATH = path.join(__dirname, "..", "..", "..", "LMS-Quaters_Frontend", "src", "assets", "Logo.png");
  const SIG_PATH = path.join(__dirname, "..", "..", "..", "LMS-Quaters_Frontend", "src", "assets", "signature.png");
  const logoExists = fs.existsSync(LOGO_PATH);
  const sigExists = fs.existsSync(SIG_PATH);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const ready = new Promise((res, rej) => { doc.on("end", res); doc.on("error", rej); });

  const empName = application.EmpName || "—";
  const empId = application.EmpId || "—";
  const qtrRequested = application.QtrRequested || "—";
  const qtrType = application.QtrType || "—";
  const appNo = application.AppNo || "—";
  const issueDate = application.IssueDate || new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "/");
  const fileNo = `AD/EST/GENL/QRS/VIII-2/${new Date().getFullYear()}(Pt.)/`;

  const LEFT = 50;
  const W = 495; // A4 width is 595.28 - 100 = 495

  // ── PAGE 1 Header ──────────────────────────────────────────────────────────
  if (logoExists) {
    try { doc.image(LOGO_PATH, doc.page.width / 2 - 20, 25, { width: 40, height: 40 }); } catch (_) { }
  }

  // Start text below logo
  doc.y = 70;

  doc.font("Helvetica-Bold").fontSize(10)
    .text("Paradip Port Authority", { align: "center" })
    .text("ADMINISTRATIVE DEPARTMENT", { align: "center" })
    .text("(ESTATE WING)", { align: "center" });

  doc.moveDown(0.5);

  const lineY1 = doc.y;
  doc.moveTo(LEFT, lineY1).lineTo(LEFT + W, lineY1).strokeColor("#000").lineWidth(0.5).stroke();
  doc.y += 5;

  const fileNoY = doc.y;
  doc.font("Helvetica-Bold").fontSize(10.5)
    .text(`File No.: ${fileNo}`, LEFT, fileNoY, { width: 300, continued: false });
  doc.text(`Dt: ${issueDate}`, LEFT, fileNoY, { align: "right", width: W });

  doc.y += 5;
  const lineY2 = doc.y;
  doc.moveTo(LEFT, lineY2).lineTo(LEFT + W, lineY2).strokeColor("#000").lineWidth(0.5).stroke();
  doc.y += 5;

  doc.font("Helvetica-Bold").fontSize(11.5)
    .text("OFFICE ORDER", LEFT, doc.y, { align: "center", width: W });
  doc.moveDown(0.5);

  // ── Body ─────────────────────────────────────────────────────────────────
  const bodyText =
    `In accordance with the approval of House Allotment Committee held on ${issueDate}, ` +
    `${empName} (${empId}) is hereby allotted with Qrs.No: ${qtrRequested} (${qtrType}) ` +
    `in lieu of Qrs.No: MIIR/123 (B TYPE IIIR) on payment of usual house rent and all other ` +
    `service charges as prescribed from time to time under the following terms and conditions.`;

  // Indent first line like the image
  doc.font("Helvetica").fontSize(11).text(bodyText, LEFT, doc.y, { align: "justify", width: W, lineGap: 3.5, indent: 30 });
  doc.moveDown(0.5);

  const para2 =
    `Occupation and vacation of quarters shall be made in presence of R.I.(Estate) on ` +
    `production of format duly filled in and certified by the respective D.D.O.s within a ` +
    `period of 15 (fifteen) days from the date of issue of this order under intimation to the ` +
    `Sr. Assistant Estate Manager, E.E., P.E.D., E.E., P.H.D. and E.E., R.&B.Divn., Paradip ` +
    `Port Authority and respective D.D.O.s failing which this order will be stand cancelled. ` +
    `The allotment is governed under the Paradip Port Authority Employees (Allotment of Qrs.) Orders, 2010.`;
  doc.font("Helvetica").fontSize(11).text(para2, { align: "justify", width: W, lineGap: 3.5, indent: 30 });
  doc.moveDown(0.5);

  const para3 =
    `They should submit their clearances from E.E. P.E.D., P.H.D & R&B Divn., ppa ` +
    `and vacate their existing quarters by signing in the vacation Register of Estate Wing ` +
    `within a period of 15 (fifteen) days.`;
  doc.font("Helvetica").fontSize(11).text(para3, { align: "justify", width: W, lineGap: 3.5, indent: 30 });
  doc.moveDown(0.8);

  // T&C heading
  doc.font("Helvetica-Bold").fontSize(11.5)
    .text("TERMS AND CONDITIONS FOR CANCELLATION OF\nALLOTMENT/IMPOSITION OF PENAL HOUSE RENT", { align: "center", width: W, lineGap: 2 });
  doc.moveDown(0.5);

  const tcIntro =
    `If the allottee commits any/all of the following acts the allotment of residence ` +
    `made to him/her is liable for cancellation/imposition of penal house rent at the rate ` +
    `of 25% of his/her emoluments for a period of 36 months or both along-with one time ` +
    `penalty of Rs.2,000.00 (Rupees Two Thousand) only.`;
  doc.font("Helvetica").fontSize(11).text(tcIntro, { align: "justify", width: W, lineGap: 3.5, indent: 30 });
  doc.moveDown(0.5);

  // ── Clauses ─────────────────────────────────────────────────────────────────
  const clauses = [
    "Transferring of subletting the entire or a portion of the quarters.",
    "Using the building for a purpose other than residential purpose.",
    "Addition or alteration to structure or loss or damage to fixtures, fittings and construction of any hutments within the premises.",
    "In the event of any act or conduct on the part of the allottee or his family members or dependants or the allottee concerned which act or conduct is a nuisance to the occupant of the neighborhood.",
    "The condition of his/her quarters premises shall be maintained by the allotted in sanitary condition in addition to proper maintenance of the house and hedge and if planted by him at his own cost.",
    "The allottee shall demolish the hutment if any, in his/her name within seven days from the date of taking over possession of the quarters.",
    "Cutting of permanent tree within the campus is strictly prohibited.",
    "If the employees/Officers or any of the family members of the employees/Officers is reported as involved in any criminal activities, the allotment of the quarters will be liable for cancellation.",
    "After issue of quarters allotment order if the employees/officer is not interested to occupy the quarters for any reason he/she should intimate it to the Sr. AEM, ppa within a period of seven days from the date of receipt of allotment order failing which it will construe of his willingness to occupy such quarters. The rent of quarters will be charged accordingly.",
    "The allottee cannot keep cattle/pig(s) in the side of quarters.",
    "Handing over and taking over the Qrs. shall be made within 15 days time from the date of issue of this order or otherwise the allottee shall have to pay the Penal Rent for occupation in both the Qrs.",
    "The allottee should take occupation of the allotted Qrs. within 15 (fifteen) days of allotment, otherwise the allotment will be cancelled automatically.",
    "Action of the allottee, if any, comes to the notice of the Port authority which any way hamper/damage the image and reputation of the Port, shall lead to cancellation of allotted quarter(s).",
    "Unauthenticated news published in any news paper/Print media or circulated if any of the electronic media by the allottee, which ultimately calls in question the reputation of the institution as well as integrity of the person(s) connected/serving under Paradip Port Authority without proper scrutiny of the matter in it right prospective may entail for cancellation.",
  ];

  clauses.forEach((clause, i) => {
    const label = `${i + 1}.`;
    doc.font("Helvetica-Bold").fontSize(11).text(label, { continued: true });
    doc.font("Helvetica").fontSize(11).text(`    ${clause}`, { align: "justify", lineGap: 3 });
  });

  // Signature block
  doc.moveDown(1.5);
  // Calculate X to center the 90px image over the right-aligned text block
  const sigBlockX = LEFT + W - 110;

  if (sigExists) {
    try {
      doc.image(SIG_PATH, sigBlockX, doc.y, { fit: [90, 60] });
      doc.y += 65; // Push text down below the signature
    } catch (_) { }
  } else {
    doc.moveDown(3);
  }

  doc.font("Helvetica-Bold").fontSize(11)
    .text("Sr. Asst. Estate Manager", { align: "right" })
    .text("Paradip Port Authority", { align: "right" });
  doc.moveDown(1.5);

  // Computer generated note
  doc.font("Helvetica-Bold").fontSize(9)
    .text("This is a computer generated order, signature not required.", { align: "center" });
  doc.moveDown(1);

  // Copy to list
  doc.font("Helvetica-Bold").fontSize(11).text("Copy to:-");
  const copies = [
    "Persons concerned through their respective D.D.O.s/Concerned D.D.O.s for information and necessary action.",
    "The Dy. Conservator(Marine Dept) (HoD), ppa for kind information.",
    "The E.E., P.H.D./E.E., P.E.D./E.E., R&B Divn., Paradip Port Authority for kind information and necessary action.",
    "The Dy. Director, EDP Cell, ppa for kind information.",
    `The Head Asst. / Sr.R.I. / Concerned Zone I/c, Estate Wing, ppa for information and necessary action. The aforesaid Zone-In-charges are hereby instructed to report the status of occupation and vacation of the qrs. as contained in this office order immediately after completion of 15 days from the date of issuance of this order.`,
    "Office order guard file/Project Associates.IITM.",
  ];
  copies.forEach((item, idx) => {
    doc.font("Helvetica-Bold").fontSize(10.5).text(`${idx + 1}.`, { continued: true });
    doc.font("Helvetica").fontSize(10.5).text(`    ${item}`, { align: "justify", lineGap: 2.5 });
  });

  doc.end();
  await ready;
  return Buffer.concat(chunks);
}

async function buildCircularPDF(body) {
  const {
    circularNo,
    circularDate,
    quarterTypes,
    quarterType,
    areaType,
    areaTypes,
    quarterNo,
    quarterNos,
    appFromDate,
    appToDate,
    closingTime,
    openingTime,
    verifyFromDate,
    verifyToDate,
    contactName,
    contactDesignation,
    contactNumber,
    contactArea,
  } = body;

  const formatTime = (t) => {
    let ft = t || "______";
    if (ft && /^([01]\d|2[0-3]):([0-5]\d)$/.test(ft)) {
      const [h, m] = ft.split(":");
      let hours = parseInt(h, 10);
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hoursStr = hours < 10 ? "0" + hours : hours;
      ft = `${hoursStr}.${m} ${ampm}`;
    }
    return ft;
  };

  const formattedOpeningTime = formatTime(openingTime || closingTime);

  const doc = new PDFDocument({ margin: 60, size: "A4" });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const pdfReady = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  const LOGO_PATH = path.join(__dirname, "..", "..", "..", "LMS-Quaters_Frontend", "src", "assets", "Logo.png");
  const logoExists = fs.existsSync(LOGO_PATH);

  const SAGARMALA_LOGO_PATH = path.join(__dirname, "..", "..", "..", "LMS-Quaters_Frontend", "src", "assets", "sagaramala.png");
  const sagarmalaExists = fs.existsSync(SAGARMALA_LOGO_PATH);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(11);
  const headerX = 60;

  if (logoExists) {
    try { doc.image(LOGO_PATH, headerX, 55, { width: 55, height: 55 }); } catch (_) { }
  }

  if (sagarmalaExists) {
    try { doc.image(SAGARMALA_LOGO_PATH, 465, 55, { width: 70 }); } catch (_) { }
  }

  doc
    .font("Helvetica-Bold").fontSize(11)
    .text("PARADIP PORT AUTHORITY", headerX, 58, { align: "center", width: 475 })
    .text("ADMINISTRATIVE DEPARTMENT", { align: "center", width: 475 })
    .text("(ESTATE WING)", { align: "center", width: 475 });

  if (!sagarmalaExists) {
    doc.font("Helvetica").fontSize(9)
      .text("SAGARMALA", headerX, 90, { align: "right", width: 475 });
  }

  doc.moveTo(60, 115).lineTo(535, 115).stroke();

  // Position cursor below the line
  doc.y = 125;
  const dateLine = `Date: ${circularDate || "______"}`;
  doc
    .font("Helvetica").fontSize(11)
    .text(dateLine, { align: "right" });

  doc.moveDown(1.5);

  // ── Title ────────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(14).text("CIRCULAR", { align: "center", underline: true });
  doc.moveDown(1.5);

  // ── Body ─────────────────────────────────────────────────────────────────
  let targetQuartersStr = "";
  if (quarterNos && Array.isArray(quarterNos) && quarterNos.length > 0 && quarterTypes && Array.isArray(quarterTypes) && quarterTypes.length > 0 && areaTypes && Array.isArray(areaTypes) && areaTypes.length > 0) {
    targetQuartersStr = `Quarter No(s). ${quarterNos.join(", ")} of Type(s) ${quarterTypes.join(", ")} in Area(s) ${areaTypes.join(", ")}`;
  } else if (quarterNos && Array.isArray(quarterNos) && quarterNos.length > 0 && quarterType && areaType) {
    targetQuartersStr = `Quarter No(s). ${quarterNos.join(", ")} (Type: ${quarterType}, Area: ${areaType})`;
  } else if (quarterNo && quarterType && areaType) {
    targetQuartersStr = `Quarter No. ${quarterNo} (Type: ${quarterType}, Area: ${areaType})`;
  } else {
    const qtyStr = Array.isArray(quarterTypes) ? quarterTypes.join(", ") : (quarterTypes || "______");
    targetQuartersStr = `${qtyStr} quarters`;
  }

  doc.font("Helvetica").fontSize(11)
    .text(
      `The Officers/employees are requested to submit their application for allotment of ` +
      `${targetQuartersStr} on online Web Based GIS Software from ` +
      `${appFromDate || "______"} to ${appToDate || "______"} by ${formattedOpeningTime}. ` +
      `After completion of the scheduled date and time the application submitted for allotment of ` +
      `quarters will not be entertained.`,
      { align: "justify", lineGap: 5 }
    );

  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(11)
    .text(
      `"They have to verify the conditions of the quarters on ` +
      `${verifyFromDate || "______"} to ${verifyToDate || "______"} before applying online. ` +
      `No further request will be considered for exchange / refusal after allotment".`,
      { align: "justify", lineGap: 5 }
    );

  doc.moveDown(2);
  doc.font("Helvetica").fontSize(11)
    .text(
      "It is requested to contact the following Estate personnel who will assist for verifying the " +
      "conditions of the quarters on the above mentioned day only.",
      { align: "justify", lineGap: 5 }
    );

  doc.moveDown(1.5);
  const contactLine =
    `1.  ${contactName || "______"}, ${contactDesignation || "______"} - ` +
    `${contactNumber || "______"} for ${contactArea || "______"}.`;
  doc.font("Helvetica-Bold").fontSize(11).text(contactLine, { underline: true, lineGap: 5 });

  doc.moveDown(3);
  doc.font("Helvetica-Bold").fontSize(12)
    .text("Sr. Asst. Estate Manager,", { align: "right" })
    .text("Paradip Port Authority", { align: "right" });

  doc.moveDown(3);
  doc.font("Helvetica-Bold").fontSize(11).text("Copy to :");
  doc.moveDown(1);
  const copies = [
    "All Heads of Departments/Heads of Officers, Paradip Port Authority for kind information of all concerned.",
    "The P.S. to Chairman for kind information of the Chairman, PPA.",
    "The PA to Dy. Chairman for kind information of Dy. Chairman, PPA.",
    "The all DDOs, Paradip Port Authority for information and necessary action. It is requested to inform all the employees working under their establishment to apply for the quarters on online mode.",
    "The HA/Jr. R.I./Zone In charges, Estate Wing, PPA for information and necessary action.",
    "Project Associate, IIT Madras/Office Order Guard File.",
  ];
  copies.forEach((item, idx) => {
    doc.font("Helvetica").fontSize(10)
      .text(`${idx + 1}.  ${item}`, { align: "justify", indent: 20 });
    doc.moveDown(0.2);
  });

  doc.end();
  await pdfReady;

  return Buffer.concat(chunks);
}

// ── POST /api/admin/preview-circular — view PDF without sending email ─────────
router.post("/preview-circular", async (req, res) => {
  try {
    const pdfBuffer = await buildCircularPDF(req.body);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=circular_preview.pdf");
    return res.send(pdfBuffer);
  } catch (err) {
    console.error("preview-circular error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ── POST /api/admin/generate-circular — build PDF & email ─────────────────────
router.post("/generate-circular", async (req, res) => {
  try {
    const pdfBuffer = await buildCircularPDF(req.body);

    // ── Send email ────────────────────────────────────────────────────────────
    const pool = await getPool();
    const emailsResult = await pool.request().query(`SELECT EmailAddress FROM dbo.TestEmails`);
    const emails = emailsResult.recordset.map((r) => r.EmailAddress).filter(Boolean);

    let emailSent = false;
    if (emails.length > 0) {
      await sendCircularEmailWithBuffer(emails, pdfBuffer, req.body);
      emailSent = true;
    }

    return res.json({ success: true, emailSent, recipientCount: emails.length });
  } catch (err) {
    console.error("generate-circular error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ── POST /api/admin/register-employee-admin — Register or Update Employee details ───────────────────
router.post("/register-employee-admin", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied: Admin only." });
  }

  const {
    employeeId,
    employeeName,
    dateOfBirth,
    dateOfJoining,
    gradDate,
    classOfEmployee,
    casteOfEmployee,
    department,
    mobile,
    email
  } = req.body;

  if (!employeeId || !employeeId.trim()) return res.status(400).json({ error: "Employee ID is required." });
  if (!employeeName || !employeeName.trim()) return res.status(400).json({ error: "Employee Name is required." });
  if (!dateOfBirth) return res.status(400).json({ error: "Date of Birth is required." });
  if (!dateOfJoining) return res.status(400).json({ error: "Date of Joining is required." });
  if (!gradDate) return res.status(400).json({ error: "Grade Date is required." });
  if (!classOfEmployee) return res.status(400).json({ error: "Class of Employee is required." });
  if (!casteOfEmployee) return res.status(400).json({ error: "Caste of Employee is required." });
  if (!department) return res.status(400).json({ error: "Department is required." });
  if (!mobile || !mobile.trim()) return res.status(400).json({ error: "Mobile Number is required." });
  if (!email || !email.trim()) return res.status(400).json({ error: "Email Address is required." });

  try {
    const pool = await getPool();

    // 1. Check if employee already exists by EmployeeId in UserDetails
    const checkEmp = await pool
      .request()
      .input("EmployeeId", sql.NVarChar(50), employeeId.trim())
      .query("SELECT TOP 1 UserId FROM dbo.UserDetails WHERE EmployeeId = @EmployeeId");

    const existingUserId = checkEmp.recordset[0]?.UserId;

    if (existingUserId) {
      // Update existing UserDetails
      await pool
        .request()
        .input("UserId", sql.Int, existingUserId)
        .input("EmployeeName", sql.NVarChar(120), employeeName.trim())
        .input("DateOfBirth", sql.Date, new Date(dateOfBirth))
        .input("DateOfJoining", sql.Date, new Date(dateOfJoining))
        .input("GradDate", sql.Date, gradDate ? new Date(gradDate) : null)
        .input("EmpClass", sql.NVarChar(60), classOfEmployee || "CLASS-III")
        .input("Caste", casteOfEmployee || "GENERAL")
        .input("DPT_NM", department || "")
        .input("Mobile", mobile || "")
        .input("Email", email || "")
        .query(`
          UPDATE dbo.UserDetails
          SET EmployeeName = @EmployeeName,
              DateOfBirth = @DateOfBirth,
              DateOfJoining = @DateOfJoining,
              GradDate = @GradDate,
              EmpClass = @EmpClass,
              Caste = @Caste,
              DPT_NM = @DPT_NM,
              Mobile = @Mobile,
              Email = @Email
          WHERE UserId = @UserId
        `);

      // Optionally update username in dbo.Users if email is provided
      if (email && email.trim()) {
        await pool
          .request()
          .input("UserId", sql.Int, existingUserId)
          .input("Username", sql.NVarChar(64), email.trim().toLowerCase())
          .query("UPDATE dbo.Users SET Username = @Username WHERE Id = @UserId");
      }

      return res.json({ success: true, message: `Employee "${employeeName}" updated successfully.` });
    } else {
      // Check if user already exists in Users table (by email/username)
      // If no email, we use the EmployeeId as username.
      const newUsername = (email && email.trim()) ? email.trim().toLowerCase() : employeeId.trim();
      const checkUser = await pool
        .request()
        .input("Username", sql.NVarChar(64), newUsername)
        .query("SELECT TOP 1 Id FROM dbo.Users WHERE Username = @Username");

      let userId = checkUser.recordset[0]?.Id;

      if (!userId) {
        // Create entry in dbo.Users with default hashed password
        const bcrypt = require("bcryptjs");
        const passwordHash = await bcrypt.hash("changeme123", 10);
        
        const insertUser = await pool
          .request()
          .input("Username", sql.NVarChar(64), newUsername)
          .input("PasswordHash", sql.NVarChar(255), passwordHash)
          .input("Role", sql.NVarChar(32), "employee")
          .query(`
            INSERT INTO dbo.Users (Username, PasswordHash, Role)
            VALUES (@Username, @PasswordHash, @Role);
            SELECT SCOPE_IDENTITY() AS Id;
          `);
          
        userId = insertUser.recordset[0]?.Id;
      }

      // Insert new entry into dbo.UserDetails
      await pool
        .request()
        .input("UserId", sql.Int, userId)
        .input("EmployeeId", sql.NVarChar(50), employeeId.trim())
        .input("EmployeeName", sql.NVarChar(120), employeeName.trim())
        .input("DateOfBirth", sql.Date, new Date(dateOfBirth))
        .input("DateOfJoining", sql.Date, new Date(dateOfJoining))
        .input("GradDate", sql.Date, gradDate ? new Date(gradDate) : null)
        .input("EmpClass", sql.NVarChar(60), classOfEmployee || "CLASS-III")
        .input("Caste", casteOfEmployee || "GENERAL")
        .input("DPT_NM", department || "")
        .input("Mobile", mobile || "")
        .input("Email", email || "")
        .query(`
          INSERT INTO dbo.UserDetails
          (UserId, EmployeeId, EmployeeName, DateOfBirth, DateOfJoining, GradDate, EmpClass, Caste, DPT_NM, Mobile, Email)
          VALUES
          (@UserId, @EmployeeId, @EmployeeName, @DateOfBirth, @DateOfJoining, @GradDate, @EmpClass, @Caste, @DPT_NM, @Mobile, @Email)
        `);

      return res.json({ success: true, message: `Employee "${employeeName}" registered successfully.` });
    }
  } catch (err) {
    console.error("register-employee-admin error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

module.exports = router;