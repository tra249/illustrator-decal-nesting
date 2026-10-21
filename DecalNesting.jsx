//@target illustrator
/*
  デカール自動配置（ネスティング） for Adobe Illustrator
  使い方: パーツと枠（塗りなしの長方形）をまとめて選択して実行
*/
// ===== ネスティング計算部（DOM非依存） =====
var DN = (function () {
    function numAsc(a, b) { return a - b; }

    function mergeRuns(flat) {
        if (!flat.length) return [];
        var pr = [], i;
        for (i = 0; i < flat.length; i += 2) pr.push([flat[i], flat[i + 1]]);
        pr.sort(function (x, y) { return x[0] - y[0]; });
        var out = [], ca = pr[0][0], cb = pr[0][1];
        for (i = 1; i < pr.length; i++) {
            if (pr[i][0] <= cb + 1) { if (pr[i][1] > cb) cb = pr[i][1]; }
            else { out.push(ca, cb); ca = pr[i][0]; cb = pr[i][1]; }
        }
        out.push(ca, cb);
        return out;
    }

    // rings: [[ [x,y], ... ], ...]（ドキュメント座標・y上向き）
    // mode 0: 横長枠（P=x, Q=-y） / mode 1: 縦長枠（P=-y, Q=x）
    function rasterize(rings, ang, mode, s) {
        var rad = ang * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
        var tr = [], minP = 1e30, maxP = -1e30, minQ = 1e30, maxQ = -1e30, i, j, k;
        for (i = 0; i < rings.length; i++) {
            var src = rings[i], dst = [];
            for (j = 0; j < src.length; j++) {
                var x = src[j][0], y = src[j][1];
                var xr = x * cs - y * sn, yr = x * sn + y * cs, P, Q;
                if (mode === 0) { P = xr; Q = -yr; } else { P = -yr; Q = xr; }
                dst.push(P, Q);
                if (P < minP) minP = P; if (P > maxP) maxP = P;
                if (Q < minQ) minQ = Q; if (Q > maxQ) maxQ = Q;
            }
            tr.push(dst);
        }
        var rows = Math.max(1, Math.ceil((maxP - minP) / s - 1e-9));
        var cols = Math.max(1, Math.ceil((maxQ - minQ) / s - 1e-9));
        var hs = s / 2, H = 2 * rows, iv = [];
        for (k = 0; k < rows; k++) iv.push([]);
        function cq(q) { var c = Math.floor((q - minQ) / s); return c < 0 ? 0 : (c >= cols ? cols - 1 : c); }
        function cp(p) { var c = Math.floor((p - minP) / s); return c < 0 ? 0 : (c >= rows ? rows - 1 : c); }

        for (i = 0; i < tr.length; i++) {
            var d = tr[i], n = d.length / 2, lines = {};
            if (n < 1) continue;
            for (j = 0; j < n; j++) {
                var P1 = d[2 * j], Q1 = d[2 * j + 1], jn = (j + 1) % n, P2 = d[2 * jn], Q2 = d[2 * jn + 1];
                var vc = cq(Q1); iv[cp(P1)].push(vc, vc); // 頂点は必ず塗る
                if (P1 === P2) continue;
                var lo = P1 < P2 ? P1 : P2, hi = P1 < P2 ? P2 : P1;
                var h0 = Math.ceil((lo - minP) / hs - 1e-9), h1 = Math.ceil((hi - minP) / hs - 1e-9) - 1;
                if (h0 < 0) h0 = 0; if (h1 > H) h1 = H;
                var slope = (Q2 - Q1) / (P2 - P1);
                for (var h = h0; h <= h1; h++) {
                    var qv = Q1 + (minP + h * hs - P1) * slope;
                    if (lines[h]) lines[h].push(qv); else lines[h] = [qv];
                }
            }
            for (var key in lines) {
                var hh = parseInt(key, 10), xs = lines[key];
                xs.sort(numAsc);
                for (var m = 0; m + 1 < xs.length; m += 2) {
                    var a = cq(xs[m]), b = cq(xs[m + 1]);
                    if (hh % 2 === 1) iv[(hh - 1) / 2].push(a, b);
                    else {
                        var r2 = hh / 2;
                        if (r2 - 1 >= 0) iv[r2 - 1].push(a, b);
                        if (r2 < rows) iv[r2].push(a, b);
                    }
                }
            }
        }
        var cells = 0, runs = [];
        for (k = 0; k < rows; k++) {
            var mr = mergeRuns(iv[k]);
            runs.push(mr);
            for (var t = 0; t < mr.length; t += 2) cells += mr[t + 1] - mr[t] + 1;
        }
        return { rows: rows, cols: cols, runs: runs, cells: cells };
    }

    function finishMask(mk) {
        var need = [], firstK = -1, widest = 0;
        for (var k = 0; k < mk.rows; k++) {
            var r = mk.runs[k], mxl = 0;
            for (var t = 0; t < r.length; t += 2) if (r[t + 1] - r[t] + 1 > mxl) mxl = r[t + 1] - r[t] + 1;
            need.push(mxl);
            if (mxl > need[widest]) widest = k;
            if (firstK < 0 && r.length) firstK = k;
        }
        mk.need = need; mk.widest = widest; mk.firstK = firstK < 0 ? 0 : firstK;
        return mk;
    }

    // 半径R（セル）で膨張。隙間の半分ずつを各パーツに持たせる
    function dilate(r, R) {
        var Ri = Math.round(R);
        if (Ri <= 0) return { rows: r.rows, cols: r.cols, runs: r.runs, off: 0 };
        var rows = r.rows + 2 * Ri, cols = r.cols + 2 * Ri, tmp = [], ws = [], k, dy;
        for (k = 0; k < rows; k++) tmp.push([]);
        for (dy = -Ri; dy <= Ri; dy++) ws.push(Math.round(Math.sqrt(Math.max(0, R * R - dy * dy))));
        ws[Ri] = Ri;
        for (k = 0; k < r.rows; k++) {
            var src = r.runs[k];
            if (!src.length) continue;
            for (dy = -Ri; dy <= Ri; dy++) {
                var w = ws[dy + Ri], dst = tmp[k + dy + Ri];
                for (var t = 0; t < src.length; t += 2) dst.push(src[t] - w + Ri, src[t + 1] + w + Ri);
            }
        }
        var runs = [];
        for (k = 0; k < rows; k++) runs.push(mergeRuns(tmp[k]));
        return { rows: rows, cols: cols, runs: runs, off: Ri };
    }

    // b = geometricBounds [L, T, R, B]
    function makeBin(b, mode, s, margin, Ri) {
        var Pmin, Pmax, Qmin, Qmax;
        if (mode === 0) { Pmin = b[0]; Pmax = b[2]; Qmin = -b[1]; Qmax = -b[3]; }
        else { Pmin = -b[1]; Pmax = -b[3]; Qmin = b[0]; Qmax = b[2]; }
        var iw = Pmax - Pmin - 2 * margin, ih = Qmax - Qmin - 2 * margin;
        var P = iw > 0 ? Math.floor(iw / s + 1e-9) + 2 * Ri : 0;
        var Q = ih > 0 ? Math.floor(ih / s + 1e-9) + 2 * Ri : 0;
        var filled = [], free = [], nfa = [], maxFree = [];
        for (var p = 0; p < P; p++) {
            var fr = [], fl = [], nf = [];
            for (var q = 0; q < Q; q++) { fr.push(0); fl.push(Q - q); nf.push(q); }
            fl.push(0); nf.push(Q);
            filled.push(fr); free.push(fl); nfa.push(nf); maxFree.push(Q);
        }
        return { mode: mode, P: P, Q: Q, GP: Pmin + margin - Ri * s, GQ: Qmin + margin - Ri * s,
                 filled: filled, free: free, nf: nfa, maxFree: maxFree, far: 0, used: false };
    }

    function findPos(bin, m, limFar) {
        var rows = m.rows, w = m.cols, Q = bin.Q, runs = m.runs, free = bin.free, nfs = bin.nf;
        var need = m.need, mx = bin.maxFree, pMax = Math.min(bin.P, limFar) - rows;
        if (w > Q) return null;
        var lastK = m.firstK, kw = m.widest;
        for (var p = 0; p <= pMax; p++) {
            var k;
            if (need[kw] > mx[p + kw] || need[lastK] > mx[p + lastK]) continue;
            var q = 0;
            while (q + w <= Q) {
                var failed = false;
                for (var i = 0; i < rows; i++) {
                    k = (i === 0) ? lastK : (i <= lastK ? i - 1 : i);
                    var r = runs[k];
                    if (!r.length) continue;
                    var fl = free[p + k], nf = nfs[p + k];
                    for (var t = 0; t < r.length; t += 2) {
                        var a = r[t], len = r[t + 1] - a + 1, f = fl[q + a];
                        if (f >= len) continue;
                        // この行で入る次の位置まで一気に飛ばす
                        var nq = q;
                        while (true) {
                            var c = nq + a + f;
                            if (c >= Q) { nq = Q; break; }
                            nq = nf[c] - a;
                            if (nq + w > Q) break;
                            f = fl[nq + a];
                            if (f >= len) break;
                        }
                        q = nq; lastK = k; failed = true;
                        break;
                    }
                    if (failed) break;
                }
                if (!failed) return { p: p, q: q };
            }
        }
        return null;
    }

    function occupy(bin, m, p0, q0) {
        var Q = bin.Q;
        for (var k = 0; k < m.rows; k++) {
            var r = m.runs[k];
            if (!r.length) continue;
            var fr = bin.filled[p0 + k], fl = bin.free[p0 + k];
            for (var t = 0; t < r.length; t += 2)
                for (var c = r[t]; c <= r[t + 1]; c++) fr[q0 + c] = 1;
            var nf = bin.nf[p0 + k], mxv = 0;
            fl[Q] = 0; nf[Q] = Q;
            for (var q = Q - 1; q >= 0; q--) {
                if (fr[q]) { fl[q] = 0; nf[q] = nf[q + 1]; }
                else { fl[q] = fl[q + 1] + 1; nf[q] = q; if (fl[q] > mxv) mxv = fl[q]; }
            }
            bin.maxFree[p0 + k] = mxv;
        }
    }

    function nestOnce(order, items, bins) {
        var place = [], nUn = 0, bi;
        for (var i = 0; i < order.length; i++) {
            var idx = order[i], it = items[idx], done = false;
            for (bi = 0; bi < bins.length && !done; bi++) {
                var bin = bins[bi], ms = it.masks[bin.mode], best = null, lim = bin.P;
                for (var o = 0; o < ms.length; o++) {
                    var pos = findPos(bin, ms[o], lim);
                    if (!pos) continue;
                    var far = pos.p + ms[o].rows;
                    if (!best || far < best.far ||
                        (far === best.far && (pos.p < best.p || (pos.p === best.p && pos.q < best.q)))) {
                        best = { o: o, p: pos.p, q: pos.q, far: far };
                        lim = far;
                    }
                }
                if (best) {
                    occupy(bin, ms[best.o], best.p, best.q);
                    if (best.far > bin.far) bin.far = best.far;
                    bin.used = true;
                    place[idx] = { bin: bin, binIndex: bi, o: best.o, p: best.p, q: best.q };
                    done = true;
                }
            }
            if (!done) { place[idx] = null; nUn++; }
        }
        var last = -1;
        for (bi = 0; bi < bins.length; bi++) if (bins[bi].used) last = bi;
        var cost = nUn * 1e9 + (last + 1) * 1e6 + (last >= 0 ? bins[last].far : 0);
        return { place: place, cost: cost, nUn: nUn };
    }

    function perturb(order) {
        var n = order.length;
        if (n < 2) return;
        var sw = Math.max(1, Math.round(n * 0.3));
        for (var i = 0; i < sw; i++) {
            var a = Math.floor(Math.random() * (n - 1));
            var b = Math.min(n - 1, a + 1 + Math.floor(Math.random() * 3));
            var tmp = order[a]; order[a] = order[b]; order[b] = tmp;
        }
    }

    // ringsList: パーツごとのリング配列, frameBounds: 枠のgeometricBounds配列
    // opt: { gap, margin, step, s, trials }（単位 pt / 度）, cb: 進捗コールバック
    function nest(ringsList, frameBounds, opt, cb) {
        var s = opt.s, R = opt.gap / 2 / s, Ri = Math.round(R), i, k, f;
        var modes = [false, false], defs = [];
        for (f = 0; f < frameBounds.length; f++) {
            var b = frameBounds[f];
            var mode = (b[2] - b[0]) >= (b[1] - b[3]) ? 0 : 1;
            defs.push({ b: b, mode: mode });
            modes[mode] = true;
        }
        var angles = [];
        for (var a = 0; a < 360 - 1e-6; a += opt.step) angles.push(a);

        var items = [];
        for (i = 0; i < ringsList.length; i++) {
            if (cb) cb('形状を解析中… ' + (i + 1) + ' / ' + ringsList.length);
            var it = { masks: [null, null], area: 0 };
            for (var m = 0; m < 2; m++) {
                if (!modes[m]) continue;
                it.masks[m] = [];
                for (k = 0; k < angles.length; k++) {
                    var r = rasterize(ringsList[i], angles[k], m, s);
                    if (k === 0 && !it.area) it.area = r.cells;
                    it.masks[m].push(finishMask(dilate(r, R)));
                }
            }
            items.push(it);
        }

        var base = [];
        for (i = 0; i < items.length; i++) base.push(i);
        base.sort(function (x, y) { return items[y].area - items[x].area; });

        var best = null;
        for (var t = 0; t < opt.trials; t++) {
            if (cb) cb('配置を計算中… 試行 ' + (t + 1) + ' / ' + opt.trials);
            var order = base.slice(0);
            if (t > 0) perturb(order);
            var bins = [];
            for (f = 0; f < defs.length; f++) bins.push(makeBin(defs[f].b, defs[f].mode, s, opt.margin, Ri));
            var res = nestOnce(order, items, bins);
            if (!best || res.cost < best.cost) best = res;
        }

        // 配置結果を「回転角・回転後の左上座標（ドキュメント座標）」に変換
        var out = [];
        for (i = 0; i < items.length; i++) {
            var pc = best.place[i];
            if (!pc) { out.push(null); continue; }
            var mk = items[i].masks[pc.bin.mode][pc.o];
            var minP = pc.bin.GP + (pc.p + mk.off) * s, minQ = pc.bin.GQ + (pc.q + mk.off) * s;
            var left, top;
            if (pc.bin.mode === 0) { left = minP; top = -minQ; } else { top = -minP; left = minQ; }
            out.push({ angle: angles[pc.o], left: left, top: top, frame: pc.binIndex });
        }
        return { result: out, unplaced: best.nUn };
    }

    return { nest: nest, rasterize: rasterize, dilate: dilate };
})();

// ===== Illustrator 側 =====
(function () {
    var MM = 72 / 25.4, BEZ = 12;

    if (app.documents.length === 0) { alert('ドキュメントが開かれていません。'); return; }
    var doc = app.activeDocument;
    var sel = doc.selection;
    if (!sel || sel.length < 2) {
        alert('パーツと枠（塗りなしの長方形）をまとめて選択してから実行してください。');
        return;
    }

    function near(a, b) { return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01; }

    function isWhite(c) {
        switch (c.typename) {
            case 'NoColor': return true;
            case 'RGBColor': return c.red >= 254 && c.green >= 254 && c.blue >= 254;
            case 'CMYKColor': return c.cyan <= 0.5 && c.magenta <= 0.5 && c.yellow <= 0.5 && c.black <= 0.5;
            case 'GrayColor': return c.gray <= 0.5;
        }
        return false;
    }

    // 枠 = 塗りなし（または白）の、軸に沿った長方形パス
    function isFrame(it) {
        if (it.typename !== 'PathItem' || !it.closed) return false;
        var pp = it.pathPoints;
        if (pp.length !== 4) return false;
        if (it.filled && !isWhite(it.fillColor)) return false;
        var b = it.geometricBounds, tol = 0.5;
        for (var i = 0; i < 4; i++) {
            var a = pp[i].anchor;
            if (!near(a, pp[i].leftDirection) || !near(a, pp[i].rightDirection)) return false;
            var onX = Math.abs(a[0] - b[0]) < tol || Math.abs(a[0] - b[2]) < tol;
            var onY = Math.abs(a[1] - b[1]) < tol || Math.abs(a[1] - b[3]) < tol;
            if (!onX || !onY) return false;
        }
        return true;
    }

    var frames = [], parts = [], i;
    for (i = 0; i < sel.length; i++) {
        if (isFrame(sel[i])) frames.push(sel[i]); else parts.push(sel[i]);
    }
    // パーツが1つのグループにまとまっている場合は中身を個別パーツとして扱う
    if (parts.length === 1 && parts[0].typename === 'GroupItem') {
        var grp = parts[0];
        parts = [];
        for (i = 0; i < grp.pageItems.length; i++) parts.push(grp.pageItems[i]);
    }
    if (frames.length === 0) {
        alert('枠が見つかりません。\n枠は「塗りなし（または白）の長方形」にしてください。');
        return;
    }
    if (parts.length === 0) { alert('パーツが選択されていません。'); return; }

    // 上の枠から順に（同じ高さなら左から）
    frames.sort(function (a, b) {
        var ba = a.geometricBounds, bb = b.geometricBounds;
        if (Math.abs(ba[1] - bb[1]) > 1) return bb[1] - ba[1];
        return ba[0] - bb[0];
    });

    // 元の状態（「元に戻す」用）
    var state = [];
    for (i = 0; i < parts.length; i++) {
        var g0 = parts[i].geometricBounds;
        state.push({ left: g0[0], top: g0[1], angle: 0 });
    }

    // ---- 形状の読み取り（ベジェを折れ線に分割） ----
    function flattenPath(p, out) {
        var pts = p.pathPoints, n = pts.length;
        if (n < 2) return;
        var A = [], L = [], R = [], ring = [], k;
        for (k = 0; k < n; k++) { A.push(pts[k].anchor); L.push(pts[k].leftDirection); R.push(pts[k].rightDirection); }
        var segs = p.closed ? n : n - 1;
        for (k = 0; k < segs; k++) {
            var j = (k + 1) % n, p0 = A[k], c1 = R[k], c2 = L[j], p1 = A[j];
            ring.push([p0[0], p0[1]]);
            if (near(p0, c1) && near(p1, c2)) continue;
            for (var s = 1; s < BEZ; s++) {
                var t = s / BEZ, mt = 1 - t;
                var w0 = mt * mt * mt, w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t, w3 = t * t * t;
                ring.push([w0 * p0[0] + w1 * c1[0] + w2 * c2[0] + w3 * p1[0],
                           w0 * p0[1] + w1 * c1[1] + w2 * c2[1] + w3 * p1[1]]);
            }
        }
        if (!p.closed) ring.push([A[n - 1][0], A[n - 1][1]]);
        out.push(ring);
    }

    function collectRings(it, out) {
        var k;
        switch (it.typename) {
            case 'PathItem':
                if (!it.guides) flattenPath(it, out);
                break;
            case 'CompoundPathItem':
                for (k = 0; k < it.pathItems.length; k++) flattenPath(it.pathItems[k], out);
                break;
            case 'GroupItem':
                for (k = 0; k < it.pageItems.length; k++) collectRings(it.pageItems[k], out);
                break;
            default: // テキストや画像などは外接矩形で扱う
                var b = it.geometricBounds;
                out.push([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]);
        }
    }

    function revertItem(idx) {
        var it = parts[idx], st = state[idx];
        if (st.angle !== 0) {
            it.rotate(-st.angle, true, true, true, true, Transformation.CENTER);
            st.angle = 0;
        }
        var gb = it.geometricBounds;
        it.translate(st.left - gb[0], st.top - gb[1]);
    }

    // ---- ダイアログ ----
    var ROT_LABELS = ['回転なし', '180°', '90°', '45°', '30°', '15°', '10°'];
    var ROT_STEPS = [360, 180, 90, 45, 30, 15, 10];
    var GRID_LABELS = ['2.0 mm（速い）', '1.0 mm（標準）', '0.5 mm（精密・遅い）'];
    var GRID_VALUES = [2, 1, 0.5];

    var dlg = new Window('dialog', 'デカール自動配置');
    dlg.orientation = 'column';
    dlg.alignChildren = 'fill';

    dlg.add('statictext', undefined, 'パーツ ' + parts.length + ' 個 ／ 枠 ' + frames.length + ' 個');

    var pnl = dlg.add('panel', undefined, '設定');
    pnl.alignChildren = 'left';
    pnl.margins = [14, 18, 14, 12];

    var gGap = pnl.add('group');
    var lb1 = gGap.add('statictext', undefined, '隙間'); lb1.preferredSize.width = 64;
    var sl = gGap.add('slider', undefined, 3, 0, 20); sl.preferredSize.width = 200;
    var etGap = gGap.add('edittext', undefined, '3'); etGap.characters = 5;
    gGap.add('statictext', undefined, 'mm');

    var gMar = pnl.add('group');
    var lb2 = gMar.add('statictext', undefined, '枠の余白'); lb2.preferredSize.width = 64;
    var etMar = gMar.add('edittext', undefined, '3'); etMar.characters = 5;
    gMar.add('statictext', undefined, 'mm');

    var gRot = pnl.add('group');
    var lb3 = gRot.add('statictext', undefined, '回転'); lb3.preferredSize.width = 64;
    var ddRot = gRot.add('dropdownlist', undefined, ROT_LABELS); ddRot.selection = 5;

    var gGrid = pnl.add('group');
    var lb4 = gGrid.add('statictext', undefined, '精度'); lb4.preferredSize.width = 64;
    var ddGrid = gGrid.add('dropdownlist', undefined, GRID_LABELS); ddGrid.selection = 1;

    var gTry = pnl.add('group');
    var lb5 = gTry.add('statictext', undefined, '試行回数'); lb5.preferredSize.width = 64;
    var etTry = gTry.add('edittext', undefined, '3'); etTry.characters = 5;
    gTry.add('statictext', undefined, '（多いほど詰まりやすいが遅い）');

    var cbAuto = pnl.add('checkbox', undefined, 'スライダーを離したら自動で再配置');

    var status = dlg.add('statictext', undefined, '「配置」を押すと計算を開始します。', { multiline: true });
    status.preferredSize = [380, 48];

    var gBtn = dlg.add('group');
    gBtn.alignment = 'right';
    var bRevert = gBtn.add('button', undefined, '元に戻す');
    var bRun = gBtn.add('button', undefined, '配置');
    var bClose = gBtn.add('button', undefined, '閉じる');

    function snap(v) { return Math.round(v * 2) / 2; }
    function num(txt, def) { var v = parseFloat(txt); return (isNaN(v) || v < 0) ? def : v; }
    function setStatus(t) { status.text = t; try { dlg.update(); } catch (e) {} }

    sl.onChanging = function () { etGap.text = snap(sl.value); };
    sl.onChange = function () {
        sl.value = snap(sl.value);
        etGap.text = sl.value;
        if (cbAuto.value) run();
    };
    etGap.onChange = function () {
        var v = num(etGap.text, 0);
        etGap.text = v;
        sl.value = Math.min(20, v);
    };

    function run() {
        var opt = {
            gap: num(etGap.text, 0) * MM,
            margin: num(etMar.text, 0) * MM,
            step: ROT_STEPS[ddRot.selection.index],
            s: GRID_VALUES[ddGrid.selection.index] * MM,
            trials: Math.max(1, Math.round(num(etTry.text, 1)))
        };
        var t0 = new Date().getTime();
        try {
            var ringsList = [];
            for (var k = 0; k < parts.length; k++) {
                setStatus('形状を読み込み中… ' + (k + 1) + ' / ' + parts.length);
                var rings = [];
                collectRings(parts[k], rings);
                ringsList.push(rings);
            }
            var fb = [];
            for (k = 0; k < frames.length; k++) fb.push(frames[k].geometricBounds);

            var res = DN.nest(ringsList, fb, opt, setStatus);

            setStatus('パーツを移動中…');
            var unplaced = [];
            for (k = 0; k < parts.length; k++) {
                var r = res.result[k], it = parts[k];
                if (!r) { revertItem(k); unplaced.push(it); continue; }
                if (r.angle !== 0) {
                    it.rotate(r.angle, true, true, true, true, Transformation.CENTER);
                    state[k].angle = (state[k].angle + r.angle) % 360;
                }
                var gb = it.geometricBounds;
                it.translate(r.left - gb[0], r.top - gb[1]);
            }
            if (unplaced.length) doc.selection = unplaced;
            app.redraw();

            var sec = ((new Date().getTime() - t0) / 1000).toFixed(1);
            var msg = '配置: ' + (parts.length - unplaced.length) + ' / ' + parts.length + ' 個（' + sec + ' 秒）';
            if (unplaced.length) msg += '\n入りきらなかった ' + unplaced.length + ' 個は元の位置に戻して選択しています。';
            setStatus(msg);
        } catch (e) {
            setStatus('エラーが発生しました。');
            alert('エラー: ' + e + (e.line ? '（' + e.line + ' 行目）' : ''));
        }
    }

    bRun.onClick = run;
    bRevert.onClick = function () {
        for (var k = 0; k < parts.length; k++) revertItem(k);
        app.redraw();
        setStatus('元の位置に戻しました。');
    };
    bClose.onClick = function () { dlg.close(); };

    dlg.show();
})();
