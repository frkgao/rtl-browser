// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useRef, useState } from "react";
import type { WaveSignal } from "../../contracts/src/waveform.js";
import { snapTime, transitions, type FixedMarker } from "../../contracts/src/waveLayout.js";
export function WaveCanvas({ signal, changes, start, end, cursor, altCursor, color, snap, truncated, onCursor, onJump, onRange, onZoom, onPan, fixedMarkers }: {
  fixedMarkers: FixedMarker[];
  signal: WaveSignal; changes: [string, string][]; start: bigint; end: bigint; cursor: bigint;
  altCursor: bigint | null; color: number; snap: boolean;
  onPan: (fraction: number) => void;
  onRange: (start: bigint, end: bigint) => void; onZoom: (inward: boolean, anchor: number) => void;
  truncated: boolean; onCursor: (time: bigint, alternate: boolean) => void; onJump: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{from:number;to:number}|null>(null);
  const gesture = useRef<{from:number;to:number;moved:boolean;button:number;start:bigint;end:bigint}|null>(null);
  const suppressClick = useRef(false);
  const position = (clientX:number) => {
    const r=ref.current!.getBoundingClientRect();
    return Math.max(0,Math.min(r.width,clientX-r.left));
  };
  useEffect(() => {
    const canvas=ref.current!;
    const wheel=(e:WheelEvent)=>{
      const delta=e.deltaY||e.deltaX;
      if((!e.ctrlKey&&!e.shiftKey)||!delta)return;
      e.preventDefault();e.stopPropagation();
      if(e.ctrlKey)onZoom(delta<0,position(e.clientX)/canvas.clientWidth);
      else onPan(delta*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientWidth:1)/canvas.clientWidth);
    };
    canvas.addEventListener("wheel",wheel,{passive:false});
    return()=>canvas.removeEventListener("wheel",wheel);
  },[onZoom,onPan]);
  useEffect(() => {
    const canvas = ref.current!;
    const draw = () => {
      const width = canvas.clientWidth, height = 32, dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr; canvas.height = height * dpr;
      const c = canvas.getContext("2d")!; c.scale(dpr, dpr);
      const span = end - start || 1n;
      const x = (t: bigint) => Number((t - start) * 1000000n / span) / 1000000 * width;
      c.font = "11px monospace";
      const style=getComputedStyle(canvas);
      const normalColor=style.getPropertyValue(`--wave-${color}`).trim(),xzColor=style.getPropertyValue("--wave-xz").trim();
      for (let i = 0; i < changes.length; i++) {
        const [t, v] = changes[i];
        const a = Math.max(0, x(BigInt(t))), b = Math.min(width, i + 1 < changes.length ? x(BigInt(changes[i + 1][0])) : truncated ? a : width);
        if (b < 0 || a > width) continue;
        c.strokeStyle = /[xz]/i.test(v) ? xzColor : normalColor; c.fillStyle = c.strokeStyle;
        c.beginPath();
        if (signal.width === 1 && /^[01]$/.test(v)) {
          const y = v === "1" ? 6 : 26;
          c.moveTo(a, 6); c.lineTo(a, 26); c.moveTo(a, y); c.lineTo(b, y);
        } else {
          c.moveTo(a, 16); c.lineTo(a + Math.min(3, (b-a)/2), 6); c.lineTo(b- Math.min(3, (b-a)/2), 6); c.lineTo(b,16);
          c.lineTo(b- Math.min(3, (b-a)/2),26); c.lineTo(a+ Math.min(3, (b-a)/2),26); c.closePath();
          if (b-a > 35) c.fillText(formatValue(v), a+5,20, b-a-10);
        }
        c.stroke();
      }
      if(drag && Math.abs(drag.to-drag.from)>=5){
        c.fillStyle=normalColor;c.globalAlpha=.22;
        c.fillRect(Math.min(drag.from,drag.to),0,Math.abs(drag.to-drag.from),height);
        c.globalAlpha=1;
      }
      for(const marker of fixedMarkers){
        c.strokeStyle=marker.color;c.setLineDash([2,3]);c.beginPath();
        c.moveTo(x(BigInt(marker.time)),0);c.lineTo(x(BigInt(marker.time)),height);c.stroke();
      }
      for (const [time,paint] of [[cursor,"--wave-marker-a"],[altCursor,"--wave-marker-b"]] as const) {
        if(time===null) continue;
        c.strokeStyle=getComputedStyle(canvas).getPropertyValue(paint).trim();
        c.setLineDash(paint==="--wave-marker-b" ? [3,2]:[]); c.beginPath(); c.moveTo(x(time),0); c.lineTo(x(time),32); c.stroke();
      }
    };
    const observer = new ResizeObserver(draw); observer.observe(canvas); draw();
    const theme=new MutationObserver(draw); theme.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme","data-contrast"]});
    return () => { observer.disconnect(); theme.disconnect(); };
  }, [changes, start, end, cursor, altCursor, color, signal.width, truncated, drag, fixedMarkers]);
  function place(e: React.MouseEvent<HTMLCanvasElement>, alternate: boolean) {
    const r=e.currentTarget.getBoundingClientRect();
    const time=start+(end-start)*BigInt(Math.round(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*1000000))/1000000n;
    onCursor(snap ? snapTime(time,transitions(changes),start,end,r.width,3.5,e.clientX-r.left):time,alternate);
  }
  return <canvas ref={ref} className="wave-canvas" data-color={color} aria-label={`波形 ${signal.path}`} onDoubleClick={onJump}
    onDragStart={e=>{e.preventDefault();e.stopPropagation();}}
    onContextMenu={e=>{e.preventDefault();e.stopPropagation();}}
    onPointerDown={e=>{
      suppressClick.current=false;
      if((e.button!==0&&e.button!==2)||e.ctrlKey||e.metaKey||e.shiftKey)return;
      e.preventDefault();
      (e.currentTarget.closest(".wave-panel") as HTMLElement)?.focus({preventScroll:true});
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current={from:position(e.clientX),to:position(e.clientX),moved:false,button:e.button,start,end};
    }}
    onPointerMove={e=>{
      const g=gesture.current;if(!g)return;
      const to=position(e.clientX);
      gesture.current={...g,to,moved:g.moved||Math.abs(to-g.from)>=5};
      if(g.button===0)setDrag(gesture.current);
    }}
    onPointerUp={e=>{
      const g=gesture.current;gesture.current=null;setDrag(null);
      if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
      if(!g)return;
      suppressClick.current=true;
      const to=position(e.clientX);
      if(g.button===2){place(e,true);return;}
      if(!g.moved&&Math.abs(to-g.from)<5){suppressClick.current=false;place(e,false);return;}
      // A gesture that crossed the drag threshold is never a cursor click,
      // even if it returns near its origin before release.
      if(Math.abs(to-g.from)<1)return;
      const width=e.currentTarget.clientWidth;
      const time=(x:number)=>g.start+(g.end-g.start)*BigInt(Math.round(x/width*1000000))/1000000n;
      const a=time(Math.min(g.from,to)),b=time(Math.max(g.from,to));
      onRange(a,b>a?b:a+1n);
    }}
    onPointerCancel={()=>{gesture.current=null;setDrag(null);suppressClick.current=true;}}
    onLostPointerCapture={()=>{gesture.current=null;setDrag(null);}}
    onClick={e=>{if(suppressClick.current){suppressClick.current=false;e.stopPropagation();}}}
    onAuxClick={e=>{e.preventDefault();e.stopPropagation();}} />;

}
export function formatValue(value: string) {
  if (/^[01]+$/.test(value) && value.length > 1) return "0x" + BigInt("0b" + value).toString(16);
  return value;
}
