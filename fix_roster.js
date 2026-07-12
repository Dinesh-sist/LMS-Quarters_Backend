require('dotenv').config();
const { sql, getPool } = require('./src/db');

(async () => {
  try {
    const pool = await getPool();

    const appsRes = await pool.request().query(`
      SELECT qa.Id, qa.Status, qa.QtrType, qa.Class, ud.GradDate, ud.Basic, ud.DateOfJoining, ud.DateOfBirth, qa.ReqDate
      FROM dbo.Quarter_Applications qa
      LEFT JOIN dbo.UserDetails ud ON qa.UserId = ud.UserId
      WHERE qa.Status = 'approved' OR qa.Status = 'Allotted'
    `);
    
    const apps = appsRes.recordset;
    if (!apps || apps.length === 0) {
      console.log("No approved apps found.");
      process.exit(0);
    }

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
    const toTimeOrNull = (val) => {
      if (!val) return null;
      const time = new Date(val).getTime();
      return Number.isNaN(time) ? null : time;
    };
    const compareNullableNumber = (a, b) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    };

    const appsByType = {};
    for (const app of apps) {
      const type = (app.QtrType || "").trim().toUpperCase();
      if (!appsByType[type]) appsByType[type] = [];
      appsByType[type].push(app);
    }

    for (const type of Object.keys(appsByType)) {
      appsByType[type].sort((a, b) => {
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
      });

      let rosterCounter = 1;
      for (const app of appsByType[type]) {
        await pool.request()
          .input("Id", sql.Int, app.Id)
          .input("RosterNo", sql.Int, rosterCounter)
          .query("UPDATE dbo.Quarter_Applications SET RosterNo = @RosterNo WHERE Id = @Id");
        
        rosterCounter = rosterCounter >= 60 ? 1 : rosterCounter + 1;
      }

      // Match QtrType format with Roster_Counters (e.g. C TYPE -> Ctype, C TYPE (MODIFIED) -> Ctype (Modified))
      let dbCounterType = "";
      if (type === "A TYPE") dbCounterType = "Atype";
      if (type === "B TYPE") dbCounterType = "Btype";
      if (type === "B TYPE IIIR") dbCounterType = "Btype IIR";
      if (type === "C TYPE") dbCounterType = "Ctype";
      if (type === "C TYPE (MODIFIED)") dbCounterType = "Ctype (Modified)";
      if (type === "D TYPE") dbCounterType = "Dtype";

      if (dbCounterType) {
        await pool.request()
          .input("Num", sql.Int, rosterCounter)
          .input("Type", sql.VarChar(50), dbCounterType)
          .query("UPDATE dbo.Roster_Counters SET CurrentNumber = @Num WHERE QuarterType = @Type");
      }
    }

    console.log("Fixed all roster numbers and counters!");
    process.exit(0);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
