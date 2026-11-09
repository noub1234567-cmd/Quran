const D=require('./detect.js'), cases=require('./golden.json');
let bad=0;
for(const c of cases){
  const lp=Float32Array.from(c.logp);
  const ids=c.ref.syms.map(s=>c.vocab[s]);
  const sp=D.ctcAlign(lp,c.T,c.V,ids);
  const spOk=JSON.stringify(sp)===JSON.stringify(c.spans);
  let fl;
  try{fl=D.analyze(lp,c.T,c.V,c.ref,c.vocab,null,sp).flags.map(f=>({idx:f.idx,kind:f.kind,level:f.level,tier:f.tier,ref:f.ref,heard:f.heard}));}catch(e){fl=['ERR']}
  const ok=spOk&&JSON.stringify(fl)===JSON.stringify(c.expected);
  if(!ok){bad++;console.log('MISMATCH',c.name,spOk,JSON.stringify(fl).slice(0,200),JSON.stringify(c.expected).slice(0,200));}
}
console.log(bad?`FAIL ${bad}/${cases.length}`:`all ${cases.length} cases identical`);
