// Copyright 2026 Frank Gao. SPDX-License-Identifier: Apache-2.0
export interface WaveSignal {
  handle: number;
  path: string;
  scope: string[];
  name: string;
  width: number;
  type: number;
}
export interface WaveSignals {
  roots: { name: string; module: string }[];
  signalCount: number;
  signals: WaveSignal[];
  total: number;
  start: string;
  end: string;
  timescale: number;
}
export interface WaveValues {
  rows: { handle: number; changes: [string, string][] }[];
  truncated: boolean;
}
export interface WaveSource {
  instanceId: string;
  symbolId: string;
  sourceId: string;
  line: number;
  startByte: number | null;
  endByte: number | null;
}
