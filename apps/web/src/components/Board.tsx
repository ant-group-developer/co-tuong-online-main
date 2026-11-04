/**
 * Bàn cờ tướng: 9×10 GIAO ĐIỂM (không phải ô vuông), tỷ lệ khung 414:460 (ô 46 đơn vị) như bản tham chiếu.
 * Dữ liệu luôn ở tọa độ canonical; `flipped` chỉ đổi cách vẽ và ánh xạ click/phím.
 * Bàn và quân được vẽ hoàn toàn bằng SVG/CSS (không dùng ảnh/brand của bản tham chiếu).
 */
import { fromView, toView, PIECE_NAME_VI, squareToIccs } from '@xq/engine';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

const GLYPH_RED = ['', '帥', '仕', '相', '傌', '俥', '炮', '兵'];
const GLYPH_BLACK = ['', '將', '士', '象', '馬', '車', '砲', '卒'];

export interface BoardProps {
  board: ArrayLike<number>;
  flipped?: boolean;
  /** Ô có quân người dùng được phép chọn. */
  canSelect?: (sq: number) => boolean;
  /** Đích hợp lệ của quân tại ô. */
  targetsOf?: (sq: number) => number[];
  onMove?: (from: number, to: number) => void;
  lastMove?: { from: number; to: number } | null;
  checkSq?: number | null;
  /** Ô đang chờ server xác nhận (hiển thị mờ). */
  pendingTo?: number | null;
  disabled?: boolean;
  ariaLabel?: string;
}

interface PieceItem {
  id: number;
  piece: number;
  sq: number;
}

let idSeq = 1;

/** Khóa theo NỘI DUNG bàn: engine sửa Int8Array tại chỗ nên tham chiếu không đổi giữa các nước. */
function boardKeyOf(board: ArrayLike<number>): string {
  return Array.prototype.join.call(board, ',');
}

/** Gán id ổn định cho quân để animate khi di chuyển. */
function usePieceIds(board: ArrayLike<number>, boardKey: string): PieceItem[] {
  const prev = useRef<{ board: number[]; ids: number[] } | null>(null);
  return useMemo(() => {
    const cur = Array.from(board);
    const p = prev.current;
    let ids: number[];
    if (p) {
      const changed: number[] = [];
      for (let i = 0; i < 90; i++) if (p.board[i] !== cur[i]) changed.push(i);
      ids = p.ids.slice();
      if (changed.length === 2) {
        const [a, b] = changed;
        // Nước đi: một ô trở nên trống (from), ô kia nhận đúng quân đó (to).
        const tryMove = (from: number, to: number) => cur[from] === 0 && p.board[from] !== 0 && cur[to] === p.board[from];
        if (tryMove(a, b)) {
          ids[b] = ids[a];
          ids[a] = 0;
        } else if (tryMove(b, a)) {
          ids[a] = ids[b];
          ids[b] = 0;
        } else if (cur[a] !== 0 && cur[b] !== 0 && p.board[a] === cur[b]) {
          // Đi lại có hoàn quân bị ăn
          ids[b] = ids[a];
          ids[a] = idSeq++;
        } else if (cur[a] !== 0 && cur[b] !== 0 && p.board[b] === cur[a]) {
          ids[a] = ids[b];
          ids[b] = idSeq++;
        } else {
          ids = cur.map((v) => (v ? idSeq++ : 0));
        }
        for (let i = 0; i < 90; i++) if (cur[i] !== 0 && !ids[i]) ids[i] = idSeq++;
        for (let i = 0; i < 90; i++) if (cur[i] === 0) ids[i] = 0;
      } else if (changed.length > 0) {
        ids = cur.map((v) => (v ? idSeq++ : 0));
      }
    } else {
      ids = cur.map((v) => (v ? idSeq++ : 0));
    }
    prev.current = { board: cur, ids };
    const items: PieceItem[] = [];
    for (let i = 0; i < 90; i++) if (cur[i]) items.push({ id: ids[i], piece: cur[i], sq: i });
    return items.sort((x, y) => x.id - y.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);
}

const cellX = (col: number) => 23 + 46 * col;
const cellY = (row: number) => 23 + 46 * row;
const RIVER_Y = (cellY(4) + cellY(5)) / 2;

function BoardGrid() {
  const lines: ReactElement[] = [];
  for (let r = 0; r < 10; r++) lines.push(<line key={`h${r}`} x1={23} y1={cellY(r)} x2={391} y2={cellY(r)} />);
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) lines.push(<line key={`v${c}`} x1={cellX(c)} y1={23} x2={cellX(c)} y2={437} />);
    else {
      lines.push(<line key={`vt${c}`} x1={cellX(c)} y1={23} x2={cellX(c)} y2={cellY(4)} />);
      lines.push(<line key={`vb${c}`} x1={cellX(c)} y1={cellY(5)} x2={cellX(c)} y2={437} />);
    }
  }
  // Đường chéo cung
  lines.push(<line key="p1" x1={cellX(3)} y1={cellY(0)} x2={cellX(5)} y2={cellY(2)} />);
  lines.push(<line key="p2" x1={cellX(5)} y1={cellY(0)} x2={cellX(3)} y2={cellY(2)} />);
  lines.push(<line key="p3" x1={cellX(3)} y1={cellY(7)} x2={cellX(5)} y2={cellY(9)} />);
  lines.push(<line key="p4" x1={cellX(5)} y1={cellY(7)} x2={cellX(3)} y2={cellY(9)} />);
  // Dấu vị trí pháo/tốt
  const marks: Array<[number, number]> = [
    [2, 1], [2, 7], [7, 1], [7, 7],
    [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
  ];
  const d = 4;
  const l = 9;
  for (const [r, c] of marks) {
    const x = cellX(c);
    const y = cellY(r);
    for (const sx of [-1, 1]) {
      if ((sx === -1 && c === 0) || (sx === 1 && c === 8)) continue;
      for (const sy of [-1, 1]) {
        lines.push(
          <polyline
            key={`m${r}${c}${sx}${sy}`}
            points={`${x + sx * d},${y + sy * (d + l)} ${x + sx * d},${y + sy * d} ${x + sx * (d + l)},${y + sy * d}`}
            fill="none"
          />,
        );
      }
    }
  }
  return <g className="grid">{lines}</g>;
}

const StaticBoard = memo(function StaticBoard() {
  return (
    <svg className="board-svg" viewBox="0 0 414 460" aria-hidden="true">
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2d39d" />
          <stop offset="0.5" stopColor="#e9c286" />
          <stop offset="1" stopColor="#dcae6d" />
        </linearGradient>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.18" numOctaves="2" seed="7" result="n" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.27  0 0 0 0 0.1  0 0 0 0.16 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      <rect x="0" y="0" width="414" height="460" rx="10" fill="url(#wood)" />
      <rect x="0" y="0" width="414" height="460" rx="10" fill="#000" filter="url(#grain)" />
      <rect x="9" y="9" width="396" height="442" fill="none" stroke="#5b3a1c" strokeWidth="3" rx="3" />
      <rect x="23" y="23" width="368" height="414" fill="none" stroke="#5b3a1c" strokeWidth="1.8" />
      <BoardGrid />
      <g className="river" fontSize="20" fill="#6a4322" fillOpacity="0.85" textAnchor="middle" dominantBaseline="central">
        <text x={cellX(1)} y={RIVER_Y}>楚 河</text>
        <text x={cellX(7)} y={RIVER_Y}>漢 界</text>
      </g>
      {/* Logo giữa sông (public/river-logo.jpg, 1280×1280 nền trắng): cắt biểu tượng + chữ, xếp ngang.
          mix-blend-mode multiply làm nền trắng "biến mất" trên vân gỗ. */}
      <g className="river-logo" style={{ mixBlendMode: 'multiply' }}>
        <svg x={126} y={RIVER_Y - 16} width={39.6} height={32} viewBox="340 280 600 485">
          <image href="/river-logo.jpg" width="1280" height="1280" />
        </svg>
        <svg x={173.6} y={RIVER_Y - 7.5} width={114.6} height={15} viewBox="105 865 1070 140">
          <image href="/river-logo.jpg" width="1280" height="1280" />
        </svg>
      </g>
    </svg>
  );
});

export function pieceLabel(p: number): string {
  return `${PIECE_NAME_VI[Math.abs(p)]} ${p > 0 ? 'đỏ' : 'đen'}`;
}

export function Board({
  board,
  flipped = false,
  canSelect,
  targetsOf,
  onMove,
  lastMove,
  checkSq,
  pendingTo,
  disabled,
  ariaLabel = 'Bàn cờ',
}: BoardProps) {
  const boardKey = boardKeyOf(board);
  const pieces = usePieceIds(board, boardKey);
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState<number>(() => fromView(9, 4, flipped));
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const targets = useMemo(() => (selected !== null && targetsOf ? targetsOf(selected) : []), [selected, targetsOf]);
  const targetSet = useMemo(() => new Set(targets), [targets]);

  // Bỏ chọn khi bàn thay đổi (nước đi mới, resync, đổi lượt) hoặc bị khóa.
  useEffect(() => setSelected(null), [boardKey, disabled]);

  const handleCell = (sq: number) => {
    if (disabled) return;
    if (selected !== null && targetSet.has(sq)) {
      onMove?.(selected, sq);
      setSelected(null);
      return;
    }
    if (canSelect?.(sq)) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const v = toView(focus, flipped);
    let { row, col } = v;
    if (e.key === 'ArrowUp') row = Math.max(0, row - 1);
    else if (e.key === 'ArrowDown') row = Math.min(9, row + 1);
    else if (e.key === 'ArrowLeft') col = Math.max(0, col - 1);
    else if (e.key === 'ArrowRight') col = Math.min(8, col + 1);
    else if (e.key === 'Escape') {
      setSelected(null);
      return;
    } else return;
    e.preventDefault();
    const sq = fromView(row, col, flipped);
    setFocus(sq);
    cellRefs.current[sq]?.focus();
  };

  const pos = (sq: number) => {
    const v = toView(sq, flipped);
    return { left: `${(v.col * 100) / 9}%`, top: `${v.row * 10}%` };
  };

  const cells = [];
  for (let sq = 0; sq < 90; sq++) {
    const p = board[sq];
    const label = `${squareToIccs(sq)}${p ? `: ${pieceLabel(p)}` : ''}${targetSet.has(sq) ? ' – có thể đi tới' : ''}${selected === sq ? ' – đang chọn' : ''}`;
    cells.push(
      <button
        key={sq}
        ref={(el) => {
          cellRefs.current[sq] = el;
        }}
        type="button"
        className="cell"
        style={pos(sq)}
        tabIndex={sq === focus ? 0 : -1}
        aria-label={label}
        aria-pressed={selected === sq}
        data-sq={squareToIccs(sq)}
        onFocus={() => setFocus(sq)}
        onClick={() => handleCell(sq)}
      />,
    );
  }

  return (
    <div className={`board${disabled ? ' is-disabled' : ''}`} role="group" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      <StaticBoard />
      {lastMove && (
        <>
          <div className="last-mark from" style={pos(lastMove.from)} aria-hidden="true" />
          <div className="last-mark to" style={pos(lastMove.to)} aria-hidden="true" />
        </>
      )}
      <div className="pieces" aria-hidden="true">
        {pieces.map((it) => {
          const t = Math.abs(it.piece);
          const red = it.piece > 0;
          const cls = [
            'piece',
            red ? 'red' : 'black',
            selected === it.sq ? 'selected' : '',
            checkSq === it.sq ? 'in-check' : '',
            pendingTo === it.sq ? 'pending' : '',
            lastMove?.to === it.sq ? 'just-moved' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={it.id} className={cls} style={pos(it.sq)} data-piece-sq={squareToIccs(it.sq)}>
              <div className="disc">
                <span>{red ? GLYPH_RED[t] : GLYPH_BLACK[t]}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="targets" aria-hidden="true">
        {targets.map((sq) => (
          <div key={sq} className={`target${board[sq] ? ' capture' : ''}`} style={pos(sq)} />
        ))}
      </div>
      <div className="cells">{cells}</div>
    </div>
  );
}
