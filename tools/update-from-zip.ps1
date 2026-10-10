# ============================================================
#  同盟对战 · 阵容克制关系图 —— 用本地 zip 包更新
#  给连不上 GitHub 的人用：手动下载 zip，放到项目目录后运行本脚本。
#
#  用法（任选其一）：
#    1) 把 zip 放到项目根目录（或 dist\ 目录），双击 update-from-zip.cmd
#    2) 直接把 zip 拖到 update-from-zip.cmd 上松手（最省事）
#
#  与联网更新一致的安全措施：
#    · 更新前整目录备份到旁边的 <目录名>-backup-<时间>
#    · 保留 samples/ 目录
#    · 保留 index.html 里的 data-repo 配置
# ============================================================

param([Parameter(Position = 0)][string]$ZipPath = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$repoName = Split-Path $root -Leaf

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Line() { Say ('-' * 58) 'DarkGray' }

Line
Say '  同盟对战 · 阵容克制关系图   用本地 zip 更新' 'Cyan'
Line
Say ''

# ---------- 1. 找 zip ----------
$zip = $null
if ($ZipPath -and (Test-Path $ZipPath)) {
  $zip = Get-Item $ZipPath
} else {
  $dirs = @($PSScriptRoot, $root, (Join-Path $root 'dist'))
  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    $hit = Get-ChildItem $d -Filter '*.zip' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($hit) { $zip = $hit; break }
  }
}

if (-not $zip) {
  Say '× 没找到 zip 更新包。' 'Red'
  Say ''
  Say '  用法（任选一种）：' 'Yellow'
  Say '   1) 把下载好的 zip 放到项目根目录（或 dist\ 目录），再双击本脚本；' 'Yellow'
  Say '   2) 直接把 zip 文件拖到 update-from-zip.cmd 上松手。' 'Yellow'
  Say ''
  exit 1
}

Say ('更新包： ' + $zip.FullName) 'White'
Say ('大小：   ' + ('{0:N0}' -f $zip.Length) + ' 字节 · 修改于 ' + $zip.LastWriteTime) 'DarkGray'
Say ''

# ---------- 2. 解压到临时目录 ----------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tmp = Join-Path $env:TEMP ("ac-zipupdate-$stamp")
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
  Say '正在解压 ...'
  Expand-Archive -Path $zip.FullName -DestinationPath $tmp -Force

  # zip 里通常有一层目录（GitHub 的是 仓库名-分支，打包脚本的是 仓库名-v版本号）
  $entries = Get-ChildItem $tmp
  $srcDir = if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) { $entries[0] } else { $tmp }

  # 校验：必须含 index.html，否则不是本项目的更新包
  if (-not (Test-Path (Join-Path $srcDir.FullName 'index.html'))) {
    Say '× 这个 zip 里没找到 index.html，不像是本项目的更新包。' 'Red'
    Say ('  解压后的目录： ' + $srcDir.FullName) 'DarkGray'
    exit 2
  }
  Say ('✔ 解压完成： ' + $srcDir.Name) 'Green'

  # 报一下包里的版本
  $srcVer = ''
  $vf = Join-Path $srcDir.FullName 'version.json'
  if (Test-Path $vf) {
    try { $srcVer = (Get-Content -Raw -Encoding UTF8 $vf | ConvertFrom-Json).version } catch { }
  }
  $curVer = ''
  $vfc = Join-Path $root 'version.json'
  if (Test-Path $vfc) {
    try { $curVer = (Get-Content -Raw -Encoding UTF8 $vfc | ConvertFrom-Json).version } catch { }
  }
  if ($srcVer) {
    Say ('  包内版本： v' + $srcVer + '   （当前： v' + ($(if ($curVer) { $curVer } else { '未知' })) + '）') 'White'
  }
  Say ''

  # ---------- 3. 备份 ----------
  $backup = Join-Path (Split-Path $root -Parent) ("$repoName-backup-$stamp")
  Say ('正在备份到： ' + $backup) 'DarkGray'
  Copy-Item $root $backup -Recurse -Force
  Say '✔ 备份完成（出问题可以从这里还原）' 'Green'
  Say ''

  # ---------- 4. 覆盖（保留 samples 与 .git） ----------
  $keepRepo = ''
  $indexPath = Join-Path $root 'index.html'
  if (Test-Path $indexPath) {
    $html = Get-Content -Raw -Encoding UTF8 $indexPath
    $m = [regex]::Match($html, 'data-repo="([^"]+)"')
    if ($m.Success) { $keepRepo = $m.Groups[1].Value }
  }

  Say '正在覆盖文件 ...'
  $null = robocopy $srcDir.FullName $root /E /XD samples .git /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败，退出码 $LASTEXITCODE" }
  Say '✔ 文件覆盖完成' 'Green'
  Say ''

  # ---------- 5. 写回 data-repo ----------
  if ($keepRepo -and (Test-Path $indexPath)) {
    $newHtml = Get-Content -Raw -Encoding UTF8 $indexPath
    if ($newHtml -match 'data-repo="[^"]*"') {
      $newHtml = [regex]::Replace($newHtml, 'data-repo="[^"]*"', ('data-repo="' + $keepRepo + '"'))
      [System.IO.File]::WriteAllText($indexPath, $newHtml, (New-Object System.Text.UTF8Encoding($false)))
      Say '✔ 已保留你的仓库地址配置' 'Green'
    }
  }

  # ---------- 6. 提示 ----------
  Say ''
  Line
  Say '✔ 更新完成（本地 zip 方式）' 'Green'
  Line
  Say '请刷新浏览器页面（Ctrl+F5）查看新版本。' 'White'
  Say ('备份位置： ' + $backup) 'DarkGray'
  Say '确认一切正常后，可以手动删掉这个备份目录和用过的 zip。' 'DarkGray'
}
catch {
  Say ''
  Say ('× 更新失败： ' + $_.Exception.Message) 'Red'
  Say ''
  Say '常见原因：' 'Yellow'
  Say '  · zip 不完整（下载中断），重新下载一次；' 'Yellow'
  Say '  · 目标目录被占用（先关掉正在打开本项目的编辑器/资源管理器）；' 'Yellow'
  Say '  · 没有写权限（换个目录，或用管理员运行）。' 'Yellow'
  exit 3
}
finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
