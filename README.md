# 微信 Linux 输入法候选框错位修复（GNOME Wayland · 分数缩放）

> **一句话**：微信 Linux 原生模式（Qt5）在 GNOME Wayland 开启分数缩放（如 125%）时，中文输入法的**候选框会偏离光标**（跑到右下方很远、甚至屏幕外），严重时完全"盲打"。本项目用一个 GNOME Shell 扩展定点修复——**只影响微信这一条通道，其它程序（终端、浏览器等）零影响**。

## 症状自查

- 微信（**原生模式**）中打拼音：能上屏、能回车提交，但**候选框看不见**，或出现在光标右下方很远的位置；
- **窗口越大偏得越远**：窗口拉到半屏/全屏时，候选框完全出屏 → 完全盲打；
- **终端、浏览器等其它程序输入中文一切正常**；
- 环境特征：**GNOME Wayland** + 显示器**分数缩放**（125% / 150% 等）+ 微信 Linux 官方版（Qt5 构建）。

以上全中，就是本问题。

## 根因（一句话版）

微信使用的 **Qt5 IBus 插件在 Wayland 上把"窗口相对光标坐标"按 `devicePixelRatio`（如 2）放大后**才通过 `SetCursorLocationRelative` 发送，而 IBus 协议约定该字段应为逻辑像素；GNOME Shell 按协议给它**再加上窗口原点**，于是候选框被定位到约「2×光标位置」——窗口越高/越靠右下，偏差越大，最终出屏。

完整证据链（DBus 抓包逐跳比对、拖动窗口 18 连帧逐帧吻合、截图像素级闭环验证）见 **[docs/ANALYSIS.md](docs/ANALYSIS.md)**。

## 安装

```bash
git clone https://github.com/dancingonmoon/wechat-linux-candidate-popup-fix.git
cd wechat-linux-candidate-popup-fix
./install.sh
```

然后**注销并重新登录**（GNOME 扩展只在登录时加载）。

方式二：从 [Releases](../../releases) 下载 `ibus-wxfix@dt.local.zip`：

```bash
gnome-extensions install --force ibus-wxfix@dt.local.zip
gnome-extensions enable ibus-wxfix@dt.local
# 注销重登
```

## 卸载 / 回滚

```bash
./uninstall.sh   # 从启用列表移除 + 删除扩展文件
```

注销重登后完全复原（本扩展不修改系统任何其它文件）。

## 兼容性与行为边界

| 项 | 说明 |
|---|---|
| 实测环境 | GNOME Shell **46**（Ubuntu 24.04） |
| 声明范围 | GNOME Shell 45–48（所用 API 跨版本稳定，未逐一实测；异常请开 issue） |
| 整数缩放（100% / 200%） | 该场景本来就没有此问题，扩展会自动不动作 |
| 其它程序 | 只拦截 IBus「相对坐标通道」（微信等极少数 Wayland 客户端）；终端等 GTK 程序走的绝对通道**完全不受影响** |
| 上游修复后 | 扩展的护栏判定会**自动放行**——上游修好之日即补丁自动退休之时，无需担心冲突 |

如不想产生日志：把 `extension/ibus-wxfix@dt.local/extension.js` 顶部的 `DEBUG = true` 改为 `false`，重新登录。

## 其它缓解手段（不装本扩展时）

- 显示设置改用**整数缩放**（100% 或 200%）——代价是界面过大/过小；
- 微信改用 `QT_QPA_PLATFORM=xcb` 兼容模式——代价是渲染模糊（清晰度约 80%）；
- 保持微信窗口"矮"一些——候选框不会出屏，但仍会偏离光标。

## English

WeChat for Linux (Qt5) sends window-relative cursor coordinates to IBus **scaled by devicePixelRatio** (e.g. ×2) on Wayland, while the protocol expects logical pixels. GNOME Shell then adds the window origin, so the Chinese IME candidate popup lands at roughly 2× the intended position — far from the cursor, or off-screen on tall windows ("blind typing"). This GNOME Shell extension normalizes **only** the relative-cursor channel (out-of-range guard + live `ceil(scale)` divisor + re-anchor on window geometry changes), leaving every other application untouched. It self-disables if upstream fixes the bug. Tested on GNOME Shell 46 (Ubuntu 24.04).

- Install: `./install.sh`, then log out / in. Uninstall: `./uninstall.sh`.
- Root-cause write-up (in Chinese): [docs/ANALYSIS.md](docs/ANALYSIS.md).

## License

[MIT](LICENSE)
