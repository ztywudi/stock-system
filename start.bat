@echo off
chcp 65001 >nul
echo ============================================
echo   库存管理系统 - 服务端模式 启动中...
echo ============================================
echo.
echo  数据存储在 inventory.db 文件中
echo  清浏览器缓存不影响数据！
echo.
echo  本机访问：  http://localhost:8765
echo.
echo  按 Ctrl+C 停止服务
echo ============================================
python server.py
pause