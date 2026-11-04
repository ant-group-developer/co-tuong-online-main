/**
 * Điều phối AI worker: mỗi yêu cầu có jobId + positionVersion. Kết quả cũ (restart, đổi bên, undo, đổi level)
 * bị bỏ qua. cancel() terminate worker đang tính để giải phóng CPU ngay, rồi tạo worker mới khi cần.
 */
import type { AiLevel, DeviceLimits } from '@xq/engine/ai';
import type { AiRequest, AiResponse } from './worker';

export type AiResult = Extract<AiResponse, { type: 'result' }>;

/** Giới hạn cho thiết bị yếu (ít nhân/ít RAM): trần thời gian và bộ nhớ TT. */
export function deviceLimits(): DeviceLimits {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mem <= 2 || cores <= 2) return { maxTimeMs: 2500, maxTtSizeLog2: 18 };
  if (mobile || mem <= 4) return { maxTimeMs: 4000, maxTtSizeLog2: 19 };
  return {};
}

export class AiClient {
  private worker: Worker | null = null;
  private busy = false;
  private jobSeq = 0;
  private currentJob = 0;
  private pending: { resolve: (r: AiResult | null) => void; reject: (e: Error) => void } | null = null;

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<AiResponse>) => this.onMessage(ev.data);
      this.worker.onerror = (ev) => {
        const p = this.pending;
        this.pending = null;
        this.busy = false;
        p?.reject(new Error(ev.message || 'AI worker lỗi'));
      };
    }
    return this.worker;
  }

  private onMessage(msg: AiResponse): void {
    if (msg.jobId !== this.currentJob) return; // kết quả cũ
    this.busy = false;
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  /** Yêu cầu nước đi. Trả về null nếu job bị hủy/thay thế. */
  request(p: { startFen: string; moves: string[]; level: AiLevel; positionVersion: number }): Promise<AiResult | null> {
    this.cancel();
    const jobId = ++this.jobSeq;
    this.currentJob = jobId;
    const w = this.ensure();
    this.busy = true;
    const req: AiRequest = {
      type: 'search',
      jobId,
      positionVersion: p.positionVersion,
      startFen: p.startFen,
      moves: p.moves,
      level: p.level,
      limits: deviceLimits(),
      seed: (Math.random() * 0xffffffff) >>> 0,
    };
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      w.postMessage(req);
    });
  }

  cancel(): void {
    this.currentJob = 0;
    if (this.pending) {
      this.pending.resolve(null);
      this.pending = null;
    }
    if (this.busy && this.worker) {
      // Tìm kiếm đồng bộ: cách hủy chắc chắn là dừng worker.
      this.worker.terminate();
      this.worker = null;
    }
    this.busy = false;
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
