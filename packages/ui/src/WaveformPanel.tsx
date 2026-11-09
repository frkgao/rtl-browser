// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
import { layoutStorage } from "./desktop.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { RtlClient } from "../../client/src/api.js";
import type { WaveSignal, WaveSignals, WaveValues } from "../../contracts/src/waveform.js";
import { WaveCanvas, formatValue } from "./WaveCanvas.js";
import { allRows, visibleRows, updateRows, removeRows, selectedRoots, parentOf, childrenOf, moveRows, groupRows, waveIdentity, validateLayout, type WaveRow, type WaveLayout, type EdgeKind, type FixedMarker } from "../../contracts/src/waveLayout.js";
import { PathPicker } from "./PathPicker.js";

export const waveName = (name: string) => name.replace(/\s+\[[^\]]+\]$/, "");
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export function WaveformPanel({ client, projectId, snapshotId, addRequest, onJump }: {
  client: RtlClient; projectId: string; snapshotId: string; addRequest: { path: string; paths?: string[]; seq: number } | null; onJump: (signal: WaveSignal) => Promise<void>;
}) {
  const [file, setFile] = useState("");
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState(false);
  const [info, setInfo] = useState<WaveSignals | null>(null);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows,setRows]=useState<WaveRow[]>([]);
  const [selection,setSelection]=useState<string[]>([]);
  const [altCursor,setAltCursor]=useState<bigint|null>(null);
  const [showHierarchy,setShowHierarchy]=useState(false);
  const [snap,setSnap]=useState(true);
  const [fixedMarkers,setFixedMarkers]=useState<FixedMarker[]>([]);
  const [markerEditor,setMarkerEditor]=useState<{id:string|null;name:string;color:string;time:string}|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [layoutBusy,setLayoutBusy]=useState(false);
  const [contextMenu,setContextMenu]=useState<{x:number;y:number}|null>(null);
  const [editor,setEditor]=useState<{id:string|null;name:string}|null>(null);
  const importRef=useRef<HTMLInputElement>(null);
  const dragIds=useRef<string[]>([]);
  const edgeGeneration=useRef(0);
  const layoutGeneration=useRef(0);
  const [edgeBusy,setEdgeBusy]=useState(false);
  const [signals, setSignals] = useState<WaveSignal[]>([]);
  const [values, setValues] = useState<WaveValues | null>(null);
  const [start, setStart] = useState(0n), [end, setEnd] = useState(100n), [cursor, setCursor] = useState(0n);
  const markerGroups=useMemo(()=>{
    const groups=new Map<string,FixedMarker[]>();
    for(const marker of fixedMarkers){
      if(BigInt(marker.time)<start||BigInt(marker.time)>end)continue;
      groups.set(marker.time,[...(groups.get(marker.time)??[]),marker]);
    }
    return [...groups].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1).map(([time,markers])=>({
      time,markers,position:Number((BigInt(time)-start)*1000000n/(end-start||1n))/10000,
    }));
  },[fixedMarkers,start,end]);
  const selected=selection.at(-1) ?? null;
  const flat=useMemo(()=>allRows(rows),[rows]);
  const visible=useMemo(()=>visibleRows(rows),[rows]);
  const selectedSignal=signals.find(s=>s.path===selected);
  const handlesKey=[...new Set(signals.map(s=>s.handle))].sort((a,b)=>a-b).join(",");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valueRead=useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0), searchGeneration = useRef(0);
  const consumed = useRef(0);
  useEffect(()=>()=>{generation.current++;searchGeneration.current++;edgeGeneration.current++;},[]);
  useEffect(()=>{edgeGeneration.current++;setEdgeBusy(false);},[selected,file]);
  useEffect(()=>{
    if(!contextMenu)return;
    const close=(e:PointerEvent)=>{if(!(e.target as Element)?.closest(".wave-context-menu"))setContextMenu(null);};
    document.addEventListener("pointerdown",close);return()=>document.removeEventListener("pointerdown",close);
  },[contextMenu]);
  async function open(p: string) {
    const gen = ++generation.current;
    setLayoutBusy(false);setEdgeBusy(false);setContextMenu(null);
    searchGeneration.current++;
    setDraft(p); setFile(""); setInfo(null); setSignals([]); setValues(null); setSelection([]); setRows([]); setAltCursor(null); setFixedMarkers([]);setMarkerEditor(null); setNotice(null); setSnap(true); setEditor(null);
    setBusy(true); setError(null);
    try {
      const data = await client.openWaveform(p, projectId, snapshotId);
      if (gen !== generation.current) return;
      setFile(p); setDraft(p); setInfo(data); setQuery(""); setOffset(0); setSignals([]); setValues(null);
      const a = BigInt(data.start), b = BigInt(data.end);
      setStart(a); setEnd(b > a + 100n ? a + 100n : b); setCursor(a+(b>a+100n?100n:b-a)/2n); setAltCursor(a+(b>a+100n?100n:b-a)/2n);
      try {
        const saved=await layoutStorage.getItem(layoutKey(p));
        if(saved) await restoreLayout(JSON.parse(saved),p,data,gen);
      } catch(e) { if(gen===generation.current) setError(`波形已打开，但保存的布局未恢复：${message(e)}`); }
    } catch (e) { if (gen === generation.current) setError(message(e)); }
    finally { if (gen === generation.current) setBusy(false); }
  }
  useEffect(() => {
    if (!file) return;
    const gen = ++searchGeneration.current;
    const timer = setTimeout(() => {
      void client.waveSignals(file, query, offset).then(data => { if (gen === searchGeneration.current) setInfo(data); })
        .catch(e => { if (gen === searchGeneration.current) setError(message(e)); });
    }, 180);
    return () => { clearTimeout(timer); searchGeneration.current++; };
  }, [client, file, query, offset]);
  function add(signal: WaveSignal) {
    if (signals.length >= 64 && !signals.some(s => s.path === signal.path)) { setError("最多显示 64 个信号，请先移除部分信号。"); return false; }
    setSignals(old => old.some(s => s.path === signal.path) ? old : [...old, signal].slice(0,64));
    setRows(old=>allRows(old).some(r=>r.kind==="signal"&&r.path===signal.path) ? old:[...old,{kind:"signal",id:signal.path,path:signal.path,width:signal.width,color:0}]);
    setSelection([signal.path]);
    return true;
  }
  useEffect(() => {
    if (layoutBusy) return;
    if (!addRequest || consumed.current === addRequest.seq) return;
    if (!file) { setError("请先打开 FST 文件，打开后会添加所选源码信号。"); return; }
    let cancelled = false;
    void (async()=>{
      for(const candidate of addRequest.paths ?? [addRequest.path]) {
        if(cancelled)return null;
        const data=await client.waveSignals(file,candidate);
        const matches=data.signals.filter(s=>[...s.scope,waveName(s.name)].join(".")===candidate);
        if(matches.length)return {matches,candidate};
      }
      return {matches:[] as WaveSignal[],candidate:addRequest.path};
    })().then(result => {
      if (cancelled||!result) return;
      consumed.current = addRequest.seq;
      const {matches,candidate}=result;
      if (matches.length === 1) { if (add(matches[0])) {setError(null);if(candidate!==addRequest.path)setNotice(`内部线网未被 dump，已添加等价端口：${candidate}`);} }
      else { setQuery(addRequest.path); setOffset(0); setError(matches.length ? "匹配多个波形信号，请在搜索结果中选择。" : "FST 中没有该实例信号；请检查仿真顶层、dump 范围和 RTL 版本。"); }
    }).catch(e => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; };
  }, [addRequest, file, client, layoutBusy]);
  useEffect(() => {
    if (!file || !handlesKey) { setValues(null); return; }
    let cancelled = false; setBusy(true); setValues(null);
    // Coalesce wheel bursts and allow only one value reader at a time.
    // Superseded windows never start a worker or overwrite the latest window.
    const timer=setTimeout(()=>{
      valueRead.current=valueRead.current.then(async()=>{
        if(cancelled)return;
        try {
          const data=await client.waveValues(file,handlesKey.split(",").map(Number),String(start),String(end));
          if(!cancelled)setValues(data);
        } catch(e) { if(!cancelled)setError(message(e)); }
        finally { if(!cancelled)setBusy(false); }
      });
    },40);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, file, handlesKey, start, end]);
  function range(a: bigint, b: bigint) {
    if (!info) return;
    const low = BigInt(info.start), high = BigInt(info.end), span = b-a > 0n ? b-a : 1n;
    if (a < low) { a=low; b=a+span; }
    if (b > high) { b=high; a=b-span < low ? low : b-span; }
    setStart(a); setEnd(b);
  }
  const panRemainder=useRef(0n);
  function pan(fraction:number) {
    if(!info||layoutBusy)return;
    const scaled=(end-start)*BigInt(Math.round(fraction*1000000))+panRemainder.current;
    const offset=scaled/1000000n;
    panRemainder.current=scaled%1000000n;
    if(offset)range(start+offset,end+offset);
  }
  function zoom(inward:boolean,anchor=.5) {
    if(!info||layoutBusy)return;
    const span=end-start || 1n, next=inward ? (span/2n || 1n) : span*2n;
    const fraction=BigInt(Math.round(Math.max(0,Math.min(1,anchor))*1000000));
    const a=start+(span-next)*fraction/1000000n;
    range(a,a+next);
  }
  function layoutKey(p: string) { return `rtl.wave.layout.v1:${p}`; }
  function layout(): WaveLayout {
    return {version:1,waveform:waveIdentity(info!),rows,start:String(start),end:String(end),cursor:String(cursor),altCursor:altCursor===null?null:String(altCursor),snap,fixedMarkers};
  }
  async function save(download=false) {
    if(!file || !info) return;
    try {
      const text=JSON.stringify(layout(),null,2);
      await layoutStorage.setItem(layoutKey(file),text);
      if(download) {
        const url=URL.createObjectURL(new Blob([text],{type:"application/json"}));
        const a=document.createElement("a");a.href=url;a.download="waveform-layout.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
      setNotice(download ? "布局已导出并保存到本机":"布局已保存；手动重新打开匹配的 FST 后恢复"); setError(null);
    } catch(e) { setError(`保存布局失败：${message(e)}`); }
  }
  async function restoreLayout(raw: unknown,p=file,data=info,gen=generation.current) {
    if(!p || !data) throw new Error("请先手动打开并校验 FST 文件");
    const operation=++layoutGeneration.current;
    const saved=validateLayout(raw,data);
    const savedSignals=allRows(saved.rows).filter((r):r is Extract<WaveRow,{kind:"signal"}>=>r.kind==="signal");
    setLayoutBusy(true);setEditor(null);setMarkerEditor(null);setContextMenu(null);
    try {
      const resolved=await client.resolveWaveSignals(p,savedSignals.map(s=>s.path));
      if(gen!==generation.current||operation!==layoutGeneration.current)return;
      const missing=savedSignals.filter(s=>resolved.signals.filter(v=>v.path===s.path&&v.width===s.width).length!==1);
      if(missing.length) throw new Error(`信号缺失、位宽变化或路径不唯一：${missing.map(s=>s.path).join("、")}`);
      if(gen!==generation.current) return;
      setSignals(resolved.signals);setRows(saved.rows);setSelection([]);
      setStart(BigInt(saved.start));setEnd(BigInt(saved.end));setCursor(BigInt(saved.cursor));setAltCursor(saved.altCursor===null?(BigInt(saved.start)+BigInt(saved.end))/2n:BigInt(saved.altCursor));setSnap(saved.snap);setFixedMarkers(saved.fixedMarkers??[]);setMarkerEditor(null);
      setNotice("布局已恢复，所有信号已重新匹配当前 FST");setError(null);
    } finally { if(gen===generation.current&&operation===layoutGeneration.current)setLayoutBusy(false); }
  }
  async function importLayout(f: File) {
    try {
      if(f.size>1024*1024)throw new Error("布局文件不能超过 1 MiB");
      await restoreLayout(JSON.parse(await f.text()));
    }catch(e){setError(`恢复布局失败：${message(e)}`);}
  }
  function remove(ids: string[]) {
    const next=removeRows(rows,ids),remaining=new Set(allRows(next).filter(r=>r.kind==="signal").map(r=>r.path));
    setRows(next);setSignals(old=>old.filter(s=>remaining.has(s.path)));setSelection([]);
  }
  function select(id: string,e: React.MouseEvent) {
    if(e.ctrlKey||e.metaKey) {setSelection(old=>old.includes(id)?old.filter(v=>v!==id):[...old,id]);return;}
    if(e.shiftKey && selected) {
      const a=visible.findIndex(r=>r.row.id===selected),b=visible.findIndex(r=>r.row.id===id);
      if(a>=0&&b>=0){setSelection(visible.slice(Math.min(a,b),Math.max(a,b)+1).map(r=>r.row.id));return;}
    }
    setSelection([id]);
  }
  function applyColor(color: number) {
    const ids=new Set(allRows(selectedRoots(rows,selection)).map(r=>r.id));
    setRows(old=>updateRows(old,r=>r.kind==="signal"&&ids.has(r.id)?{...r,color}:r));
  }
  function move(ids: string[],parent: string|null,before:string|null=null) {
    try {setRows(moveRows(rows,ids,parent,before));}catch(e){setError(message(e));}
  }
  function reorder(direction:number) {
    if(!selected)return;
    const parent=parentOf(rows,selected)??null,list=childrenOf(rows,parent);
    const positions=list.map((r,i)=>selection.includes(r.id)?i:-1).filter(i=>i>=0);
    if(!positions.length)return;
    const index=direction<0?positions[0]-1:positions.at(-1)!+2;
    if(index<0||index>list.length)return;
    move(selection,parent,list[index]?.id??null);
  }
  function finishGroup() {
    if(!editor?.name.trim())return;
    try {
      if(editor.id) setRows(updateRows(rows,r=>r.kind==="group"&&r.id===editor.id?{...r,name:editor.name.trim()}:r));
      else {const id=`group:${crypto.randomUUID()}`;setRows(groupRows(rows,selection,id,editor.name.trim()));setSelection([id]);}
      setEditor(null);
    }catch(e){setError(message(e));}
  }
  function setMarker(time: bigint,alternate=false) {
    edgeGeneration.current++;setEdgeBusy(false);
    if(alternate)setAltCursor(time);else setCursor(time);
  }
  async function edge(direction: number, kind: EdgeKind="any",alternate=false) {
    if(edgeBusy)return;
    if(!selectedSignal||!file||!info){setNotice("请先选择一个波形信号");return;}
    const position=alternate?(altCursor??cursor):cursor;
    const gen=++edgeGeneration.current, fileGen=generation.current;
    setEdgeBusy(true);
    try {
      const result=await client.waveEdge(file,selectedSignal.handle,String(position),direction,kind);
      if(gen!==edgeGeneration.current||fileGen!==generation.current)return;
      if(result.time===null){setNotice("已到达文件边界，没有符合条件的跳变");return;}
      const time=BigInt(result.time);setMarker(time,alternate);setNotice(null);
      if(time<start||time>end){const half=(end-start)/2n||1n;range(time-half,time+half);}
    }catch(e){if(gen===edgeGeneration.current&&fileGen===generation.current)setError(message(e));}
    finally{if(gen===edgeGeneration.current)setEdgeBusy(false);}
  }

  function drop(e:React.DragEvent,parent:string|null,before:string|null=null){e.preventDefault();e.stopPropagation();move(dragIds.current,parent,before);dragIds.current=[];}
  return <div data-search-scope className="wave-panel" tabIndex={0} onKeyDown={e => {
    if(e.key==="Escape"){setContextMenu(null);setEditor(null);setMarkerEditor(null);}
    if(layoutBusy)return;
    if ((e.target as HTMLElement).closest("input,select,textarea,button[role=combobox]")) return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();save();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){e.preventDefault();setSelection(visible.map(r=>r.row.id));return;}
    if(e.ctrlKey||e.metaKey)return;
    if(e.key.toLowerCase()==="h"){e.preventDefault();setShowHierarchy(v=>!v);return;}
    if(e.key==="+"||e.key==="="||e.key==="-"){e.preventDefault();zoom(e.key!=="-");return;}
    if(e.key==="Home"&&info){e.preventDefault();range(BigInt(info.start),BigInt(info.end));return;}
    if(e.altKey&&(e.key==="ArrowUp"||e.key==="ArrowDown")){e.preventDefault();reorder(e.key==="ArrowUp"?-1:1);return;}
    if(!e.altKey&&(e.key==="ArrowUp"||e.key==="ArrowDown")){e.preventDefault();const index=visible.findIndex(r=>r.row.id===selected),next=Math.max(0,Math.min(visible.length-1,index+(e.key==="ArrowUp"?-1:1)));if(visible[next])setSelection([visible[next].row.id]);return;}
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"||e.key.toLowerCase()==="n") {e.preventDefault();edge(e.key==="ArrowLeft"||(e.key.toLowerCase()==="n"&&e.shiftKey)?-1:1,"any",e.altKey);}
    if(e.key.toLowerCase()==="g"&&file){e.preventDefault();setEditor({id:null,name:"新分组"});}
    if(e.key==="F2"){const r=flat.find(r=>r.id===selected);if(r?.kind==="group"){e.preventDefault();setEditor({id:r.id,name:r.name});}}
    if(/^[1-8]$/.test(e.key))applyColor(Number(e.key)-1);
    if(e.key==="Delete"){e.preventDefault();remove(selection);}
  }}>
    <div className="wave-toolbar">
      <input aria-label="FST 文件路径" value={draft} onChange={e => setDraft(e.target.value)} placeholder="FST 文件路径" onKeyDown={e => { if(e.key === "Enter") void open(draft); }} />
      <button onClick={() => setPicker(true)}>浏览…</button><button disabled={!draft || busy} onClick={() => void open(draft)}>打开 FST</button>
      <button disabled={!info||layoutBusy} onClick={()=>setMarkerEditor({id:null,name:"",color:"#e6a23c",time:String(cursor)})}>添加固定游标</button>
      <button disabled={!info} aria-pressed={showHierarchy} title="切换信号名称与完整层次路径 (H)" onClick={()=>setShowHierarchy(v=>!v)}>显示层次 (H)</button>
      <button disabled={!info} onClick={() => range(BigInt(info!.start),BigInt(info!.end))} title="显示整个文件时间范围 (Home)">全览</button>
      <button disabled={!info} title="Zoom In (+)：Ctrl+滚轮向上；拖选波形区域放大" onClick={() => zoom(true)}>放大</button>
      <button disabled={!info} title="Zoom Out (-)：Ctrl+滚轮向下" onClick={() => zoom(false)}>缩小</button>
      <button disabled={!info} onClick={() => range(start-(end-start)/2n,end-(end-start)/2n)}>←</button>
      <button disabled={!info} onClick={() => range(start+(end-start)/2n,end+(end-start)/2n)}>→</button>
      <span>{busy ? "读取中…" : info ? `${start}–${end} · 1 tick = 10^${info.timescale} s · 游标 ${cursor}` : "源码信号按 Ctrl+W 添加；双击波形跳转 RTL"}</span>
    </div>
    {file && <div className="muted">缩放：放大 / 缩小（+ / −） · Ctrl+滚轮以鼠标位置缩放 · Shift+滚轮前后平移 · 左键拖选曲线区域放大 · Home 全览</div>}
    {file && <details className="wave-settings"><summary>分组、颜色与游标设置</summary><fieldset disabled={layoutBusy} className="wave-tools">
      <button onClick={()=>setEditor({id:null,name:"新分组"})}>分组 (G)</button>
      <button disabled={!selection.length} onClick={()=>reorder(-1)} title="Alt+↑">上移</button>
      <button disabled={!selection.length} onClick={()=>reorder(1)} title="Alt+↓">下移</button>
      <label>移入组 <select aria-label="移入分组" value="" disabled={!selection.length} onChange={e=>move(selection,e.target.value==="root"?null:e.target.value)}><option value="" disabled>选择…</option><option value="root">根目录</option>{flat.filter(r=>r.kind==="group").map(r=><option key={r.id} value={r.id}>{r.kind==="group"?r.name:""}</option>)}</select></label>
      <span className="wave-palette" aria-label="波形颜色">{Array.from({length:8},(_,i)=><button key={i} aria-label={`颜色 ${i+1}`} title={`颜色 ${i+1}（快捷键 ${i+1}）`} disabled={!selection.length} style={{background:`var(--wave-${i})`}} onClick={()=>applyColor(i)} />)}</span>
      <button disabled={layoutBusy} onClick={()=>save()}>保存布局</button><button disabled={layoutBusy} onClick={()=>save(true)}>导出布局</button>
      <button disabled={layoutBusy} onClick={async ()=>{try{const saved=await layoutStorage.getItem(layoutKey(file));if(!saved)throw new Error("没有已保存的布局");void restoreLayout(JSON.parse(saved)).catch(e=>setError(message(e)));}catch(e){setError(message(e));}}}>恢复布局</button>
      <button disabled={layoutBusy} onClick={()=>importRef.current?.click()}>导入布局</button>
      <input ref={importRef} type="file" accept=".json" hidden aria-label="导入波形布局文件" onChange={e=>{const f=e.target.files?.[0];if(f)void importLayout(f);e.target.value="";}} />
      <label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)} />边沿吸附</label>

      <button disabled={edgeBusy} onClick={()=>void edge(-1)}>上一跳变</button><button disabled={edgeBusy} onClick={()=>void edge(1)}>下一跳变</button>
      <button disabled={edgeBusy||selectedSignal?.width!==1} onClick={()=>void edge(1,"rise")}>下一上升沿</button><button disabled={edgeBusy||selectedSignal?.width!==1} onClick={()=>void edge(1,"fall")}>下一下降沿</button>
      <button disabled={edgeBusy||selectedSignal?.width!==1} onClick={()=>void edge(-1,"rise")}>上一上升沿</button><button disabled={edgeBusy||selectedSignal?.width!==1} onClick={()=>void edge(-1,"fall")}>上一下降沿</button>


    </fieldset></details>}
    {file && <span className="wave-markers" aria-live="polite">主游标={String(cursor)} · 副游标={altCursor===null?"—":String(altCursor)} · Δ(副−主)={altCursor===null?"—":String(altCursor-cursor)} tick</span>}
    {markerEditor && <form className="wave-group-editor" onSubmit={e=>{
      e.preventDefault();if(!markerEditor.name.trim())return;
      const marker={...markerEditor,id:markerEditor.id??crypto.randomUUID(),name:markerEditor.name.trim()};
      setFixedMarkers(old=>markerEditor.id?old.map(m=>m.id===marker.id?marker:m):[...old,marker]);setMarkerEditor(null);
    }}>
      <label>游标名称 <input autoFocus aria-label="固定游标名称" maxLength={100} required value={markerEditor.name} onChange={e=>setMarkerEditor({...markerEditor,name:e.target.value})}/></label>
      <label>颜色 <input type="color" aria-label="固定游标颜色" value={markerEditor.color} onChange={e=>setMarkerEditor({...markerEditor,color:e.target.value})}/></label>
      <span>位置 {markerEditor.time} tick</span><button type="submit">保存固定游标</button><button type="button" onClick={()=>setMarkerEditor(null)}>取消</button>
    </form>}
    {fixedMarkers.length>0 && <details className="wave-fixed-list"><summary>固定游标（{fixedMarkers.length}）</summary>{fixedMarkers.map(m=><div key={m.id}>
      <button style={{borderLeft:`3px solid ${m.color}`}} onClick={()=>setMarkerEditor({...m})}>{m.name}</button> <span>{m.time} tick · Δ主={String(BigInt(m.time)-cursor)} tick</span>
      <button onClick={()=>{const t=BigInt(m.time),span=end-start||1n;range(t-span/2n,t-span/2n+span);}}>定位</button>
      <button aria-label={`删除固定游标 ${m.name}`} onClick={()=>setFixedMarkers(old=>old.filter(x=>x.id!==m.id))}>删除</button>
    </div>)}</details>}
    {editor && <form className="wave-group-editor" onSubmit={e=>{e.preventDefault();finishGroup();}}><input autoFocus aria-label="分组名称" maxLength={100} value={editor.name} onChange={e=>setEditor({...editor,name:e.target.value})} /><button type="submit">确定分组</button><button type="button" onClick={()=>setEditor(null)}>取消</button></form>}
    {notice && <div className="muted" role="status">{notice}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {values?.truncated && <div className="warn-text">跳变数量超过上限，当前显示不完整；请放大时间区间。</div>}
    {!file && !busy && <div className="panel-empty">当前未加载波形。请手动打开与 RTL 顶层匹配的 FST 文件。</div>}
    {file && <div className="muted" role="status" title={file}>已加载：{file} · 顶层匹配：{info?.roots.map(r => r.name).join("、")}（顶层匹配不代表 RTL 版本完全一致）</div>}
    {file && <div className="wave-content">
      <aside className="wave-search">
        <input data-search-input title="Ctrl+F 聚焦搜索" aria-label="搜索波形信号" placeholder="搜索层次 / 信号" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
        <div>{info?.total ?? 0} 个匹配 <button disabled={offset===0} onClick={() => setOffset(Math.max(0,offset-500))}>上一页</button><button disabled={!info || offset+500>=info.total} onClick={() => setOffset(offset+500)}>下一页</button></div>
        <div className="wave-results">{info?.signals.map(s => <button key={s.path} title={s.path} disabled={layoutBusy||signals.length>=64} onClick={() => add(s)}>{s.path} [{s.width}] +</button>)}</div>
      </aside>
      <div className="wave-traces" inert={layoutBusy} aria-busy={layoutBusy}>
        <div className="wave-time-header">
        <div className="wave-ruler"><span className="wave-ruler-label">时间 (tick)</span><div>{Array.from({length:5}, (_,i) => <span key={i}>{String(start+(end-start)*BigInt(i)/4n)}</span>)}</div><span style={{width:28}} /></div>
        {fixedMarkers.length>0 && <div className="wave-ruler wave-fixed-ruler"><span className="wave-ruler-label">固定游标</span><div className="wave-marker-track">
          {markerGroups.map((group,i)=><div key={group.time} className="wave-marker-cluster" style={{left:group.position===100?"auto":`${group.position}%`,right:group.position===100?0:undefined,maxWidth:group.position===100?100:`${(markerGroups[i+1]?.position??100)-group.position}%`}}>
            {group.markers.map(m=><button key={m.id} title={`${m.name}: ${m.time} tick（点击编辑）`} style={{borderLeft:`2px solid ${m.color}`,color:m.color}} onClick={()=>setMarkerEditor({...m})}>{m.name}</button>)}
          </div>)}
        </div><span style={{width:28}}/></div>}
        </div>
        {!signals.length && <p className="muted">点击左侧信号添加，或在源码信号上按 Ctrl+W。双击信号名称或波形可跳转 RTL；左右方向键移动到所选信号的相邻跳变；G 分组，1–8 改色。</p>}
        {visible.map(({row,depth}) => {
          const drag={onContextMenu:(e:React.MouseEvent)=>{e.preventDefault();e.stopPropagation();if(!selection.includes(row.id))setSelection([row.id]);setContextMenu({x:Math.min(e.clientX,window.innerWidth-190),y:Math.min(e.clientY,window.innerHeight-180)});},draggable:!layoutBusy,onDragStart:(e:React.DragEvent)=>{dragIds.current=selection.includes(row.id)?selection:[row.id];e.dataTransfer.setData("text/plain",row.id);},onDragOver:(e:React.DragEvent)=>e.preventDefault(),onDrop:(e:React.DragEvent)=>drop(e,parentOf(rows,row.id)??null,row.id)};
          if(row.kind==="group")return <div key={row.id} className={`wave-group${selection.includes(row.id)?" selected":""}`} data-row-id={row.id} {...drag} onClick={e=>select(row.id,e)}>
            <span style={{width:depth*14}} /><button aria-label={`${row.collapsed?"展开":"折叠"}分组 ${row.name}`} onClick={e=>{e.stopPropagation();setRows(updateRows(rows,r=>r.id===row.id&&r.kind==="group"?{...r,collapsed:!r.collapsed}:r));}}>{row.collapsed?"▸":"▾"}</button>
            <button className="wave-group-name" onDoubleClick={()=>setEditor({id:row.id,name:row.name})}>{row.name}</button>
            <button onClick={e=>{e.stopPropagation();setEditor({id:row.id,name:row.name});}} aria-label={`重命名分组 ${row.name}`}>重命名</button>
            <span className="wave-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,row.id)}>拖入此组</span>
            <button aria-label={`解散分组 ${row.name}`} onClick={e=>{e.stopPropagation();const moved=moveRows(rows,row.children.map(r=>r.id),parentOf(rows,row.id)??null,row.id);setRows(removeRows(moved,[row.id]));setSelection([]);}}>解散</button>
            <button aria-label={`删除分组 ${row.name}`} onClick={e=>{e.stopPropagation();remove([row.id]);}}>×</button>
          </div>;
          const s=signals.find(s=>s.path===row.path);if(!s)return null;
          const changes=values?.rows.find(r=>r.handle===s.handle)?.changes??[];
          const value=values?.truncated&&cursor>BigInt(changes.at(-1)?.[0]??start)?undefined:changes.filter(c=>BigInt(c[0])<=cursor).at(-1)?.[1];
          return <div key={row.id} data-row-id={row.id} className={`wave-row${selection.includes(row.id)?" selected":""}`} onClick={e=>select(row.id,e)} {...drag}>
            <button className="wave-label" style={{paddingLeft:6+depth*14,borderLeft:`3px solid var(--wave-${row.color})`}} title={s.path} onDoubleClick={()=>void onJump(s).catch(e=>setError(message(e)))}>{showHierarchy?s.path:waveName(s.name)}<small>{value===undefined?"—":formatValue(value)}</small></button>
            <WaveCanvas fixedMarkers={fixedMarkers} onPan={pan} onRange={range} onZoom={zoom} signal={s} truncated={values?.truncated??false} changes={changes} start={start} end={end} cursor={cursor} altCursor={altCursor} color={row.color} snap={snap} onCursor={(time,alternate)=>setMarker(time,alternate)} onJump={()=>void onJump(s).catch(e=>setError(message(e)))} />
            <button aria-label={`移除 ${s.path}`} onClick={e=>{e.stopPropagation();remove([row.id]);}}>×</button>
          </div>;
        })}
        <div className="wave-drop wave-root-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,null)}>拖到此处：移出分组并放到列表末尾</div>
      </div>
    </div>}
    {contextMenu && <div className="wave-context-menu" role="menu" aria-label="波形操作" style={{left:contextMenu.x,top:contextMenu.y}}>
      <div>信号颜色</div><div className="wave-palette">{Array.from({length:8},(_,i)=><button key={i} role="menuitem" aria-label={`设置颜色 ${i+1}`} style={{background:`var(--wave-${i})`}} onClick={()=>{applyColor(i);setContextMenu(null);}} />)}</div>
      <button role="menuitem" onClick={()=>{setEditor({id:null,name:"新分组"});setContextMenu(null);}}>将选中项分组</button>
      <button role="menuitem" onClick={()=>{remove(selection);setContextMenu(null);}}>移除选中项</button>
    </div>}
    {picker && <PathPicker client={client} mode="file" onClose={() => setPicker(false)} onPick={p => { setPicker(false); void open(p); }} />}
  </div>;
}
