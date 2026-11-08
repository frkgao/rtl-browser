// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
import type { WaveSignals } from "./waveform.js";

export type WaveRow =
  | { kind: "signal"; id: string; path: string; width: number; color: number }
  | { kind: "group"; id: string; name: string; collapsed: boolean; children: WaveRow[] };
export interface FixedMarker { id: string; name: string; time: string; color: string }
export interface WaveLayout {
  fixedMarkers?: FixedMarker[];
  version: 1;
  waveform: { roots: string[]; start: string; end: string; timescale: number; signalCount: number };
  rows: WaveRow[];
  start: string; end: string; cursor: string; altCursor: string | null; snap: boolean;
}
export function allRows(rows: WaveRow[]): WaveRow[] {
  return rows.flatMap(r => r.kind === "group" ? [r, ...allRows(r.children)] : [r]);
}
export function visibleRows(rows: WaveRow[], depth = 0): { row: WaveRow; depth: number }[] {
  return rows.flatMap(row => [{ row, depth }, ...(row.kind === "group" && !row.collapsed ? visibleRows(row.children, depth+1) : [])]);
}
export function updateRows(rows: WaveRow[], change: (row: WaveRow) => WaveRow): WaveRow[] {
  return rows.map(r => change(r.kind === "group" ? { ...r, children: updateRows(r.children, change) } : r));
}
export function removeRows(rows: WaveRow[], ids: string[]): WaveRow[] {
  const selected = new Set(ids);
  return rows.filter(r => !selected.has(r.id)).map(r => r.kind === "group" ? { ...r, children: removeRows(r.children, ids) } : r);
}
export function selectedRoots(rows: WaveRow[], ids: string[]): WaveRow[] {
  const selected = new Set(ids);
  return rows.flatMap(r => selected.has(r.id) ? [r] : r.kind === "group" ? selectedRoots(r.children, ids) : []);
}
export function parentOf(rows: WaveRow[], id: string, parent: string | null = null): string | null | undefined {
  for (const r of rows) {
    if (r.id === id) return parent;
    if (r.kind === "group") { const found = parentOf(r.children,id,r.id); if (found !== undefined) return found; }
  }
}
export function childrenOf(rows: WaveRow[], id: string | null): WaveRow[] {
  if (id === null) return rows;
  const row = allRows(rows).find(r => r.id === id);
  return row?.kind === "group" ? row.children : [];
}
/** Move before a sibling, or append into a group/root; reject cycles atomically. */
export function moveRows(rows: WaveRow[], ids: string[], parent: string | null, before: string | null = null): WaveRow[] {
  const moving = selectedRoots(rows,ids);
  const descendants = new Set(allRows(moving).map(r=>r.id));
  if (!moving.length || (parent !== null && descendants.has(parent)) || (before !== null && descendants.has(before))) return rows;
  if (parent !== null && !allRows(rows).some(r=>r.id===parent && r.kind==="group")) return rows;
  if (before !== null && !childrenOf(rows,parent).some(r=>r.id===before)) return rows;
  const stripped = removeRows(rows,moving.map(r=>r.id));
  const insert = (list: WaveRow[]) => { const result=[...list]; const index=before === null ? list.length : list.findIndex(r=>r.id===before); result.splice(index,0,...moving); return result; };
  const result = parent === null ? insert(stripped) : updateRows(stripped,r => r.id===parent && r.kind==="group" ? {...r, collapsed:false, children:insert(r.children)} : r);
  if (visibleRows(updateRows(result,r=>r.kind==="group" ? {...r,collapsed:false}:r)).some(r=>r.depth>8)) throw new Error("分组最多嵌套 8 层");
  return result;
}
export function groupRows(rows: WaveRow[], ids: string[], id: string, name: string): WaveRow[] {
  if (allRows(rows).filter(r=>r.kind==="group").length>=64) throw new Error("最多创建 64 个分组");
  const selected=selectedRoots(rows,ids);
  const parent=selected.length ? parentOf(rows,selected[0].id) ?? null : null;
  const siblings=childrenOf(rows,parent);
  const first=siblings.findIndex(r=>r.id===selected[0]?.id);
  const next=siblings.slice(first+1).find(r=>!selected.some(s=>s.id===r.id))?.id ?? null;
  const group: WaveRow={kind:"group",id,name,collapsed:false,children:selected};
  const stripped=removeRows(rows,selected.map(r=>r.id));
  // Insert as a temporary root, then reuse the validated tree move.
  return moveRows([...stripped,group],[id],parent,next);
}
export function waveIdentity(info: WaveSignals): WaveLayout["waveform"] {
  return {roots:info.roots.map(r=>r.name+":"+r.module).sort(),start:info.start,end:info.end,timescale:info.timescale,signalCount:info.signalCount};
}
export function validateLayout(raw: unknown, info: WaveSignals): WaveLayout {
  const fail = () => { throw new Error("布局文件无效、超出限制，或与当前 FST 不匹配"); };
  if (!raw || typeof raw !== "object") return fail();
  const v=raw as WaveLayout;
  const expected=waveIdentity(info);
  if (v.version!==1 || !v.waveform || !Array.isArray(v.waveform.roots) ||
      JSON.stringify(v.waveform.roots)!==JSON.stringify(expected.roots) ||
      v.waveform.start!==expected.start || v.waveform.end!==expected.end ||
      v.waveform.timescale!==expected.timescale || v.waveform.signalCount!==expected.signalCount || typeof v.snap!=="boolean") return fail();
  const time=(t: unknown): t is string => typeof t==="string" && /^\d{1,20}$/.test(t) && BigInt(t)>=BigInt(info.start) && BigInt(t)<=BigInt(info.end);
  if (!time(v.start)||!time(v.end)||!time(v.cursor)||(v.altCursor!==null && !time(v.altCursor))||BigInt(v.start)>BigInt(v.end)) return fail();
  const markerIds=new Set<string>();
  if(v.fixedMarkers!==undefined&&!Array.isArray(v.fixedMarkers))return fail();
  const fixedMarkers=(v.fixedMarkers??[]).map(m=>{
    if(!m||typeof m.id!=="string"||!m.id||markerIds.has(m.id)||typeof m.name!=="string"||!m.name.trim()||m.name.length>100||!time(m.time)||!/^#[0-9a-f]{6}$/i.test(m.color))return fail();
    markerIds.add(m.id);return {id:m.id,name:m.name,time:m.time,color:m.color};
  });
  let signals=0,groups=0;
  const ids=new Set<string>(), paths=new Set<string>();
  const check=(rows: WaveRow[],depth: number): WaveRow[] => {
    if (!Array.isArray(rows)||depth>8||rows.length>128) return fail();
    return rows.map(r=> {
      if (!r || typeof r.id!=="string" || !r.id || r.id.length>4096 || ids.has(r.id)) return fail();
      ids.add(r.id);
      if (r.kind==="group") {
        if (++groups>64 || typeof r.name!=="string" || !r.name.trim() || r.name.length>100 || typeof r.collapsed!=="boolean") return fail();
        return {kind:r.kind,id:r.id,name:r.name,collapsed:r.collapsed,children:check(r.children,depth+1)};
      }
      if (r.kind!=="signal" || ++signals>64 || typeof r.path!=="string" || !r.path || r.path.length>4096 || paths.has(r.path) || !Number.isInteger(r.width)||r.width<1||r.width>65536||!Number.isInteger(r.color)||r.color<0||r.color>7) return fail();
      paths.add(r.path);
      return {kind:r.kind,id:r.id,path:r.path,width:r.width,color:r.color};
    });
  };
  return {version:1,waveform:expected,rows:check(v.rows,0),start:v.start,end:v.end,cursor:v.cursor,altCursor:v.altCursor,snap:v.snap,fixedMarkers};
}
export type EdgeKind = "any" | "rise" | "fall";
/** The first sample is a window baseline, not evidence of a transition. */
export function transitions(changes: [string,string][], kind: EdgeKind = "any"): bigint[] {
  return changes.slice(1).flatMap(([time,value],i) => {
    const previous=changes[i][1];
    return (kind==="rise" ? previous==="0"&&value==="1" : kind==="fall" ? previous==="1"&&value==="0" : previous!==value) ? [BigInt(time)] : [];
  });
}
export function snapTime(time: bigint, edges: bigint[], start: bigint, end: bigint, width: number, pixels=3.5, clickPosition?: number): bigint {
  if (!edges.length || end<=start || width<=0) return time;
  // Compare positions before quantizing the click to an integer tick. Otherwise
  // a click just left of an edge can incorrectly snap to the preceding tick.
  const x=(t:bigint)=>Number((t-start)*1000000n/(end-start))/1000000*width;
  const clicked=clickPosition ?? x(time);
  let nearest=edges[0], distance=Math.abs(x(nearest)-clicked);
  for(const edge of edges){const d=Math.abs(x(edge)-clicked);if(d<distance){distance=d;nearest=edge;}}
  return distance<=pixels ? nearest:time;
}
