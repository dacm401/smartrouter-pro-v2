const d=require("./results/layer2-benchmark-siliconflow-2026-04-25.json");
const unknowns=d.cases.filter(c=>c.decision_type===null||c.actual_mode==="unknown");
unknowns.slice(0,6).forEach(c=>{
  console.log("---INPUT:",c.input.slice(0,60));
  console.log("---RAW:",c.raw?c.raw.slice(0,300):"null");
  console.log("---");
});
