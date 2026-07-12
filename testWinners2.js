const sql = require('mssql');
require('dotenv').config();
const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER || 'localhost', database: process.env.DB_DATABASE, options: { encrypt: process.env.DB_ENCRYPT === 'true', trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true' } };

async function computeDynamicAllotments() {
  const pool = await sql.connect(config);
  
  const rosterRes = await pool.request().query("SELECT QuarterType, CurrentNumber FROM dbo.Roster_Counters");
  const rosterCounters = {};
  for (const r of rosterRes.recordset) {
    rosterCounters[r.QuarterType] = r.CurrentNumber;
  }
  
  const applicantsRes = await pool.request().query(`
    SELECT a.Id, a.EmpId, a.EmpName, a.Caste, a.QtrType, a.QtrLocation, a.QtrRequested, a.PriorityNo, a.Reason,
           a.Class, a.ReqDate, ud.GradDate, ud.Basic, ud.DateOfJoining, ud.DateOfBirth
    FROM dbo.Quarter_Applications a
    LEFT JOIN dbo.UserDetails ud ON a.UserId = ud.UserId
    WHERE a.Status = 'Pending'
  `);
  
  const applicants = applicantsRes.recordset;
  console.log("Applicants count:", applicants.length);
  
  const quartersMap = {};
  for (const app of applicants) {
    const key = `${app.QtrType}|${app.QtrLocation}|${app.QtrRequested}`;
    if (!quartersMap[key]) {
      quartersMap[key] = {
        QtrType: app.QtrType,
        QtrLocation: app.QtrLocation,
        QtrRequested: app.QtrRequested,
        applicants: []
      };
    }
    quartersMap[key].applicants.push(app);
  }
  
  const quartersList = Object.values(quartersMap).sort((a, b) => {
    if (a.QtrType !== b.QtrType) return (a.QtrType || "").localeCompare(b.QtrType || "");
    if (a.QtrLocation !== b.QtrLocation) return (a.QtrLocation || "").localeCompare(b.QtrLocation || "");
    return (a.QtrRequested || "").localeCompare(b.QtrRequested || "");
  });
  
  console.log("Unique Quarters being applied for:", quartersList.length);
  
  const results = {
    winners: [],
    losers: []
  };
  
  const mapQtrTypeToRosterKey = (qType) => {
    if (!qType) return "";
    const t = String(qType).trim().toUpperCase();
    if (t === "A TYPE") return "Atype";
    if (t === "B TYPE") return "Btype";
    if (t === "B TYPE IIIR") return "Btype IIR";
    if (t === "C TYPE") return "Ctype";
    if (t === "C TYPE (MODIFIED)") return "Ctype (Modified)";
    if (t === "D TYPE") return "Dtype";
    return qType;
  };

  const compareNullableNumber = (a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  };

  for (const q of quartersList) {
    const rawType = q.QtrType;
    const dbRosterKey = mapQtrTypeToRosterKey(rawType);
    let currentNumber = rosterCounters[dbRosterKey] || 1;
    
    const getClassRankSt = (cls) => {
      const norm = String(cls || "").toUpperCase().trim().replace(/[\s_-]+/g, "");
      if (norm.includes("SRCLASSI") || norm.includes("SRCLASS1")) return 1;
      if (norm.includes("JRCLASSI") || norm.includes("JRCLASS1")) return 2;
      if (norm.includes("CLASSIV")  || norm === "CLASS4" || norm === "4") return 5;
      if (norm.includes("CLASSIII") || norm === "CLASS3" || norm === "3") return 4;
      if (norm.includes("CLASSII")  || norm === "CLASS2" || norm === "2") return 2;
      if (norm.includes("CLASSI")   || norm === "CLASS1" || norm === "1") return 1.5;
      return 99;
    };
    q.applicants.sort((a, b) => {
      const rankA = getClassRankSt(a.Class);
      const rankB = getClassRankSt(b.Class);
      if (rankA !== rankB) return rankA - rankB;
      
      const toTimeOrNull = (val) => {
        if (!val) return null;
        const time = new Date(val).getTime();
        return Number.isNaN(time) ? null : time;
      };

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
    
    let requiredCategory = "General";
    const qTypeUpper = (rawType || "").toUpperCase();
    if (qTypeUpper.includes("A") || qTypeUpper.includes("B")) {
      if ([10, 20, 40, 50].includes(currentNumber)) requiredCategory = "SC";
      else if ([30, 60].includes(currentNumber)) requiredCategory = "ST";
    } else if (qTypeUpper.includes("C") || qTypeUpper.includes("D")) {
      if ([20, 40].includes(currentNumber)) requiredCategory = "SC";
      else if (currentNumber === 60) requiredCategory = "ST";
    }
    
    let winner = null;
    if (requiredCategory !== "General") {
      winner = q.applicants.find(app => (app.Caste || "").toUpperCase() === requiredCategory);
      if (!winner && requiredCategory === "SC") {
        winner = q.applicants.find(app => (app.Caste || "").toUpperCase() === "ST");
      }
    }
    if (!winner) {
      winner = q.applicants[0];
    }
    
    if ((winner.Reason || "").toLowerCase() === 'exchange') {
      winner.RosterNo = null;
    } else {
      winner.RosterNo = currentNumber;
      rosterCounters[dbRosterKey] = currentNumber >= 60 ? 1 : currentNumber + 1;
    }
    
    winner.TentativeStatus = "Allotted";
    results.winners.push(winner);
    
    for (const app of q.applicants) {
      if (app.Id !== winner.Id) {
        app.TentativeStatus = "Rejected";
        results.losers.push(app);
      }
    }
  }
  return { results, newCounters: rosterCounters };
}

async function start() {
    const data = await computeDynamicAllotments();
    console.log("Winners count:", data.results.winners.length);
    if (data.results.winners.length > 0) {
        console.log("First winner:", {
            Id: data.results.winners[0].Id,
            EmpName: data.results.winners[0].EmpName,
            QtrRequested: data.results.winners[0].QtrRequested,
            TentativeStatus: data.results.winners[0].TentativeStatus,
            RosterNo: data.results.winners[0].RosterNo
        });
    }
    process.exit(0);
}
start().catch(console.error);
