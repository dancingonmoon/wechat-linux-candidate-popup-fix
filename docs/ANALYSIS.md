# 根因分析（完整取证记录）

> 环境：Ubuntu 24.04 · GNOME Shell 46 · Wayland · 1920×1200 物理屏 / 1536×960 逻辑屏 · 分数缩放 125% · 微信 Linux 官方版 4.1（Qt5）· IBus 1.5.29 + libpinyin

## 1. 症状

微信**原生模式**下中文输入：候选框偏离光标（右下方向），窗口越高偏得越远，窗口较高/全屏时完全出屏（**盲打**：打字、回车提交一切正常，只是看不到候选框）。**终端与其它程序完全正常**。"偶发"的历史印象实为窗口高度不同所致。

## 2. 链路真相（推翻了最初的"Wayland text-input"猜测）

在 IBus **守护进程私有总线**上抓包（`DBUS_SESSION_BUS_ADDRESS=$IBUS_ADDRESS dbus-monitor`）并对各连接做身份统计：

| 连接 | 身份 | 行为 |
|---|---|---|
| `:1.9`（InputContext_3） | **微信自己** | 956 次 `SetCursorLocationRelative` + 928 次 `ProcessKeyEvent`，**直连守护进程** |
| `:1.3`（InputContext_2） | 终端（GTK） | 79 次 `SetCursorLocation`（**全局真实坐标**，如 813→1493, y=833） |

**关键结论：微信不走 mutter 的 text-input-v3**——它是 Qt5 通过 `QT_IM_MODULE=ibus` 插件直接与 IBus 守护进程对话（按键、光标、preedit 全部走 DBus）。守护进程把光标坐标**原样**转发给面板（shell）：

```
微信发: SetCursorLocationRelative(584, 708, 4, 44)
shell 面板收到: (584, 708, 4, 44)    ← 逐跳比对,分毫不差
```

GNOME Shell 面板侧（`ibusCandidatePopup.js` 的 `setPanelService`）按协议设计处理两条通道：

```js
panelService.connect('set-cursor-location', (ps, x, y, w, h) => {
    this._setDummyCursorGeometry(x, y, w, h);            // 绝对通道: 原样使用
});
panelService.connect('set-cursor-location-relative', (ps, x, y, w, h) => {
    let window = global.display.focus_window.get_compositor_private();
    this._setDummyCursorGeometry(window.x + x, window.y + y, w, h);  // 相对通道: 加窗口原点
});
```

"相对坐标 + 窗口原点"本身是**正确的协议设计**（Wayland 客户端无法知道自己的全局位置）——问题出在**微信发来的数值单位不对**。

## 3. 数值规律（多重独立证据）

**规律：`相对坐标 = devicePixelRatio × 窗口内逻辑局部坐标`，本机 dpr = 2（125% 分数缩放下 GNOME 给非分数感知客户端的整数缩放）。**

证据一：三组窗口状态（同一会话）

| 窗口帧 (x,y,w,h) | 微信发的相对坐标 | 推算局部坐标 = 值/2 |
|---|---|---|
| (50,32,631,486) | (584…752, **708**) | (292…376, **354**) = 486 − 132 |
| (905,474,631,486)（右下角） | (752, **708**) | (376, **354**) = 486 − 132 |
| (50,32,1486,928)（最大化） | (696, **1592**) | (348, **796**) = 928 − 132 |

y 方向在两种窗口高度下**精确**满足 `y = 2 × (窗口高 − 132)`（132 = 微信输入框底边距，客户端内部布局常量）。

证据二：**拖动窗口的 18 连帧**（实时缩放窗口，逐帧全部吻合）

```
帧高:  486  485  481  478  468  464  454  452  451  445  444  443  441  435  432  429  412  408
y值:   708  706  698  692  672  664  644  640  638  626  624  622  618  606  600  594  560  552
```

每一帧 `y = 2 × (帧高 − 132)`，无一例外。

证据三：**截图像素级闭环**。用缩放过程中的一次实拍截图：末态 `rel(334,552)` + 窗口帧 `(73,43,433,408)`，按"候选框 = 窗口原点 + rel"预测弹窗左上角为 **(409.6, 645.6)**；对截图做像素测量，实际弹窗边界 **(409.6, 645.6)**——分毫不差。

于是候选框实际落点为：

```
弹窗位置 = 帧原点 + 2 × 局部坐标 ≈ 2 × 光标全局位置 − 帧原点
```

窗口越高/越靠右下，误差越大 → 出屏 → 盲打。

## 4. 为什么终端等程序没事

GTK 程序（`GTK_IM_MODULE=ibus`）自己直连守护进程，发送的 `SetCursorLocation` 是**绝对全局坐标**（实测 813→1493 全程真实值），shell 的绝对通道"原样使用"——两条通道完全独立，**零交叉污染**。

## 5. 修复方案（本扩展）

在 shell 内对**相对通道**做一次"单位归一"，叠加在 shell 自带处理器之后：

1. **辨认护栏**：合法的窗口相对坐标不可能越出窗口，故只要 `x > 窗宽 || y > 窗高` 即可判定"该坐标处在被 dpr 放大过的空间"；
2. **归一**：`÷ ceil(显示器 scale)`（实时读取；scale=1 时不动作），再加窗口原点重定位；
3. **时效标记（v2）**：一旦某窗口出现过越界值，10 秒内该窗口的所有值一律按放大空间处理——修掉"窗口缩小时 mutter 帧几何尚未更新的过渡帧被误判为合法、候选框滞留原地"的边角；
4. **几何重锚（v2）**：监听窗口 `position-changed / size-changed` 与 actor 位置尺寸变化，用缓存的归一局部坐标即时重锚——拖动窗口时候选框跟随、松手后第一笔输入即就位。

**对扳机免疫**：不依赖任何固定常量（除数、原点全部实时读取）；上游（Qt / GNOME Shell / 微信）修复后数值不再越界 → 护栏自动放行。历史上来路不明的"忽然开始坏"就算再发生（或被修复），本方案在数学上都自适应。

绝对通道零接触——终端等程序的行为**逐字节不变**（数日日志实证）。

## 6. 已知边界

- 窗口高度 ≤ 264 px 时（缩到极小），越界判据可能不触发，候选框有 ≤132px 的偏移（不影响可读性；此尺寸下实际极少输入）；
- `ceil(scale)` 假定 dpr = 显示器整数缩放。GNOME 分数缩放给非分数感知客户端的 dpr 即 `ceil(fractional)`，实测吻合；其它发行版/合成器的对应关系未验证；
- 实测于 GNOME Shell 46；45–48 声明支持（所用 API 跨版本稳定）。

## 7. 上游线索（供有条件者跟进）

- **Qt**：`QIbusPlatformInputContext`（Qt5 ibus 插件）在 Wayland 上把 caret rect 换算到设备像素后经 `SetCursorLocationRelative` 发出，而 IBus 协议语义为逻辑像素。上游修复点应在此处（或补发逻辑像素版本）；
- **GNOME Shell**：`ibusCandidatePopup.js` 对相对通道数值无任何合理性校验，可考虑加"越界即忽略/告警"的防御（即使修了 Qt，也不防其它客户端重犯）。

## 8. 复现与诊断工具（附录）

- **DBus 抓包**（守护进程私有总线）：
  ```bash
  addr=$(grep -h '^IBUS_ADDRESS=' ~/.config/ibus/bus/*wayland* | head -1 | cut -d= -f2-)
  DBUS_SESSION_BUS_ADDRESS="$addr" dbus-monitor 2>&1 | grep -A4 SetCursorLocation
  ```
- **Looking Glass 一次性原型**：`tools/wxfix3.js`（`Alt+F2` → `lg` → `import('file:///tmp/wxfix3.js')`，仅会话内生效，用于先行验证）；
- **shell 内置 JS 提取**（针对不同 GNOME 版本核对代码）：
  ```bash
  gresource list /usr/lib/gnome-shell/libshell-*.so | grep -E 'ibusCandidatePopup|inputMethod'
  gresource extract /usr/lib/gnome-shell/libshell-*.so /org/gnome/shell/ui/ibusCandidatePopup.js
  ```
