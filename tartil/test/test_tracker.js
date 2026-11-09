const fs=require('fs'),zlib=require('zlib');
const ref=JSON.parse(zlib.gunzipSync(fs.readFileSync(__dirname+'/../tartil_ref.json.gz')));
const T=require('../tracker.js');
const pass=T.buildPassage(ref,114,1,6);
const vocab=ref.vocab, V=Object.keys(vocab).length+1;
let seed=12345; const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
function synth(syms,replace,drop){const rows=[];
  syms.forEach((s,i)=>{const sym=replace[i]||s;const nf=2+Math.floor(rnd()*4),pk=Math.floor(rnd()*nf);
    for(let k=0;k<nf;k++){const r=new Float64Array(V).map(()=>rnd()*1e-3);
      if(k===pk&&!drop.has(i)){r[vocab[sym]]=0.5+rnd()*.47;}else r[0]=1;
      const sum=r.reduce((a,b)=>a+b,0);rows.push(Array.from(r,x=>Math.log(x/sum)));}});
  const lp=new Float32Array(rows.length*V);rows.forEach((r,t)=>lp.set(r,t*V));return {lp,T:rows.length};}
const n=pass.syms.length;console.log('passage phones',n,'words',pass.words.length);
// pieces of ~25 phones, with an injected error: phone 40 replaced, and the piece boundaries mid-word
const cuts=[0,22,47,n];const inj={40:'D'};
const tr=T.create(pass,vocab);
for(let k=0;k<cuts.length-1;k++){
  const a=cuts[k],b=cuts[k+1];
  const rep={};for(const g in inj) if(g>=a&&g<b) rep[g-a]=inj[g];
  const s=synth(pass.syms.slice(a,b),rep,new Set());
  const r=tr.process(s.lp,s.T,V);
  console.log('piece',k,r.status,r.start,r.end,r.flags.map(f=>f.idx+':'+f.ref+'->'+f.heard+'/'+f.level));
}
console.log(tr.wordStates().join(' '),'| done',tr.done);
// starting mid-passage and a segment that is not in the passage at all
const tr2=T.create(pass,vocab);const s2=synth(pass.syms.slice(30,60),{},new Set());
const r2=tr2.process(s2.lp,s2.T,V);console.log('mid start ->',r2.status,r2.start,r2.end,r2.flags.length);
const other=T.buildPassage(ref,1,1,7);const s3=synth(other.syms.slice(0,40),{},new Set());
const r3=tr.process(s3.lp,s3.T,V);console.log('wrong verse ->',r3.status);
