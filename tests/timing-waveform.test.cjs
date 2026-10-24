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
