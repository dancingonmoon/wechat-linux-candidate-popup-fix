// ibus-wxfix@dt.local v2 — 微信(Qt5 ibus 插件)按 devicePixelRatio 放大的"窗口相对光标坐标"定点归一
// + 窗口/actor 几何变化即时重锚(候选框跟随窗口、第一笔输入即就位)。
// 病灶与证据详见 ~/.local/share/ibus-probe/wxfix3.js 注释;本扩展 = 登录自动加载的固化版。
// 设计要点:
//   ① 仅挂"相对通道"(set-cursor-location-relative)的第二处理器,绝对通道(终端等 GTK 程序)零接触;
//   ② 辨认护栏: (x > 窗宽 || y > 窗高) → 合法相对坐标不可能越界 → 判定为 dpr 放大空间;
//   ③ v2 时效标记: 一旦见过越界,该窗口在 10s 内一律按放大空间处理(修"窗口缩小时帧几何
//      尚未跟上的过渡帧误判为合法"导致候选框滞留); 上游修复后标记永不激活,自动放行;
//   ④ 除数 = ceil(显示器 scale) 每次实时读取; ⑤ 窗口/actor 位置尺寸变化即时重锚。
// DEBUG=false 可关闭日志(journal 省流)。
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {getIBusManager} from 'resource:///org/gnome/shell/misc/ibusManager.js';

const DEBUG = true;
const SCALED_FLAG_MS = 10000; // "已确认放大空间"标记的有效期

export default class IbusWxfixExtension extends Extension {
    enable() {
        this._anchor = {nx: 0, ny: 0, nw: 1, nh: 1, have: false, scaledAt: 0, conn: null};
        this._ps = null;
        this._relId = 0;
        this._mgr = getIBusManager();
        this._readyId = this._mgr.connect('ready', () => {
            this._detach();
            this._attach();
        });
        this._attach();
        this._log('enabled (v2)');
    }

    disable() {
        this._detach();
        if (this._readyId) {
            try { this._mgr.disconnect(this._readyId); } catch (e) {}
            this._readyId = 0;
        }
        this._unhook();
        this._anchor = null;
        this._mgr = null;
        this._log('disabled');
    }

    _log(...a) {
        if (DEBUG)
            console.log('[ibus-wxfix]', ...a);
    }

    _attach() {
        const ps = this._mgr?._panelService;
        if (!ps || ps === this._ps)
            return;
        this._ps = ps;
        this._relId = ps.connect('set-cursor-location-relative',
            (_ps, x, y, w, h) => this._onRel(x, y, w, h));
        this._log('attached');
    }

    _detach() {
        // 注销时 PanelService 可能已由 C 侧销毁, 此时 disconnect 会触发
        // "Object ... has been already disposed" 异常, 并拖住 IBus 服务停机。
        if (this._ps && this._relId && !this._ps.is_destroyed?.()) {
            try { this._ps.disconnect(this._relId); } catch (e) {}
        }
        this._ps = null;
        this._relId = 0;
    }

    _onRel(x, y, w, h) {
        const anchor = this._anchor;
        if (!anchor)
            return;
        try {
            const win = global.display.focus_window;
            if (!win)
                return;
            const f = win.get_frame_rect();
            const c = anchor.conn;
            const flagFresh =
                !!(c && c.win === win) &&
                GLib.get_monotonic_time() - anchor.scaledAt < SCALED_FLAG_MS * 1000;
            const outOfRange = x > f.width || y > f.height;
            if (!outOfRange && !flagFresh)
                return; // 从未见过越界 → 视为合法坐标,放行(其它客户端/上游修复后免疫)
            let scale = 1;
            try { scale = global.display.get_monitor_scale(win.get_monitor()); } catch (e) {}
            const d = Math.max(1, Math.ceil(scale - 1e-6));
            if (d <= 1)
                return;
            const actor = win.get_compositor_private();
            const popup = getIBusManager()._candidatePopup;
            if (!actor || !popup)
                return;
            const nx = Math.round(x / d);
            const ny = Math.round(y / d);
            const nw = Math.max(1, Math.round(w / d));
            const nh = Math.max(1, Math.round(h / d));
            anchor.nx = nx; anchor.ny = ny;
            anchor.nw = nw; anchor.nh = nh;
            anchor.have = true;
            this._hookWin(win);
            if (outOfRange)
                anchor.scaledAt = GLib.get_monotonic_time();
            popup._setDummyCursorGeometry(
                Math.round(actor.x + nx), Math.round(actor.y + ny), nw, nh);
            this._log(`fixed raw(${x},${y},${w},${h}) d=${d} -> local(${nx},${ny}) @(${Math.round(actor.x)},${Math.round(actor.y)})${outOfRange ? '' : ' [flag]'}`);
        } catch (e) {
            this._log('rel err ' + e);
        }
    }

    _reAnchor() {
        try {
            const anchor = this._anchor;
            const c = anchor?.conn;
            if (!c || !anchor.have)
                return;
            const actor = c.actor;
            const popup = getIBusManager()._candidatePopup;
            if (!actor || !popup)
                return;
            popup._setDummyCursorGeometry(
                Math.round(actor.x + anchor.nx), Math.round(actor.y + anchor.ny),
                anchor.nw, anchor.nh);
            this._log(`re-anchor origin(${Math.round(actor.x)},${Math.round(actor.y)}) + local(${anchor.nx},${anchor.ny})`);
        } catch (e) {
            this._log('re-anchor err ' + e);
        }
    }

    _hookWin(win) {
        const anchor = this._anchor;
        const actor = win.get_compositor_private();
        const c = anchor.conn;
        if (c && c.win === win && c.actor === actor)
            return;
        this._unhook();
        anchor.scaledAt = 0; // 新窗口重新学习
        const ids = [];
        try {
            win.connectObject('position-changed', () => this._reAnchor(),
                'size-changed', () => this._reAnchor(), this);
        } catch (e) {
            try {
                ids.push([win, win.connect('position-changed', () => this._reAnchor())]);
                ids.push([win, win.connect('size-changed', () => this._reAnchor())]);
            } catch (e2) { this._log('win connect err ' + e2); }
        }
        if (actor) {
            for (const prop of ['x', 'y', 'width', 'height']) {
                try {
                    ids.push([actor, actor.connect('notify::' + prop, () => this._reAnchor())]);
                } catch (e) {}
            }
        }
        anchor.conn = {win, actor, ids};
        this._log(`hooked ${win.get_wm_class()}`);
    }

    _unhook() {
        const anchor = this._anchor;
        const c = anchor?.conn;
        if (!c)
            return;
        try { c.win.disconnectObject(this); } catch (e) {}
        for (const [obj, id] of c.ids) {
            try { obj.disconnect(id); } catch (e) {}
        }
        anchor.conn = null;
    }
}
