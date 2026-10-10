# ============================================================
#  同盟对战 · 阵容克制关系图 —— 打包发布
#  由 pack-release.cmd 调用。
#
#  产物： dist\alliance-counter-v<版本号>.zip
#        zip 内是一层同名目录，结构与 GitHub 下载的 zip 一致，
#        因此可以直接用 update-from-zip.cmd 更新。
#
#  打包时会排除： .git、node_modules、dist、.tmp、以及所有 zip
# ============================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Line() { Say ('-' * 58) 'DarkGray' }

Line
Say '  同盟对战 · 阵容克制关系图   打包发布' 'Cyan'
Line
Say ''

# ---------- 1. 版本号 ----------
$ver = ''
$vf = Join-Path $root 'version.json'
if (Test-Path $vf) {
  try { $ver = (Get-Content -Raw -Encoding UTF8 $vf | ConvertFrom-Json).version } catch { }
}
if (-not $ver) { $ver = Get-Date -Format 'yyyyMMdd' }

$folderName = "alliance-counter-v$ver"
$distDir = Join-Path $root 'dist'
$zipOut = Join-Path $distDir "$folderName.zip"

Say ('版本号： v' + $ver) 'White'
Say ('产物：   ' + $zipOut) 'DarkGray'
Say ''

if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Say '× 没找到 index.html，请把脚本放在项目里的 tools 目录下运行。' 'Red'
  exit 1
}

New-Item -ItemType Directory -Path $distDir -Force | Out-Null

# ---------- 2. 复制到临时目录（顺便排除不该带的东西） ----------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tmp = Join-Path $env:TEMP "ac-pack-$stamp"
$dest = Join-Path $tmp $folderName
New-Item -ItemType Directory -Path $dest -Force | Out-Null

Say '正在收集文件 ...'
$null = robocopy $root $dest /E /XD .git node_modules dist .tmp /XF *.zip /NFL /NDL /NJH /NJS /NP
$rc = $LASTEXITCODE
if ($rc -ge 8) { Say ('× 收集文件失败（robocopy ' + $rc + '）') 'Red'; exit 2 }

$files = Get-ChildItem $dest -Recurse -File
$totalMB = [math]::Round((($files | Measure-Object Length -Sum).Sum / 1MB), 2)
Say ('✔ 共 ' + $files.Count + ' 个文件，' + $totalMB + ' MB') 'Green'
Say ''

# ---------- 3. 压缩 ----------
Say '正在压缩 ...'
if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
Compress-Archive -Path $dest -DestinationPath $zipOut -Force

$zipMB = [math]::Round((Get-Item $zipOut).Length / 1MB, 2)
Say ('✔ 完成： ' + $zipOut + '  （' + $zipMB + ' MB）') 'Green'
Say ''

# ---------- 4. 给一份说明 ----------
$readme = Join-Path $distDir '更新说明.txt'
@"
同盟对战 · 阵容克制关系图   离线更新包 v$ver

【怎么用】
1. 把 $folderName.zip 下载/拷贝到你本地的该项目目录下
   （就是含有 index.html 的那个文件夹，放 dist 子目录也可以）
2. 双击 update-from-zip.cmd
   （更省事的办法：直接把 zip 拖到 update-from-zip.cmd 上松手）
3. 脚本会自动解压并覆盖，然后刷新浏览器（Ctrl+F5）即可

【脚本会自动做的三件事】
- 更新前把整个目录备份到旁边的 <目录名>-backup-<时间>，出问题可以还原
- 保留 samples 目录（里面的示例 CSV 不动）
- 保留 index.html 里的 data-repo 配置

【macOS 用户】
双击 update-from-zip.command（首次可能需要在「系统设置 - 隐私与安全性」里允许运行）

打包时间： $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
"@ | Set-Content -Path $readme -Encoding utf8

Line
Say '✔ 打包完成' 'Green'
Line
Say ('zip：  ' + $zipOut) 'White'
Say ('说明： ' + $readme) 'White'
Say ''
Say '把这两个文件一起发给别人即可（对方只需那个 zip）。' 'DarkGray'

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
