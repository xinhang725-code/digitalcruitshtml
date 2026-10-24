const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(process.env.TIMING_HTML || require('node:path').join(__dirname, '../timing-waveform.html'), 'utf8');
function app() {
  const elements = new Map(),listeners=new Map();
  function el() { return { value:'', innerHTML:'', textContent:'', hidden:false, disabled:false, style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){}}, setAttribute(){}, addEventListener(){}, appendChild(){}, replaceChildren(){}, querySelectorAll(){return []}, querySelector(){return el()}, getBoundingClientRect(){return {left:0,top:0,width:1000}}, focus(){}, click(){} }; }
  const document = {getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},querySelectorAll(){return []},addEventListener(name,handler){listeners.set(name,handler)},createElement:el,body:el()};
  const context = vm.createContext({document,console,Blob,URL,XMLSerializer:class{},setTimeout(){},clearTimeout(){},alert(){},localStorage:{getItem(){return null},setItem(){}},window:{addEventListener(){}},crypto:require('node:crypto').webcrypto});
  for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))vm.runInContext(script[1],context);
  return {run:code=>{const value=vm.runInContext(code,context);return value===undefined?undefined:JSON.parse(JSON.stringify(value));},elements,emit:(name,event)=>listeners.get(name)(event)};
}
const manual=(name,values)=>({name,type:'manual',values});
const ff=(name,d)=>({name,type:'dff',clk:'CLK',d,edge:'rise',initial:0,values:[]});
const project={N:4,signals:[manual('CLK',[0,1,0,1]),manual('D',[1,1,0,0]),ff('Q','D')]};
function load(a,p){a.run(`restore(${JSON.stringify(JSON.stringify(p))})`)}
test('all generated inline event handlers compile',()=>{const a=app();const source=a.elements.get('rows')?.innerHTML||'';for(const m of source.matchAll(/(?:onclick|onchange)="([^"]*)"/g))assert.doesNotThrow(()=>new Function('event',m[1]));});
test('renaming a connected input preserves its connection',()=>{const a=app();load(a,project);a.run("edit(1,'name','DATA')");assert.deepEqual(a.run("signals.find(s=>s.name==='Q').values"),[0,1,1,0]);});
test('same-edge cascades sample old state regardless of list order',()=>{const a=app();load(a,{N:4,signals:[manual('CLK',[0,1,0,1]),manual('D',[1,1,1,1]),ff('Q1','D'),ff('Q2','Q1')]});assert.deepEqual(a.run("signals.find(s=>s.name==='Q2').values"),[0,0,0,1]);});
test('invalid import does not corrupt the open project',()=>{const a=app();load(a,project);const before=a.run('({N,signals})');assert.throws(()=>a.run("restore('{\"N\":-3,\"signals\":null}')"));assert.deepEqual(a.run('({N,signals})'),before);});
test('shrinking then expanding really removes truncated samples',()=>{const a=app();load(a,{N:8,signals:[manual('D',[0,0,0,0,1,1,1,1])]});a.elements.get('count').value='4';a.run('resize()');a.elements.get('count').value='8';a.run('resize()');assert.deepEqual(a.run('signals[0].values'),[0,0,0,0,0,0,0,0]);});
test('JK uncertainty keeps a provably set state',()=>{const a=app();load(a,{N:4,signals:[manual('CLK',[0,1,0,1]),manual('J',['X','X','X','X']),manual('K',[0,0,0,0]),{name:'Q',type:'jkff',clk:'CLK',j:'J',k:'K',initial:1,values:[]}]});assert.deepEqual(a.run('signals[3].values'),[1,1,1,1]);});
test('unknown clock transition propagates possible sampling',()=>{const a=app();load(a,{N:4,signals:[manual('CLK',[0,'X',1,1]),manual('D',[1,1,1,1]),ff('Q','D')]});assert.deepEqual(a.run('signals[2].values'),[0,'X','X','X']);});
test('undo and redo restore waveform edits',()=>{const a=app();load(a,project);a.run('set(1,0)');assert.equal(a.run('signals[1].values[0]'),'X');a.run('undo()');assert.equal(a.run('signals[1].values[0]'),1);a.run('redo()');assert.equal(a.run('signals[1].values[0]'),'X');});
test('D JK RS T truth tables match independent Boolean equations',()=>{
  const a=app(),expand=v=>v==='X'?[0,1]:[v];
  let checks=0;
  for(const type of ['dff','jkff','rsff','tff'])for(const q of [0,1,'X'])for(const x of [0,1,'X'])for(const y of [0,1,'X']){
    const expected=[];
    for(const old of expand(q))for(const p of expand(x))for(const r of expand(y)){
      expected.push(type==='dff'?p:type==='tff'?(old^p):type==='jkff'?Number((p&&!old)||(!r&&old)):(p&&r?'X':r?1:p?0:old));
    }
    const consensus=expected.every(v=>v===expected[0])?expected[0]:'X';
    assert.equal(a.run(`transition('${type}',${JSON.stringify(q)},${JSON.stringify(x)},${JSON.stringify(y)})`),consensus,`${type}: Q=${q}, inputs=${x}${y}`);checks++;
  }
  assert.equal(checks,108);
});
test('reordering synchronous cascades does not change output',()=>{
  const a=app();load(a,{N:4,signals:[manual('CLK',[0,1,0,1]),manual('D',[1,1,1,1]),ff('Q2','Q1'),ff('Q1','D')]});
  assert.deepEqual(a.run("signals.find(s=>s.name==='Q2').values"),[0,0,0,1]);
});
test('derived clocks propagate ripple transitions independently of row order',()=>{
  const a=app();load(a,{N:8,signals:[manual('CLK',[0,1,0,1,0,1,0,1]),manual('T',Array(8).fill(1)),{name:'Q2',type:'tff',t:'T',clk:'Q1',edge:'fall',initial:0,values:[]},{name:'Q1',type:'tff',t:'T',clk:'CLK',edge:'rise',initial:0,values:[]}]});
  assert.deepEqual(a.run("signals.find(s=>s.name==='Q2').values"),[0,0,0,1,1,1,1,0]);
});
test('falling edge and before/after sampling can be selected',()=>{
  const a=app();load(a,{N:4,signals:[manual('CLK',[0,1,0,1]),manual('D',[0,1,0,1]),{...ff('Q','D'),edge:'fall'}]});
  assert.deepEqual(a.run('signals[2].values'),[0,0,1,1]);
  a.run("edit(2,'sample','after')");assert.deepEqual(a.run('signals[2].values'),[0,0,0,0]);
});
test('deleting an input cannot bind a replacement with the same name',()=>{
  const a=app();load(a,project);a.run('remove(1);add();edit(signals.length-1,\'name\',\'D\')');
  assert.deepEqual(a.run("signals.find(s=>s.name==='Q').values"),[0,'X','X','X']);
});
test('JSON round trip preserves all connections and computed waveforms',()=>{
  const a=app();a.run("flip('jkff');flip('rsff');flip('tff')");const before=a.run('project()');a.run('restore(serialize())');assert.deepEqual(a.run('project()'),before);
});
test('duplicate names and malformed levels are rejected atomically',()=>{
  const a=app();const before=a.run('project()');
  assert.throws(()=>load(a,{N:4,signals:[manual('D',[0]),manual('D',[1])]}));
  assert.throws(()=>load(a,{N:4,signals:[manual('D',[2])]}));
  assert.deepEqual(a.run('project()'),before);
});
test('time count rejects decimals without damaging history',()=>{
  const a=app();a.elements.get('count').value='4.5';const before=a.run('({N,signals,history})');a.run('resize()');assert.deepEqual(a.run('({N,signals,history})'),before);
});
test('RS forbidden state can recover on a later valid set',()=>{
  const a=app();load(a,{N:4,signals:[manual('CLK',[0,1,0,1]),manual('R',[1,1,0,0]),manual('S',[1,1,1,1]),{name:'Q',type:'rsff',clk:'CLK',r:'R',s:'S',initial:0,values:[]}]});assert.deepEqual(a.run('signals[3].values'),[0,'X','X',1]);
});
test('settings markup exposes clock edge, initial X and all input bindings',()=>{
  const a=app();a.run("flip('jkff')");const markup=a.elements.get('rows').innerHTML;
  for(const key of ['clk','edge','initial','j','k'])assert.match(markup,new RegExp('data-key="'+key+'"'));
  assert.doesNotMatch(markup,/display:\s*none/);assert.match(markup,/value="X"/);
});
test('SVG export escapes labels and excludes editing hit targets',()=>{
  const a=app();a.run("edit(1,'name','D<&\"')");const svg=a.run('renderWave(true)');assert.match(svg,/D&lt;&amp;&quot;/);assert.doesNotMatch(svg,/data-cell|data-select|tabindex|onclick/);assert.match(svg,/fill="#ffffff"/);
});
test('copies of maximum-length names remain valid for save and undo',()=>{
  const a=app();a.run("edit(1,'name','A'.repeat(32));duplicate(1)");assert.doesNotThrow(()=>a.run('restore(serialize())'));
});
test('Enter edits a focused SVG cell without relying on HTMLElement.click',()=>{
  const a=app();load(a,project);a.emit('keydown',{key:'Enter',target:{tagName:'rect',dataset:{signal:'1',cell:'0'},matches(){return true}},preventDefault(){}});assert.equal(a.run('signals[1].values[0]'),'X');
});
test('Space selects a focused SVG signal label',()=>{
  const a=app();const sid=a.run('signals[0].id');a.emit('keydown',{key:' ',target:{tagName:'rect',dataset:{select:sid},matches(){return true}},preventDefault(){}});assert.equal(a.run('selected'),sid);
});
test('uploaded asynchronous counter matches all seven falling-edge states',()=>{
 const a=app();a.run('restore(counterExample())');
 assert.deepEqual(a.run('counterSamples().map(s=>s.state)'),['000','001','010','011','100','000','001','010']);
 assert.deepEqual(a.run("signals.find(s=>s.name==='CP').values"),[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,0]);
});
test('counter sample is recomputed from connections after initial state changes',()=>{
 const a=app();a.run('restore(counterExample());edit(signals.findIndex(s=>s.name===\'Q3\'),\'initial\',1)');
 assert.deepEqual(a.run('counterSamples().slice(0,3).map(s=>s.state)'),['100','000','001']);
});
test('counter simulation is invariant under all signal ordering changes',()=>{
 const a=app();a.run('restore(counterExample())');const expected=a.run('counterSamples()');a.run('signals.reverse();draw()');assert.deepEqual(a.run('counterSamples()'),expected);
});
test('logic signals evaluate AND NOT with constants and unknown values',()=>{
 const a=app();load(a,{version:2,N:4,signals:[{...manual('A',[0,1,'X',1]),id:'a'},{id:'n',name:'NOT',type:'logic',gate:'not',a:'a',values:[]},{id:'g',name:'AND',type:'logic',gate:'and',a:'n',b:'@0',values:[]}]});
 assert.deepEqual(a.run("signals.find(s=>s.id==='n').values"),[1,0,'X',0]);assert.deepEqual(a.run("signals.find(s=>s.id==='g').values"),[0,0,0,0]);
});
test('counter round trip retains constants helper connections and view options',()=>{
 const a=app();a.run('restore(counterExample())');const before=a.run('project()');a.run('restore(serialize())');assert.deepEqual(a.run('project()'),before);
});
test('changing a feedback input changes the counter instead of retaining a hardcoded answer',()=>{
 const a=app();a.run('restore(counterExample());edit(signals.findIndex(s=>s.name===\'Q3\'),\'j\',\'@0\')');assert.deepEqual(a.run('counterSamples().map(s=>s.state)'),['000','001','010','011','000','001','010','011']);
});
test('counter export draws seven edge guides and only four main signals',()=>{
 const a=app();a.run('restore(counterExample())');const svg=a.run('renderWave(true)');
 assert.equal((svg.match(/data-edge-guide/g)||[]).length,7);assert.match(svg,/Q3/);assert.doesNotMatch(svg,/Q1_AND_Q2|NOT_Q3/);assert.match(svg,/#9a6c27/);
});
test('pure combinational feedback resolves as X independently of row order',()=>{
 const a=app();load(a,{version:2,N:4,signals:[{id:'a',name:'A',type:'logic',gate:'not',a:'b',values:[]},{id:'b',name:'B',type:'logic',gate:'and',a:'a',b:'@0',values:[]}]});
 const first=a.run("signals.map(s=>({id:s.id,values:s.values})).sort((a,b)=>a.id.localeCompare(b.id))");
 a.run('signals.reverse();draw()');assert.deepEqual(a.run("signals.map(s=>({id:s.id,values:s.values})).sort((a,b)=>a.id.localeCompare(b.id))"),first);
 assert.deepEqual(first.map(s=>s.values),[Array(4).fill('X'),Array(4).fill('X')]);
});
test('the circuit can be built with ordinary editor tools without loading a preset',()=>{
 const a=app();a.run(`
 restore({N:16,signals:[]});clock();edit(0,'name','CP');edit(0,'cycles',7);
 flip('jkff');flip('jkff');flip('jkff');addLogic();addLogic();
 const outputIds=signals.filter(s=>s.type==='jkff').map(s=>s.id),gateIds=signals.filter(s=>s.type==='logic').map(s=>s.id);
 const index=id=>signals.findIndex(s=>s.id===id),cp=signals[0].id;
 outputIds.forEach((id,i)=>{edit(index(id),'name','Q'+(i+1));edit(index(id),'edge','fall')});
 edit(index(gateIds[0]),'gate','not');edit(index(gateIds[0]),'a',outputIds[2]);
 edit(index(gateIds[1]),'a',outputIds[0]);edit(index(gateIds[1]),'b',outputIds[1]);
 edit(index(outputIds[0]),'j',gateIds[0]);edit(index(outputIds[0]),'k','@1');
 edit(index(outputIds[1]),'clk',outputIds[0]);edit(index(outputIds[1]),'j',outputIds[0]);edit(index(outputIds[1]),'k',outputIds[0]);
 edit(index(outputIds[2]),'j',gateIds[1]);edit(index(outputIds[2]),'k','@1');
 gateIds.forEach(id=>edit(index(id),'auxiliary','true'));
 view.guide=cp;view.stateIds=[...outputIds].reverse();view.style='paper';draw();
 `);
 assert.deepEqual(a.run('counterSamples().map(s=>s.state)'),['000','001','010','011','100','000','001','010']);
 assert.deepEqual(a.run("signals.filter(s=>s.type==='logic').map(s=>s.auxiliary)"),[true,true]);
});
