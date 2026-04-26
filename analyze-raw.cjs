const fs=require("fs");
const path=require("path");
const d=JSON.parse(fs.readFileSync(path.join(__dirname,"results","layer2-benchmark-siliconflow-2026-04-25.json"),"utf8"));
const unknowns=d.cases.filter(c=>c.decision_type===null||c.actual_mode==="unknown");
console.log("Unknowns:",unknowns.length,"/",d.cases.length);
unknowns.slice(0,5).forEach(c=>{
  console.log("---INPUT:",c.input.slice(0,60));
  console.log("---RAW:",(c.raw||"null").slice(0,300));
  console.log("---");
});
