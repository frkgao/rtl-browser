// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { AppError } from "../../../packages/contracts/src/errors.js";
import type { AllowedRoots } from "../../../packages/core/src/paths.js";
import type { SnapshotManifest } from "../../../packages/contracts/src/types.js";
import type { WaveSignals } from "../../../packages/contracts/src/waveform.js";

export async function openWaveform(raw: Record<string, unknown>, roots: AllowedRoots, snapshot: SnapshotManifest): Promise<WaveSignals> {
  const data = await waveformQuery({ path: raw.path, op: "signals", query: "", offset: 0 }, roots) as WaveSignals;
  const expected = snapshot.rootPath;
  if (!data.roots.length || !data.signalCount)
    throw new AppError("INVALID_INPUT", "波形文件没有有效的顶层或信号，无法与当前 RTL 关联。");
  const matches = data.roots.filter(r => r.name === expected);
  const actual = data.roots.map(r => r.module && r.module !== r.name ? `${r.name}（模块 ${r.module}）` : r.name).join("、");
  if (matches.length !== 1 || (matches[0].module && matches[0].module !== snapshot.topModule)) {
    throw new AppError("INVALID_INPUT", `波形与源码顶层不匹配：RTL 顶层为 ${expected}（模块 ${snapshot.topModule}），FST 顶层为 ${actual}。请选择对应仿真的波形，或重新构建匹配的 RTL 顶层。该波形未加载。`);
  }
  return data;
}

const children = new Set<ChildProcess>();
export function stopWaveforms(): void { for (const child of children) child.kill("SIGKILL"); }
let running = 0;
export async function waveformQuery(raw: unknown, roots: AllowedRoots): Promise<unknown> {
  if (!raw || typeof raw !== "object") throw new AppError("INVALID_INPUT", "invalid waveform request");
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== "string") throw new AppError("INVALID_INPUT", "waveform path is required");
  const file = roots.resolve(r.path, "waveform");
  if (path.extname(file).toLowerCase() !== ".fst" || !fs.statSync(file).isFile())
    throw new AppError("INVALID_INPUT", "请选择有效的 .fst 波形文件。");
  const request: Record<string, unknown> = { path: file, op: r.op };
  if (r.op === "signals") {
    if (typeof r.query !== "string" || r.query.length > 1024 || !Number.isSafeInteger(r.offset) || Number(r.offset) < 0)
      throw new AppError("INVALID_INPUT", "invalid signal search");
    request.query = r.query; request.offset = r.offset;
  } else if (r.op === "resolve") {
    if (!Array.isArray(r.paths) || r.paths.length > 64 || r.paths.some(p => typeof p !== "string" || !p || p.length > 4096))
      throw new AppError("INVALID_INPUT", "invalid waveform signal paths");
    request.paths = r.paths;
  } else if (r.op === "edge") {
    if (!Number.isInteger(r.handle) || Number(r.handle)<1 || Number(r.handle)>0xffffffff || ![1,-1].includes(Number(r.direction)) || typeof r.direction!=="number" || !["any","rise","fall"].includes(String(r.kind)) || typeof r.cursor!=="string" || !/^\d{1,20}$/.test(r.cursor) || BigInt(r.cursor)>0xffffffffffffffffn)
      throw new AppError("INVALID_INPUT", "invalid edge search");
    request.handle=r.handle; request.direction=r.direction; request.kind=r.kind; request.cursor=r.cursor;
  } else if (r.op === "values") {
    if (!Array.isArray(r.handles) || r.handles.length > 64 || r.handles.some(h => !Number.isInteger(h) || h < 1 || h > 0xffffffff))
      throw new AppError("INVALID_INPUT", "invalid signal handles");
    for (const key of ["start", "end"]) {
      const value = r[key];
      if (typeof value !== "string" || !/^\d{1,20}$/.test(value) || BigInt(value) > 0xffffffffffffffffn)
        throw new AppError("INVALID_INPUT", "invalid waveform timestamp");
      request[key] = value;
    }
    if (BigInt(String(r.start)) > BigInt(String(r.end))) throw new AppError("INVALID_INPUT", "invalid time range");
    request.handles = r.handles;
  } else throw new AppError("INVALID_INPUT", "unknown waveform operation");
  if (running >= 2) throw new AppError("QUERY_LIMIT", "waveform reader busy; try again");
  const exe = process.env.RTL_WAVE_WORKER ?? path.join(process.env.RTL_PROJECT_ROOT ?? fileURLToPath(new URL("../../../../..", import.meta.url)), "build/wave-worker", process.platform === "win32" ? "wave-worker.exe" : "wave-worker");
  running++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      children.add(child);
      child.once("close", () => children.delete(child));
      let output = "", bytes = 0, failure: Error | null = null;
      const timer = setTimeout(() => { failure = new AppError("QUERY_TIMEOUT", "FST read timed out"); child.kill(); }, 30000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 24 * 1024 * 1024) { failure = new AppError("RESOURCE_LIMIT", "zoom into a smaller waveform window"); child.kill(); }
        else output += chunk;
      });
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.on("error", () => { clearTimeout(timer); reject(new AppError("CAPABILITY_MISSING", "wave-worker unavailable; build native/wave-worker first")); });
      child.on("close", () => {
        clearTimeout(timer);
        if (failure) { reject(failure); return; }
        try {
          const response = JSON.parse(output);
          if (!response.ok) reject(new AppError("INVALID_INPUT", `FST 波形读取失败：${response.error ?? "未知错误"}。请检查文件是否完整、可读且格式正确。`));
          else resolve(response.data);
        } catch { reject(new AppError("IO_ERROR", "FST 波形读取失败，文件可能已损坏或格式不受支持。")); }
      });
      child.stdin.end(JSON.stringify(request) + "\n");
    });
  } finally { running--; }
}
