#!/usr/bin/env bash
# 安装 ibus-wxfix 扩展(修复微信 Qt5 IBus 候选框错位)并启用。
# 生效条件: 注销并重新登录(GNOME 扩展只在登录时加载)。
set -euo pipefail

UUID="ibus-wxfix@dt.local"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/extension/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

if ! command -v gnome-shell >/dev/null 2>&1; then
    echo "错误: 未检测到 gnome-shell——本扩展只适用于 GNOME 桌面。" >&2
    exit 1
fi
echo "GNOME Shell: $(gnome-shell --version 2>/dev/null || echo '未知')"

if [ ! -d "$SRC" ]; then
    echo "错误: 未找到扩展源目录 $SRC" >&2
    exit 1
fi

if gsettings get org.gnome.shell disable-user-extensions 2>/dev/null | grep -q true; then
    echo "提示: 系统当前禁用了用户扩展(disable-user-extensions=true)。"
    echo "      请先执行: gsettings set org.gnome.shell disable-user-extensions false"
fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -r "$SRC" "$DEST"
echo "已安装扩展文件到: $DEST"

CUR="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo '@as []')"
if [[ "$CUR" == *"'$UUID'"* ]]; then
    echo "启用列表已包含 $UUID"
else
    if [[ "$CUR" == "[]" || "$CUR" == "@as []" || -z "$CUR" ]]; then
        NEW="['$UUID']"
    else
        NEW="${CUR%]}, '$UUID']"
    fi
    gsettings set org.gnome.shell enabled-extensions "$NEW"
    echo "已加入启用列表: $NEW"
fi

echo
echo "完成。请【注销并重新登录】后生效。"
echo "验证: 微信中输入拼音,候选框应出现在光标附近; 卸载: ./uninstall.sh"
