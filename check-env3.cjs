require("dotenv").config();
const k=process.env.OPENAI_API_KEY||"";
const b=process.env.SILICONFLOW_BASE_URL||process.env.OPENAI_BASE_URL||"default";
console.log("KEY:",k.slice(0,6)+"...");
console.log("BASE:",b);
console.log("FAST_MODEL:",process.env.FAST_MODEL||"NOT SET");
