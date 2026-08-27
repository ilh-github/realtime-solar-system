@echo off
chcp 65001 >nul
REM ============================================================
REM 太阳系可视化 — 星历数据下载与生成脚本 (Windows)
REM 用法: 双击运行 或 cmd 中执行 setup_kernels.bat
REM 依赖: curl (Win10+自带), python (需 numpy + jplephem)
REM ============================================================

set KERNELS_DIR=kernels
set DE441_URL=https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de441.bsp
set DE441_BSP=%KERNELS_DIR%\de441.bsp
set DE441_BIN=%KERNELS_DIR%\de441_compact.bin

echo ========================================
echo  太阳系可视化 · 星历数据初始化
echo ========================================

REM 检查 Python
set PYTHON=
where python >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON=python
) else (
    where python3 >nul 2>&1
    if %errorlevel% equ 0 (
        set PYTHON=python3
    )
)
if "%PYTHON%"=="" (
    echo ❌ 未找到 python，请先安装 Python 3
    pause
    exit /b 1
)
%PYTHON% --version

REM 检查依赖
%PYTHON% -c "import numpy, jplephem" 2>nul
if %errorlevel% neq 0 (
    echo ⚠️  缺少 numpy/jplephem，正在安装...
    %PYTHON% -m pip install --user numpy jplephem
)

if not exist "%KERNELS_DIR%" mkdir "%KERNELS_DIR%"

REM === DE441 下载 ===
if exist "%DE441_BIN%" (
    echo ✅ %DE441_BIN% 已存在，跳过
    goto :done
)

if exist "%DE441_BSP%" (
    for %%A in ("%DE441_BSP%") do if %%~zA==3307878400 (
        echo ✅ %DE441_BSP% 已下载
        goto :generate
    )
)

echo 📥 下载 DE441 星历 (3.08 GB，请耐心等待)...
curl -L -C - --retry 3 -o "%DE441_BSP%" "%DE441_URL%"
if %errorlevel% neq 0 (
    echo ❌ 下载失败
    pause
    exit /b 1
)
echo ✅ 下载完成

:generate
echo 🔧 生成紧凑格式 (约 50 MB)...
%PYTHON% generate_de441_compact.py "%DE441_BSP%" "%DE441_BIN%" 5000
if %errorlevel% neq 0 (
    echo ❌ 生成失败
    pause
    exit /b 1
)
echo ✅ %DE441_BIN% 生成完成

:done
echo.
echo ========================================
echo  初始化完成！可以启动 HTTP 服务了
echo  python -m http.server 4185
echo ========================================
pause
