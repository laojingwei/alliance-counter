# ============================================================
#  同盟对战 · 阵容克制关系图 —— 自动更新（Windows）
#  由 update-windows.cmd 调用，也可以直接右键「使用 PowerShell 运行」
#
#  两种更新方式，脚本会自动选择：
#    1) 目录是 git 仓库 且装了 git  -> git pull
#    2) 其它情况                    -> 下载最新 zip 覆盖
#
#  安全措施：
#    · 更新前把整个目录备份到旁边的 alliance-counter-backup-<时间>
#    · （历史说明已废弃：samples/ 已移除）
#    · 保留你在 index.html 里填的 data-repo 配置
# ============================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$repoName = Split-Path $root -Leaf

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Line() { Say ('-' * 58) 'DarkGray' }

Line
Say '  同盟对战 · 阵容克制关系图   自动更新' 'Cyan'
Line
Say ''

# ---------- 1. 读取仓库地址（与网页共用 index.html 里的配置） ----------
$indexPath = Join-Path $root 'index.html'
if (-not (Test-Path $indexPath)) {
  Say '× 没找到 index.html，请把这个脚本放在项目根目录下运行。' 'Red'
  exit 1
}

$html = Get-Content -Raw -Encoding UTF8 $indexPath
$m = [regex]::Match($html, 'data-repo="([^"]+)"')
$repo = if ($m.Success) { $m.Groups[1].Value.Trim().TrimEnd('/') } else { '' }

if (-not $repo -or $repo -match 'YOUR-NAME') {
  Say '× 还没有配置仓库地址。' 'Red'
  Say ''
  Say '  请打开 index.html，找到这一行并把地址换成你自己的仓库：' 'Yellow'
  Say '    <body data-repo="https://github.com/你的用户名/你的仓库">' 'White'
  Say ''
  exit 1
}
Say ("仓库地址： " + $repo) 'White'
Say ''

# ---------- 2. 优先走 git ----------
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
$isGitRepo = Test-Path (Join-Path $root '.git')

if ($gitCmd -and $isGitRepo) {
  $remotes = @(& git remote 2>$null)
  if ($remotes.Count -eq 0) {
    Say '! 这是 git 仓库，但没有配置远程仓库（remote），跳过 git 方式。' 'Yellow'
    Say '  想用 git 更新的话： git remote add origin <你的仓库地址>' 'DarkGray'
    Say ''
  } else {
    Say '[方式] 检测到 git 仓库，执行 git pull ...' 'Cyan'
    Say ''
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      Say ''
      Say '! git pull 没能快进（可能有本地改动）。' 'Yellow'
      Say '  可以先手动处理冲突，或改用「下载覆盖」方式：先删掉 .git 目录再运行本脚本。' 'Yellow'
      exit 2
    }
    Say ''
    Line
    Say '✔ 更新完成（git 方式）' 'Green'
    Line
    Say '请刷新浏览器页面（Ctrl+F5）查看新版本。' 'White'
    exit 0
  }
}

# ---------- 3. 下载 zip 覆盖 ----------
$zipUrl = "$repo/archive/refs/heads/main.zip"
Say '[方式] 没有 git 仓库，改为下载最新版覆盖 ...' 'Cyan'
Say ("下载： " + $zipUrl) 'DarkGray'
Say ''

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tmp = Join-Path $env:TEMP ("ac-update-$stamp")
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
  $zip = Join-Path $tmp 'main.zip'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
  Say '✔ 下载完成' 'Green'

  Say '正在解压 ...'
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $srcDir = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -ne 'main.zip' } | Select-Object -First 1
  if (-not $srcDir) { throw '解压后没找到目录' }
  Say ("✔ 解压完成： " + $srcDir.Name) 'Green'
  Say ''

  # 3.1 备份
  $backup = Join-Path (Split-Path $root -Parent) ("$repoName-backup-$stamp")
  Say ("正在备份到： " + $backup) 'DarkGray'
  Copy-Item $root $backup -Recurse -Force
  Say '✔ 备份完成（出问题可以从这里还原）' 'Green'
  Say ''

  # 3.2 记录当前配置，覆盖后要写回去
  $keepRepo = $repo

  # 3.3 覆盖：整目录同步，但排除 .git
  Say '正在覆盖文件 ...'
  $null = robocopy $srcDir.FullName $root /E /XD .git /NFL /NDL /NJH /NJS /NP
  $rc = $LASTEXITCODE
  if ($rc -ge 8) { throw "robocopy 失败，退出码 $rc" }
  Say '✔ 文件覆盖完成' 'Green'
  Say ''

  # 3.4 把仓库地址写回去（新版本的 index.html 里还是占位符）
  $newHtml = Get-Content -Raw -Encoding UTF8 $indexPath
  if ($newHtml -match 'data-repo="[^"]*"') {
    $newHtml = [regex]::Replace($newHtml, 'data-repo="[^"]*"', ('data-repo="' + $keepRepo + '"'))
    [System.IO.File]::WriteAllText($indexPath, $newHtml, (New-Object System.Text.UTF8Encoding($false)))
    Say '✔ 已保留你的仓库地址配置' 'Green'
  }

  # 3.5 报一下新版本号
  $verFile = Join-Path $root 'version.json'
  if (Test-Path $verFile) {
    try {
      $ver = (Get-Content -Raw -Encoding UTF8 $verFile | ConvertFrom-Json).version
      Say ("  当前版本： v" + $ver) 'White'
    } catch { }
  }

  Say ''
  Line
  Say '✔ 更新完成（下载覆盖方式）' 'Green'
  Line
  Say '请刷新浏览器页面（Ctrl+F5）查看新版本。' 'White'
  Say ("备份位置： " + $backup) 'DarkGray'
  Say '确认一切正常后，可以手动删掉这个备份目录。' 'DarkGray'
}
catch {
  Say ''
  Say ('× 更新失败： ' + $_.Exception.Message) 'Red'
  Say ''
  Say '常见原因：' 'Yellow'
  Say '  · 网络不通，或访问 GitHub 受限；' 'Yellow'
  Say '  · 仓库地址填错，或默认分支不是 main；' 'Yellow'
  Say '  · 目标目录被其它程序占用（先关掉正在看这个项目的编辑器）。' 'Yellow'
  exit 3
}
finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
