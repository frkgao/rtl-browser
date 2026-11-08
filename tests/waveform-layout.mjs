// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { allRows,visibleRows,moveRows,groupRows,removeRows,validateLayout,waveIdentity,transitions,snapTime } from '../dist/server/packages/contracts/src/waveLayout.js';
const signal=id=>({kind:'signal',id,path:`TOP.${id}`,width:1,color:0});
const original=[signal('a'),signal('b'),signal('c')];
const grouped=groupRows(original,['a','b'],'g','bus');
assert.deepEqual(grouped.map(r=>r.id),['g','c']);
assert.deepEqual(grouped[0].children.map(r=>r.id),['a','b']);
assert.deepEqual(original.map(r=>r.id),['a','b','c'],'tree operations must not mutate old state');
const nested=groupRows(grouped,['a'],'h','nested');
assert.equal(nested[0].children[0].id,'h');
assert.deepEqual(moveRows(nested,['g'],'h'),nested,'cannot move ancestor into descendant');
assert.deepEqual(moveRows(nested,['h'],'h'),nested,'cannot move group into itself');
const moved=moveRows(nested,['c'],'g','b');
assert.deepEqual(moved[0].children.map(r=>r.id),['h','c','b']);
const rootMove=moveRows(moved,['a'],null);
assert.equal(rootMove.at(-1).id,'a');
const collapsed=[{...grouped[0],collapsed:true},signal('c')];
assert.deepEqual(visibleRows(collapsed).map(r=>r.row.id),['g','c']);
assert.deepEqual(allRows(removeRows(nested,['g'])).map(r=>r.id),['c']);
const info={roots:[{name:'TOP',module:''}],start:'0',end:'9007199254741999',timescale:-12,signalCount:100};
const layout={version:1,waveform:waveIdentity(info),rows:grouped,start:'9007199254740993',end:'9007199254741003',cursor:'9007199254740995',altCursor:'9007199254740994',snap:true};
assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(layout)),info),{...layout,fixedMarkers:[]});
for(const change of [v=>v.version=2,v=>v.rows.push(signal('a')),v=>v.rows[0].children[0].color=8,v=>v.waveform.roots=['Other'],v=>v.cursor='1e8',v=>v.end='1',v=>v.rows[0].children[0].width=-1]){
 const copy=structuredClone(layout);change(copy);assert.throws(()=>validateLayout(copy,info));
}
const events=[['9007199254740993','0'],['9007199254741003','1'],['9007199254741013','0']];
assert.deepEqual(transitions(events,'rise'),[9007199254741003n]);
assert.deepEqual(transitions(events,'fall'),[9007199254741013n]);
assert.equal(snapTime(9007199254741002n,transitions(events),9007199254740993n,9007199254741093n,100),9007199254741003n);
assert.equal(snapTime(9007199254741007n,transitions(events),9007199254740993n,9007199254741093n,100),9007199254741007n);
assert.equal(snapTime(44n,[44n,45n],25n,75n,853.125,3.5,341.1),45n,'pixel distance must precede tick quantization');
console.log('Waveform layout trees, cycle protection, validation, precision and snapping: PASS');

const markers={...layout,fixedMarkers:[{id:'m1',name:'start',time:layout.cursor,color:'#ff0000'},{id:'m2',name:'same time',time:layout.cursor,color:'#00ff00'}]};
assert.deepEqual(validateLayout(markers,info).fixedMarkers,markers.fixedMarkers);
for(const change of [v=>v.fixedMarkers[1].id='m1',v=>v.fixedMarkers[0].time='99999999999999999999',v=>v.fixedMarkers[0].color='red',v=>v.fixedMarkers[0].name=' ']){
 const copy=structuredClone(markers);change(copy);assert.throws(()=>validateLayout(copy,info));
}
