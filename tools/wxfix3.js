// wxfix3.js — 相对通道"单位归一"修正 + 窗口变化即时重锚(活公式,零硬编码坐标;2026-10-04)
// 注意: GJS 模块按"路径"缓存——同路径重复 import 不会重新执行。升级必须换文件名!
// 病灶(实测): 微信(Qt5 ibus 插件)把窗口相对光标坐标按 devicePixelRatio(本机=2)放大后
// 经 SetCursorLocationRelative 发出; shell 依协议设计加窗口原点 →
// 弹窗落在 原点+2·L(窗口越高越偏,最终出屏=盲打)。
// 本器: ①相对通道第二处理器: 越界判定 ÷ ceil(scale) 后重定位(护栏: 不越界即放行);
//       ②窗口/actor 位置尺寸变化即时重锚 → 挪窗时候选框跟随、第一笔输入即就位。
// 绝对通道(终端等 GTK 程序)不受影响; 无全局副作用。
// 用法(Looking Glass): import('file:///tmp/wxfix3.js'); 自查: 输入 __wxfix3_installed 应回 true
const {getIBusManager} = await import('resource:///org/gnome/shell/misc/ibusManager.js');
const L = (...a) => console.log('[wxfix3]', ...a);

if (globalThis.__wxfix3_installed) {
    L('already installed');
} else {
    globalThis.__wxfix3_installed = true;

    try {
        // 缓存的"归一后窗口局部坐标" + 挂钩状态
        const anchor = {nx: 0, ny: 0, nw: 1, nh: 1, have: false, conn: null};

        const reAnchor = () => {
            try {
                const c = anchor.conn;
                if (!c || !anchor.have) return;
                const actor = c.actor;
                const popup = getIBusManager()._candidatePopup;
                if (!actor || !popup) return;
                popup._setDummyCursorGeometry(
                    Math.round(actor.x + anchor.nx), Math.round(actor.y + anchor.ny),
                    anchor.nw, anchor.nh);
                L(`re-anchor origin(${Math.round(actor.x)},${Math.round(actor.y)}) + local(${anchor.nx},${anchor.ny})`);
            } catch (e) { L('re-anchor err ' + e); }
        };

        const unhook = () => {
            const c = anchor.conn;
            if (!c) return;
            try { c.win.disconnectObject(c.holder); } catch (e) {}
            for (const [obj, id] of c.ids) {
                try { obj.disconnect(id); } catch (e) {}
            }
            anchor.conn = null;
        };

        const hookWin = win => {
            const actor = win.get_compositor_private();
            const c = anchor.conn;
            if (c && c.win === win && c.actor === actor) return;
            unhook();
            const holder = {};
            const ids = [];
            try {
                win.connectObject('position-changed', reAnchor, 'size-changed', reAnchor, holder);
            } catch (e) {
                L('win connectObject err, fallback to connect: ' + e);
                try {
                    ids.push([win, win.connect('position-changed', reAnchor)]);
                    ids.push([win, win.connect('size-changed', reAnchor)]);
                } catch (e2) { L('win connect err ' + e2); }
            }
            if (actor) {
                for (const prop of ['x', 'y', 'width', 'height']) {
                    try { ids.push([actor, actor.connect('notify::' + prop, reAnchor)]); } catch (e) {}
                }
            }
            anchor.conn = {win, actor, holder, ids};
            L(`hooked ${win.get_wm_class()} actor=${!!actor} ids=${ids.length}`);
        };

        const handleRel = (_ps, x, y, w, h) => {
            try {
                const win = global.display.focus_window;
                if (!win) { L('pass: no focus'); return; }
                const f = win.get_frame_rect();
                if (!(x > f.width || y > f.height)) {
                    L(`pass: in-range (${x},${y}) ${f.width}x${f.height}`);
                    return;
                }
                let scale = 1;
                try { scale = global.display.get_monitor_scale(win.get_monitor()); } catch (e) {}
                const d = Math.max(1, Math.ceil(scale - 1e-6));
                if (d <= 1) { L(`pass: scale ${scale}`); return; }
                const actor = win.get_compositor_private();
                const popup = getIBusManager()._candidatePopup;
                if (!actor || !popup) { L('pass: no actor/popup'); return; }
                const nx = Math.round(x / d), ny = Math.round(y / d);
                const nw = Math.max(1, Math.round(w / d)), nh = Math.max(1, Math.round(h / d));
                anchor.nx = nx; anchor.ny = ny; anchor.nw = nw; anchor.nh = nh; anchor.have = true;
                hookWin(win);
                popup._setDummyCursorGeometry(
                    Math.round(actor.x + nx), Math.round(actor.y + ny), nw, nh);
                L(`fixed raw(${x},${y},${w},${h}) d=${d} -> local(${nx},${ny}) origin(${Math.round(actor.x)},${Math.round(actor.y)})`);
            } catch (e) { L('rel err ' + e); }
        };

        const mgr = getIBusManager();
        let attached = null;
        const attach = () => {
            const ps = mgr._panelService;
            if (!ps || ps === attached) return;
            attached = ps;
            ps.connect('set-cursor-location-relative', handleRel);
            L('attached to panelService');
        };
        attach();
        mgr.connect('ready', () => { attached = null; attach(); L('re-attach on ready'); });
        L('installed OK (wxfix3)');
    } catch (e) {
        L('INSTALL ERROR: ' + e + ' | ' + (e.stack || ''));
    }
}
