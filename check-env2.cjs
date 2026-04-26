const fs=require("fs");
const lines=fs.readFileSync(".env","utf8").split("\n");
lines.forEach(l=>{
  const[k,v]=l.split("=");
  if(k==="SILICONFLOW_API_KEY"||k==="OPENAI_API_KEY"){
    console.log(k+": "+(v?v.slice(0,6)+"...":"NOT SET"));
  }
  if(k==="SILICONFLOW_BASE_URL")console.log(k+": "+v);
  if(k==="FAST_MODEL")console.log(k+": "+v);
});
