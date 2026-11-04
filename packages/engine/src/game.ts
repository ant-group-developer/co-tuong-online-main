/**
 * Game: lớp luật ván đấu trên Position. Dùng chung cho client (AI/offline), AI worker và Cloud Functions.
 *
 * CHÍNH SÁCH LUẬT – RULES_VERSION "xq-rules-v1" (giản lược, KHÔNG phải luật giải đấu Á châu đầy đủ):
 *  1. Bên đến lượt không còn nước hợp lệ => THUA (bị chiếu hết hoặc hết nước; cờ tướng không có "hòa pat").
 *  2. Lặp lại: vị trí hiện tại (cùng bên đi) xuất hiện lần thứ 3 kể từ lần ăn quân gần nhất:
 *       - Nếu trong chu kỳ lặp, MỌI nước của đúng một bên đều là nước chiếu => bên đó THUA (trường chiếu).
 *       - Nếu cả hai bên cùng chiếu liên tục, hoặc không bên nào => HÒA (lặp lại).
 *       - Trường tróc (đuổi bắt liên tục quân không được bảo vệ) CHƯA được phân xử ở phiên bản này; coi như hòa lặp.
 *  3. 120 nửa nước (60 nước mỗi bên) không ăn quân => HÒA (no_progress). Chiếu hết ở nước cuối vẫn được ưu tiên.
 *  4. Cả hai bên không còn xe/mã/pháo/tốt => HÒA (insufficient_material).
 *  5. Giới hạn an toàn 600 nửa nước => HÒA (max_plies) để không ván nào kẹt vô hạn.
 */
import { positionFromFen, START_FEN, toFen } from './fen.js';
import { moveToIccs, iccsToMove, moveToVietnamese } from './notation.js';
import { Position } from './position.js';
import { type EndReason, type GameResult, type GameStatus, type Move, type Side, signToSide } from './types.js';

export const RULES_VERSION = 'xq-rules-v1';
export const NO_PROGRESS_PLIES = 120;
export const MAX_PLIES = 600;
export const REPETITION_COUNT = 3;

export class IllegalMoveError extends Error {
  constructor(
    message: string,
    readonly code: 'bad_format' | 'illegal' | 'game_over',
  ) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

export interface MoveRecord {
  move: Move;
  iccs: string;
  vn: string;
  side: Side;
  captured: number;
  givesCheck: boolean;
  hash: string;
}

export class Game {
  readonly startFen: string;
  readonly position: Position;
  readonly history: MoveRecord[] = [];
  private _status: GameStatus;

  constructor(startFen: string = START_FEN) {
    this.position = positionFromFen(startFen);
    this.startFen = toFen(this.position);
    this._status = this.computeStatus();
  }

  get status(): GameStatus {
    return this._status;
  }

  get sideToMove(): Side {
    return signToSide(this.position.side);
  }

  get ply(): number {
    return this.history.length;
  }

  fen(): string {
    return toFen(this.position);
  }

  stateHash(): string {
    return this.position.hashHex();
  }

  legalMoves(): Move[] {
    if (this._status.over) return [];
    return this.position.legalMoves();
  }

  /** Các ô đích hợp lệ cho quân tại `from` (dùng cho UI). */
  legalTargets(from: number): number[] {
    return this.legalMoves()
      .filter((m) => (m & 127) === from)
      .map((m) => m >> 7);
  }

  isLegal(m: Move): boolean {
    return !this._status.over && this.position.isLegal(m);
  }

  /** Đi một nước (Move hoặc chuỗi ICCS). Ném IllegalMoveError nếu không hợp lệ – không bao giờ "mặc định hợp lệ". */
  play(input: Move | string): MoveRecord {
    if (this._status.over) throw new IllegalMoveError('Ván đã kết thúc', 'game_over');
    const m = typeof input === 'string' ? iccsToMove(input) : input;
    if (typeof m !== 'number' || m < 0) throw new IllegalMoveError('Nước đi sai định dạng', 'bad_format');
    let legal = false;
    try {
      legal = this.position.isLegal(m);
    } catch {
      legal = false; // lỗi trong kiểm tra => từ chối, không bao giờ cho qua
    }
    if (!legal) throw new IllegalMoveError(`Nước đi không hợp lệ: ${moveToIccs(m)}`, 'illegal');
    const vn = moveToVietnamese(this.position, m);
    const side = signToSide(this.position.side);
    const captured = this.position.make(m);
    const givesCheck = this.position.inCheck();
    this.position.setCheckFlag(givesCheck);
    const rec: MoveRecord = {
      move: m,
      iccs: moveToIccs(m),
      vn,
      side,
      captured,
      givesCheck,
      hash: this.position.hashHex(),
    };
    this.history.push(rec);
    this._status = this.computeStatus();
    return rec;
  }

  /** Lùi một nửa nước (dùng cho AI/phòng bạn bè khi hai bên đồng ý). */
  undo(): MoveRecord | undefined {
    const rec = this.history.pop();
    if (!rec) return undefined;
    this.position.unmake();
    this._status = this.computeStatus();
    return rec;
  }

  movesIccs(): string[] {
    return this.history.map((h) => h.iccs);
  }

  private computeStatus(): GameStatus {
    const pos = this.position;
    const inCheck = pos.inCheck();
    const stm = signToSide(pos.side);
    const opp: GameResult = stm === 'red' ? 'black' : 'red';
    if (!pos.hasLegalMove()) {
      return { over: true, result: opp, reason: inCheck ? 'checkmate' : 'no_legal_moves', inCheck };
    }
    const rep = pos.detectRepetition(REPETITION_COUNT);
    if (rep) {
      if (rep.redPerpetual && !rep.blackPerpetual) return end('black', 'perpetual_check', inCheck);
      if (rep.blackPerpetual && !rep.redPerpetual) return end('red', 'perpetual_check', inCheck);
      return end('draw', 'repetition', inCheck);
    }
    if (pos.halfmove >= NO_PROGRESS_PLIES) return end('draw', 'no_progress', inCheck);
    if (!pos.hasAttackers(1) && !pos.hasAttackers(-1)) return end('draw', 'insufficient_material', inCheck);
    if (this.history.length >= MAX_PLIES) return end('draw', 'max_plies', inCheck);
    return { over: false, inCheck };
  }
}

function end(result: GameResult, reason: EndReason, inCheck: boolean): GameStatus {
  return { over: true, result, reason, inCheck };
}

// ---------------- Serialize / replay (có version) ----------------

export interface SerializedGame {
  v: 1;
  rules: string;
  startFen: string;
  moves: string[];
}

export function serializeGame(g: Game): SerializedGame {
  return { v: 1, rules: RULES_VERSION, startFen: g.startFen, moves: g.movesIccs() };
}

/** Tái tạo ván từ bản lưu. Ném lỗi nếu version/luật/nước đi không hợp lệ. */
export function replayGame(data: unknown): Game {
  const d = data as Partial<SerializedGame> | null;
  if (!d || d.v !== 1) throw new Error('Phiên bản dữ liệu ván không được hỗ trợ');
  if (d.rules !== RULES_VERSION) throw new Error(`Luật không khớp: ${String(d.rules)}`);
  if (!Array.isArray(d.moves) || d.moves.length > MAX_PLIES) throw new Error('Danh sách nước đi không hợp lệ');
  const g = new Game(typeof d.startFen === 'string' ? d.startFen : START_FEN);
  for (const mv of d.moves) g.play(String(mv));
  return g;
}

/** Tái tạo từ chuỗi nước đi cách nhau bằng dấu cách (định dạng lưu gọn trong RTDB). */
export function replayMoves(startFen: string, moves: string): Game {
  const g = new Game(startFen);
  const list = moves.trim() ? moves.trim().split(/\s+/) : [];
  if (list.length > MAX_PLIES) throw new Error('Quá nhiều nước đi');
  for (const mv of list) g.play(mv);
  return g;
}

export const END_REASON_VI: Record<EndReason, string> = {
  checkmate: 'Chiếu hết',
  no_legal_moves: 'Hết nước đi',
  perpetual_check: 'Phạm luật trường chiếu',
  repetition: 'Hòa do lặp lại nước đi',
  no_progress: 'Hòa do 60 nước không ăn quân',
  insufficient_material: 'Hòa do không đủ quân tấn công',
  max_plies: 'Hòa do vượt giới hạn số nước',
  resign: 'Đầu hàng',
  timeout: 'Hết giờ',
  draw_agreement: 'Hòa theo thỏa thuận',
  abandon: 'Bỏ trận (mất kết nối quá lâu)',
  aborted: 'Trận bị hủy trước khi bắt đầu',
};
