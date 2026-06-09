#!/bin/bash
echo "============================================"
echo "  库存管理系统 - 服务端模式 启动中..."
echo "============================================"
echo ""
echo "  数据存储在 inventory.db 文件中"
echo "  清浏览器缓存不影响数据！"
echo ""
echo "  本机访问：  http://localhost:8765"
echo ""
echo "  按 Ctrl+C 停止服务"
echo "============================================"
# 获取本机IP
IP=$(ifconfig | grep 'inet ' | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
if [ -n "$IP" ]; then
  echo "  局域网访问：http://$IP:8765"
  echo ""
fi
echo "============================================"
python3 server.py