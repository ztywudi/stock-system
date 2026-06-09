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

:: 优先查找 python，找不到用 python3
python --version >nul 2>&1
if %ERRORLEVEL% == 0 (
    python server.py
) else (
    python3 --version >nul 2>&1
    if %ERRORLEVEL% == 0 (
        python3 server.py
    ) else (
        echo.
        echo [错误] 未找到 Python，请先安装 Python 3
        echo 下载地址: https://www.python.org/downloads/
        echo.
        pause
    )
)
