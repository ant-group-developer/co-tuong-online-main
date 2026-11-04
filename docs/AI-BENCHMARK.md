# AI – thiết kế và kết quả đo

## Engine

Engine tự viết bằng TypeScript (`packages/engine/src/ai`). Không dùng engine cờ vua, không dùng engine của bên thứ ba.

- Biểu diễn: mảng 90 ô (Int8Array), bảng tiền tính toán cho đường đi của từng quân, Zobrist 64-bit (2×32).
- Kiểm chứng bộ sinh nước bằng **perft** từ vị trí đầu: 44 / 1 920 / 79 666 / 3 290 240 (khớp giá trị chuẩn), khoảng 10 triệu nút/giây trên máy đo.
- Tìm kiếm: iterative deepening, negamax alpha-beta (PVS), aspiration window, transposition table, quiescence
  (ăn quân, kèm thoát chiếu ở mức `full`), MVV-LVA, killer moves, history heuristic, null-move pruning, LMR,
  check extension, mate-distance pruning, phát hiện lặp/trường chiếu trong cây tìm kiếm.
- Đánh giá: material + piece-square table, an toàn tướng (thiếu sĩ/tượng khi đối phương còn quân mạnh), điều chỉnh tàn cuộc, tempo.
- Chạy trong **Web Worker**. Mỗi yêu cầu có `jobId` + `positionVersion`; kết quả cũ bị bỏ khi restart/undo/đổi bên/đổi level.
  Hủy bằng `terminate()` worker. Thiết bị yếu (≤2 GB RAM hoặc ≤2 nhân) bị giới hạn 2,5 giây và TT 2^18 mục; mobile còn lại giới hạn 4 giây và TT 2^19.
- Giao diện chờ cố định **350 ms** trước khi hiện nước của máy (để kịp thấy animation). Mức chờ này áp dụng như nhau cho mọi level và
  **không** dùng để giả làm máy mạnh hơn.

## Sáu profile (`packages/engine/src/ai/profiles.ts`)

Mô tả hiển thị cho người chơi (thẻ chọn máy, theo khung "Dành cho" + "Máy chơi thế nào") nằm ở `apps/web/src/i18n/{vi,en}.ts` → `levels.*`,
viết lại từ đúng các thông số dưới đây và kết quả đo ("tính trước N nước mỗi bên" = độ sâu tìm kiếm ÷ 2, lấy độ sâu trung bình đo được).

| Mức | Thời gian tối đa | Node tối đa | Độ sâu tối đa | Tính năng | Chính sách sai lầm |
|---|---|---|---|---|---|
| Siêu dễ | 120 ms | 20k | 1 | không quiescence, không TT | 45% đi ngẫu nhiên; nhiễu ±300cp |
| Dễ | 250 ms | 100k | 2 | quiescence chỉ ăn quân (2 lớp) | 4% ngẫu nhiên; 15% chọn trong các nước kém ≤220cp; nhiễu ±60cp |
| Trung bình | 600 ms | 600k | 4 | TT 2^18, killer, quiescence đầy đủ | 5% chọn trong các nước kém ≤80cp; nhiễu ±20cp |
| Khó | 1,2 s | 3M | 8 | TT 2^20, killer, quiescence | không |
| Siêu khó | 2,5 s | 12M | 16 | + null-move, LMR, TT 2^21 | không |
| Bậc thầy (Master) | 5 s | 40M | 40 | toàn bộ tính năng, quiescence 16 lớp | không |

Nhiễu và "sai lầm có chủ đích" **không áp dụng cho nước chiếu hết**. Khi thấy chiếu hết, máy luôn chọn nước đó.

## Kết quả đo (04/11/2026)

- Máy đo: Intel Core i5-11400 (6 nhân/12 luồng), 34 GB RAM, Windows 11, Node v24.18.0.
- Công cụ: `npm run bench:ai -- --games 10`. Mỗi ván chạy trong một tiến trình riêng, 5 ván song song, nên thời gian nghĩ thực tế bị chia sẻ CPU.
- Dữ liệu đầy đủ, từng ván: `docs/ai-benchmark.json`, log: `docs/ai-benchmark.log`.

### Tactical suite (76 thế, đáp án kiểm chứng bằng solver vét cạn độc lập)

Các thế được sinh ngẫu nhiên có seed (`scripts/gen-tactics.ts`) rồi lọc bằng solver vét cạn (`mate-solver.ts`):
*m1/m2/m3* = Đỏ ép thắng trong đúng 1/2/3 nước (không có lời giải ngắn hơn); *d1* = Đen phải tìm nước chặn đòn thắng 1 nước.

| Mức | m1 (20) | d1 (20) | m2 (20) | m3 (16) |
|---|---|---|---|---|
| Siêu dễ | 1 | 6 | 1 | 1 |
| Dễ | 20 | 20 | 14 | 5 |
| Trung bình | 20 | 20 | 20 | 11 |
| Khó | 20 | 20 | 20 | 16 |
| Siêu khó | 20 | 20 | 20 | 16 |
| Master | 20 | 20 | 20 | 16 |

Hạn chế: bộ thế này quá dễ với các mức Khó trở lên (đều 100%), nên không phân biệt được chúng. Để so các mức cao, dùng kết quả đấu chéo bên dưới.

### Đấu chéo (10 ván mỗi cặp, đổi màu luân phiên, 6 khai cuộc cố định)

| Cặp | Kết quả (thắng–hòa–thua của mức cao hơn) | Điểm mức cao hơn | Thời gian nghĩ TB/nước | Độ sâu TB |
|---|---|---|---|---|
| Dễ vs Siêu dễ | 9–1–0 | 95% | 4 ms vs 0 ms | 2 vs 1 |
| Trung bình vs Dễ | 10–0–0 | 100% | 137 ms vs 2 ms | 4 vs 2 |
| Khó vs Trung bình | 10–0–0 | 100% | 829 ms vs 65 ms | 6,4 vs 4 |
| Siêu khó vs Khó | 7–1–2 | 75% | 1 492 ms vs 789 ms | 10,9 vs 6,4 |
| Master vs Siêu khó | 7–2–1 | 80% | 3 054 ms vs 1 482 ms | 11,8 vs 10,3 |
| Master vs Trung bình | 10–0–0 | 100% | 2 881 ms vs 128 ms | 9,7 vs 4 |

Kết luận có thể kiểm chứng: mỗi mức thắng rõ mức liền dưới, và Master là profile mạnh nhất của engine này.

### Giới hạn – nói rõ

- **Không có Elo hiệu chỉnh** so với người hay engine khác. Không tuyên bố mạnh ngang kiện tướng hay đại kiện tướng. "Bậc thầy" chỉ là tên mức cao nhất.
- Mẫu 10 ván/cặp còn nhỏ: khoảng tin cậy rộng, nhất là cặp Master–Siêu khó.
- Chưa có sách khai cuộc, chưa có endgame tablebase. Hàm đánh giá còn đơn giản (chưa có mobility chi tiết, cấu trúc tốt, phối hợp quân).
- Trên điện thoại yếu, Master bị giới hạn 2,5–4 giây nên yếu hơn số đo trên máy bàn.
- Hướng cải thiện: tune tham số đánh giá bằng self-play (SPSA), thêm sách khai cuộc, đo với số ván lớn hơn.
