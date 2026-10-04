#!/usr/bin/env bash
# 卸载 ibus-wxfix 扩展: 从启用列表移除并删除扩展文件。
set -euo pipefail

UUID="ibus-wxfix@dt.local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

CUR="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo '')"
if [[ "$CUR" == *"'$UUID'"* ]]; then
    NEW="$(printf '%s' "$CUR" | sed -e "s/, '$UUID'//" -e "s/'$UUID', //" -e "s/'$UUID'//")"
    gsettings set org.gnome.shell enabled-extensions "$NEW"
    echo "已从启用列表移除: $NEW"
else
    echo "启用列表中未找到 $UUID(可能已卸载)"
fi

if [ -d "$DEST" ]; then
    rm -rf "$DEST"
    echo "已删除: $DEST"
fi

echo
echo "请注销并重新登录, 完全复原。"
