# Read the packaged UI without simulated edits or directory switching. Startup may migrate legacy storage.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$smokeExecutable = (Resolve-Path 'src-tauri/target/release/desktodo.exe').Path
$smokeOutput = Join-Path (Get-Location).Path 'test-results/native'
New-Item -ItemType Directory -Force $smokeOutput | Out-Null
$smokeOldFolder = $env:WEBVIEW2_USER_DATA_FOLDER
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $smokeOutput ([Guid]::NewGuid().ToString())
$smokeProcess = Start-Process -FilePath $smokeExecutable -WindowStyle Hidden -PassThru
try {
    $smokeLoaded = $false
    for ($smokeAttempt = 0; $smokeAttempt -lt 60; $smokeAttempt++) {
        $smokeProcess.Refresh()
        if ($smokeProcess.HasExited) { throw "Application exited: $($smokeProcess.ExitCode)" }
        if ($smokeProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            $smokeRoot = [System.Windows.Automation.AutomationElement]::FromHandle($smokeProcess.MainWindowHandle)
            $smokeElements = $smokeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $smokeNames = @($smokeElements | ForEach-Object { $_.Current.Name })
            if ($smokeNames -contains '给想法一个落脚点' -or $smokeNames -contains '便签标题') { $smokeLoaded = $true; break }
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $smokeLoaded) { throw 'Native frontend did not reach setup or the workspace.' }
    'PASS: packaged desktop window, bundled frontend and Rust initialization IPC. No simulated UI edits or directory changes.'
} finally {
    if (-not $smokeProcess.HasExited) { Stop-Process -Id $smokeProcess.Id }
    $env:WEBVIEW2_USER_DATA_FOLDER = $smokeOldFolder
}
