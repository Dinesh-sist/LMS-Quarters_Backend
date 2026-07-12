require('dotenv').config();
const { sql, getPool } = require("./src/db");

async function computeDynamicAllotments() {
  const pool = await getPool();
  
  const rosterRes = await pool.request().query("SELECT QuarterType, CurrentNumber FROM dbo.Roster_Counters");
  const rosterCounters = {};
  for (const r of rosterRes.recordset) {
    rosterCounters[r.QuarterType] = r.CurrentNumber;
  }
  
  const applicantsRes = await pool.request().query(`
    SELECT a.Id, a.EmpId, a.EmpName, a.Caste, a.QtrType, a.QtrLocation, a.QtrRequested, ud.GradDate, a.PriorityNo, a.Status
    FROM dbo.Quarter_Applications a
    LEFT JOIN dbo.UserDetails ud ON a.UserId = ud.UserId
    WHERE a.Status = 'Pending'
  `);
  
  const applicants = applicantsRes.recordset;
  console.log("Pending Applicants: ", applicants.length);
  
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
  
  const results = { winners: [], losers: [] };
  
  for (const q of quartersList) {
    const type = q.QtrType;
    let currentNumber = rosterCounters[type] || 1;
    
    q.applicants.sort((a, b) => {
      const aTime = a.GradDate ? new Date(a.GradDate).getTime() : Infinity;
      const bTime = b.GradDate ? new Date(b.GradDate).getTime() : Infinity;
      if (aTime !== bTime) return aTime - bTime;
      const aPrio = a.PriorityNo != null ? Number(a.PriorityNo) : Infinity;
      const bPrio = b.PriorityNo != null ? Number(b.PriorityNo) : Infinity;
      return aPrio - bPrio;
    });
    
    let requiredCategory = "General";
    const qTypeUpper = (type || "").toUpperCase();
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
    
    winner.RosterNo = currentNumber;
    winner.TentativeStatus = "Allotted";
    results.winners.push(winner);
    
    rosterCounters[type] = currentNumber >= 60 ? 1 : currentNumber + 1;
  }
  
  console.log("Winners:", JSON.stringify(results.winners, null, 2));
}

computeDynamicAllotments().then(() => process.exit(0)).catch(console.error);

