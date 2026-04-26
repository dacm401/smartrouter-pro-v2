const k=process.env.SILICONFLOW_API_KEY||process.env.OPENAI_API_KEY;
console.log("API_KEY:",k?"SET("+k.slice(0,6)+"...)":"NOT SET");
console.log("BASE_URL:",process.env.SILICONFLOW_BASE_URL||"NOT SET (uses default)");
console.log("FAST_MODEL:",process.env.FAST_MODEL||"NOT SET");
